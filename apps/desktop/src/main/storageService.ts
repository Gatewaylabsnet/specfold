import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createEmptyWorkspace,
  ensureWorkspaceEnvironment,
  stripTransientUploadData,
  type Workspace
} from "@openapi-collection-studio/core";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type RestoreBackupResult,
  type WorkspaceLoadResult
} from "../shared/contracts";

export const ENCRYPTED_PREFIX = "enc:v1:";
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const MAX_BACKUPS = 5;

export interface SecureStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface StoragePaths {
  userData: string;
  workspace: string;
  settings: string;
  backups: string;
}

export type AtomicWriter = (path: string, content: string, mode?: number) => Promise<void>;

export interface StorageServiceOptions {
  paths: StoragePaths;
  secureStorage: SecureStorageAdapter;
  appVersion: string;
  now?: () => Date;
  atomicWrite?: AtomicWriter;
}

interface BackupDocument {
  schema: "specfold.backup.v1";
  exportedAt: string;
  appVersion: string;
  secretsIncluded: true;
  workspace: Workspace;
  settings: AppSettings;
}

export function storagePaths(userData: string): StoragePaths {
  return {
    userData,
    workspace: join(userData, "workspace.json"),
    settings: join(userData, "app-settings.json"),
    backups: join(userData, "backups")
  };
}

export async function atomicWriteFile(path: string, content: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(tempPath, content, { encoding: "utf8", mode });
    await rename(tempPath, path);
    await chmod(path, mode).catch(() => undefined);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

export function createStorageService(options: StorageServiceOptions) {
  const { paths, secureStorage, appVersion } = options;
  const now = options.now ?? (() => new Date());
  const atomicWrite = options.atomicWrite ?? atomicWriteFile;
  const secureStorageAvailable = () => secureStorage.isEncryptionAvailable();
  const stamp = () => now().toISOString().replace(/[:.]/g, "-");

  const encryptSecrets = (workspace: Workspace): Workspace => ({
    ...workspace,
    environments: workspace.environments.map((environment) => ({
      ...environment,
      variables: environment.variables.map((variable) => {
        if (!variable.secret || !variable.value || variable.value.startsWith(ENCRYPTED_PREFIX)) {
          return variable;
        }
        if (!secureStorageAvailable()) {
          return { ...variable, value: "" };
        }
        const encrypted = secureStorage.encryptString(variable.value).toString("base64");
        return { ...variable, value: `${ENCRYPTED_PREFIX}${encrypted}` };
      })
    }))
  });

  const decryptSecrets = (workspace: Workspace): Workspace => ({
    ...workspace,
    environments: (workspace.environments ?? []).map((environment) => ({
      ...environment,
      variables: (environment.variables ?? []).map((variable) => {
        if (!variable.value?.startsWith(ENCRYPTED_PREFIX)) return variable;
        if (!secureStorageAvailable()) return { ...variable, value: "" };
        try {
          const value = secureStorage.decryptString(
            Buffer.from(variable.value.slice(ENCRYPTED_PREFIX.length), "base64")
          );
          return { ...variable, value };
        } catch {
          return { ...variable, value: "" };
        }
      })
    }))
  });

  const rotateBackup = async (): Promise<void> => {
    try {
      await stat(paths.workspace);
    } catch {
      return;
    }
    await mkdir(paths.backups, { recursive: true });
    await copyFile(paths.workspace, join(paths.backups, `workspace-${stamp()}.json`));
    const entries = (await readdir(paths.backups))
      .filter((name) => name.startsWith("workspace-") && name.endsWith(".json"))
      .sort();
    for (const name of entries.slice(0, Math.max(0, entries.length - MAX_BACKUPS))) {
      await unlink(join(paths.backups, name)).catch(() => undefined);
    }
  };

  const quarantineCorruptFile = async (): Promise<string | undefined> => {
    const target = join(paths.userData, `workspace.corrupt-${stamp()}.json`);
    try {
      await rename(paths.workspace, target);
      return target;
    } catch {
      return undefined;
    }
  };

  const loadWorkspace = async (): Promise<WorkspaceLoadResult> => {
    const secure = secureStorageAvailable();
    let raw: string;
    try {
      raw = await readFile(paths.workspace, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { workspace: createEmptyWorkspace(), recovered: false, secureStorageAvailable: secure };
      }
      return {
        workspace: createEmptyWorkspace(),
        recovered: true,
        secureStorageAvailable: secure,
        message: `Could not read the saved workspace (${(error as Error).message}). A new empty workspace was opened; your file was left untouched.`
      };
    }
    try {
      const parsed = stripTransientUploadData(validateWorkspace(JSON.parse(raw)), {
        disableFileFields: true,
        rootKind: "workspace"
      });
      return {
        workspace: ensureWorkspaceEnvironment(decryptSecrets(parsed)),
        recovered: false,
        secureStorageAvailable: secure
      };
    } catch (error) {
      const target = await quarantineCorruptFile();
      return {
        workspace: createEmptyWorkspace(),
        recovered: true,
        secureStorageAvailable: secure,
        message: `${(error as Error).message} It was moved to ${target ?? "a backup file"}. Recent backups are in the "backups" folder.`
      };
    }
  };

  const saveWorkspace = async (workspace: Workspace): Promise<void> => {
    await rotateBackup();
    const normalized = ensureWorkspaceEnvironment(stripTransientUploadData({
      ...workspace,
      updatedAt: now().toISOString()
    }, { rootKind: "workspace" }));
    await atomicWrite(paths.workspace, JSON.stringify(encryptSecrets(normalized), null, 2));
  };

  const loadSettings = async (): Promise<AppSettings> => {
    try {
      return normalizeSettings(JSON.parse(await readFile(paths.settings, "utf8")));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  };

  const saveSettings = async (settings: AppSettings): Promise<AppSettings> => {
    const normalized = normalizeSettings(settings);
    await atomicWrite(paths.settings, JSON.stringify(normalized, null, 2));
    return normalized;
  };

  const createBackupDocument = async (workspace: Workspace): Promise<BackupDocument> => ({
    schema: "specfold.backup.v1",
    exportedAt: now().toISOString(),
    appVersion,
    secretsIncluded: true,
    workspace: ensureWorkspaceEnvironment(stripTransientUploadData(workspace, {
      rootKind: "workspace"
    })),
    settings: await loadSettings()
  });

  const writeBackup = async (path: string, workspace: Workspace): Promise<void> => {
    const document = await createBackupDocument(workspace);
    await atomicWrite(path, JSON.stringify(document, null, 2), 0o600);
    await chmod(path, 0o600).catch(() => undefined);
  };

  const createRestoreSafetyBackup = async (): Promise<string | undefined> => {
    await mkdir(paths.backups, { recursive: true });
    const target = join(paths.backups, `restore-safety-${stamp()}.workspace.json`);
    try {
      await copyFile(paths.workspace, target);
      await chmod(target, 0o600).catch(() => undefined);
      try {
        await copyFile(paths.settings, target.replace(".workspace.json", ".settings.json"));
      } catch {
        // Settings may not exist yet.
      }
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  };

  const restoreBackupText = async (content: string): Promise<RestoreBackupResult> => {
    if (Buffer.byteLength(content, "utf8") > MAX_BACKUP_BYTES) {
      throw new Error("Backup is larger than 100 MB.");
    }
    const document = validateBackupDocument(JSON.parse(content));
    const safetyBackupPath = await createRestoreSafetyBackup();
    const beforeWorkspace = await readOptional(paths.workspace);
    const beforeSettings = await readOptional(paths.settings);
    const persistedWorkspace = encryptSecrets(
      ensureWorkspaceEnvironment(stripTransientUploadData(document.workspace, {
        disableFileFields: true,
        rootKind: "workspace"
      }))
    );
    try {
      await atomicWrite(paths.workspace, JSON.stringify(persistedWorkspace, null, 2));
      await atomicWrite(paths.settings, JSON.stringify(document.settings, null, 2));
    } catch (error) {
      await restoreSnapshot(paths.workspace, beforeWorkspace, atomicWrite);
      await restoreSnapshot(paths.settings, beforeSettings, atomicWrite);
      throw new Error(`Restore failed and previous data was restored: ${(error as Error).message}`);
    }
    return {
      canceled: false,
      restored: true,
      secureStorageAvailable: secureStorageAvailable(),
      workspace: ensureWorkspaceEnvironment(decryptSecrets(persistedWorkspace)),
      settings: document.settings,
      safetyBackupPath
    };
  };

  const restoreBackupFile = async (path: string): Promise<RestoreBackupResult> => {
    if ((await stat(path)).size > MAX_BACKUP_BYTES) throw new Error("Backup is larger than 100 MB.");
    return restoreBackupText(await readFile(path, "utf8"));
  };

  const deleteAllLocalData = async (): Promise<void> => {
    await Promise.all([
      unlink(paths.workspace).catch(() => undefined),
      unlink(paths.settings).catch(() => undefined),
      rm(paths.backups, { recursive: true, force: true })
    ]);
    const entries = await readdir(paths.userData).catch(() => [] as string[]);
    await Promise.all(entries
      .filter((name) => /^workspace\.(?:corrupt-|json\.tmp-)/i.test(name))
      .map((name) => unlink(join(paths.userData, name)).catch(() => undefined)));
  };

  return {
    secureStorageAvailable,
    encryptSecrets,
    decryptSecrets,
    loadWorkspace,
    saveWorkspace,
    loadSettings,
    saveSettings,
    createBackupDocument,
    writeBackup,
    restoreBackupText,
    restoreBackupFile,
    deleteAllLocalData
  };
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function restoreSnapshot(path: string, content: string | undefined, writer: AtomicWriter): Promise<void> {
  if (content === undefined) await unlink(path).catch(() => undefined);
  else await writer(path, content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateWorkspace(value: unknown): Workspace {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("The backup workspace must use schemaVersion 1.");
  }
  if (!Array.isArray(value.collections) || !Array.isArray(value.environments)) {
    throw new Error("The backup workspace must contain collection and environment arrays.");
  }
  return structuredClone(value) as unknown as Workspace;
}

function normalizeSettings(value: unknown): AppSettings {
  const input = isRecord(value) ? value : {};
  return {
    requestTimeoutMs: typeof input.requestTimeoutMs === "number" && input.requestTimeoutMs >= 0
      ? input.requestTimeoutMs : DEFAULT_SETTINGS.requestTimeoutMs,
    maxResponseBytes: typeof input.maxResponseBytes === "number" && input.maxResponseBytes > 0
      ? input.maxResponseBytes : DEFAULT_SETTINGS.maxResponseBytes,
    allowInsecureTls: typeof input.allowInsecureTls === "boolean"
      ? input.allowInsecureTls : DEFAULT_SETTINGS.allowInsecureTls
  };
}

function validateBackupDocument(value: unknown): BackupDocument {
  if (!isRecord(value) || value.schema !== "specfold.backup.v1") {
    throw new Error("Only specfold.backup.v1 backup files can be restored.");
  }
  const workspace = validateWorkspace(value.workspace);
  if (!isRecord(value.settings) ||
      typeof value.settings.requestTimeoutMs !== "number" || value.settings.requestTimeoutMs < 0 ||
      typeof value.settings.maxResponseBytes !== "number" || value.settings.maxResponseBytes <= 0 ||
      typeof value.settings.allowInsecureTls !== "boolean") {
    throw new Error("The backup settings are invalid.");
  }
  return {
    schema: "specfold.backup.v1",
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : "",
    appVersion: typeof value.appVersion === "string" ? value.appVersion : "",
    secretsIncluded: true,
    workspace,
    settings: normalizeSettings(value.settings)
  };
}
