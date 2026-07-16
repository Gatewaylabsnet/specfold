import { app, dialog, safeStorage } from "electron";
import { copyFile, mkdir, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createEmptyWorkspace, ensureWorkspaceEnvironment, type Workspace } from "@openapi-collection-studio/core";
import { DEFAULT_SETTINGS, type AppSettings, type WorkspaceLoadResult } from "../shared/contracts";

const ENCRYPTED_PREFIX = "enc:v1:";
const MAX_BACKUPS = 5;
let storageMutationQueue: Promise<void> = Promise.resolve();

const workspacePath = () => join(app.getPath("userData"), "workspace.json");
const backupsDir = () => join(app.getPath("userData"), "backups");
const settingsPath = () => join(app.getPath("userData"), "app-settings.json");

export function serializeStorageMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageMutationQueue.then(operation, operation);
  storageMutationQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/**
 * Write a file without ever leaving a half-written target behind: write to a
 * temp file in the same directory, then atomically rename over the target.
 */
export async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, path);
}

export async function rotateBackup(): Promise<void> {
  const source = workspacePath();
  try {
    await readFile(source, "utf8");
  } catch {
    return; // Nothing valid to back up yet.
  }
  const dir = backupsDir();
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await copyFile(source, join(dir, `workspace-${stamp}.json`));

  const entries = (await readdir(dir))
    .filter((name) => name.startsWith("workspace-") && name.endsWith(".json"))
    .sort();
  const excess = entries.length - MAX_BACKUPS;
  for (let index = 0; index < excess; index += 1) {
    await unlink(join(dir, entries[index])).catch(() => undefined);
  }
}

export async function quarantineCorruptFile(): Promise<string | undefined> {
  const source = workspacePath();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(app.getPath("userData"), `workspace.corrupt-${stamp}.json`);
  try {
    await rename(source, target);
    return target;
  } catch {
    return undefined;
  }
}

export function encryptSecrets(workspace: Workspace): Workspace {
  if (!safeStorage.isEncryptionAvailable()) {
    return workspace;
  }
  return {
    ...workspace,
    environments: workspace.environments.map((environment) => ({
      ...environment,
      variables: environment.variables.map((variable) => {
        if (!variable.secret || !variable.value || variable.value.startsWith(ENCRYPTED_PREFIX)) {
          return variable;
        }
        const encrypted = safeStorage.encryptString(variable.value).toString("base64");
        return { ...variable, value: `${ENCRYPTED_PREFIX}${encrypted}` };
      })
    }))
  };
}

export function decryptSecrets(workspace: Workspace): Workspace {
  return {
    ...workspace,
    environments: (workspace.environments ?? []).map((environment) => ({
      ...environment,
      variables: (environment.variables ?? []).map((variable) => {
        if (!variable.value?.startsWith(ENCRYPTED_PREFIX)) {
          return variable;
        }
        if (!safeStorage.isEncryptionAvailable()) {
          return { ...variable, value: "" };
        }
        try {
          const decrypted = safeStorage.decryptString(
            Buffer.from(variable.value.slice(ENCRYPTED_PREFIX.length), "base64")
          );
          return { ...variable, value: decrypted };
        } catch {
          return { ...variable, value: "" };
        }
      })
    }))
  };
}

export async function loadWorkspace(): Promise<WorkspaceLoadResult> {
  let raw: string;
  try {
    raw = await readFile(workspacePath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { workspace: createEmptyWorkspace(), recovered: false };
    }
    // The file exists but could not be read (locked, permissions). Do NOT
    // overwrite it with an empty workspace — surface the problem instead.
    return {
      workspace: createEmptyWorkspace(),
      recovered: true,
      message: `Could not read the saved workspace (${(error as Error).message}). A new empty workspace was opened; your file was left untouched.`
    };
  }

  try {
    const parsed = JSON.parse(raw) as Workspace;
    if (parsed.schemaVersion !== 1) {
      const target = await quarantineCorruptFile();
      return {
        workspace: createEmptyWorkspace(),
        recovered: true,
        message: `The saved workspace uses an unsupported schema version. It was moved to ${target ?? "a backup file"} so it will not be overwritten.`
      };
    }
    return { workspace: ensureWorkspaceEnvironment(decryptSecrets(parsed)), recovered: false };
  } catch {
    const target = await quarantineCorruptFile();
    return {
      workspace: createEmptyWorkspace(),
      recovered: true,
      message: `The saved workspace file was corrupt and could not be parsed. It was moved to ${target ?? "a backup file"}. Recent backups are in the "backups" folder.`
    };
  }
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  await rotateBackup();
  const persisted = encryptSecrets(
    ensureWorkspaceEnvironment({ ...workspace, updatedAt: new Date().toISOString() })
  );
  await atomicWrite(workspacePath(), JSON.stringify(persisted, null, 2));
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  await atomicWrite(settingsPath(), JSON.stringify(merged, null, 2));
  return merged;
}

export async function exportFullBackup(workspace: Workspace): Promise<{
  canceled: boolean;
  filePath?: string;
}> {
  const result = await dialog.showSaveDialog({
    title: "Export complete Specfold backup",
    defaultPath: `specfold-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [
      { name: "Specfold backup", extensions: ["json"] },
      { name: "All files", extensions: ["*"] }
    ]
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }
  const document = {
    schema: "specfold.backup.v1",
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    secretsIncluded: true,
    workspace: ensureWorkspaceEnvironment(structuredClone(workspace)),
    settings: await loadSettings()
  };
  await atomicWrite(result.filePath, JSON.stringify(document, null, 2));
  return { canceled: false, filePath: result.filePath };
}

export async function deleteAllLocalData(): Promise<void> {
  await Promise.all([
    unlink(workspacePath()).catch(() => undefined),
    unlink(settingsPath()).catch(() => undefined),
    rm(backupsDir(), { recursive: true, force: true })
  ]);

  const userDataPath = app.getPath("userData");
  const entries = await readdir(userDataPath).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((name) => /^workspace\.(?:corrupt-|json\.tmp-)/i.test(name))
      .map((name) => unlink(join(userDataPath, name)).catch(() => undefined))
  );
}
