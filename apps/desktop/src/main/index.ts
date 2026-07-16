import { app, BrowserWindow, dialog, ipcMain, nativeImage, safeStorage, session } from "electron";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import {
  createEmptyWorkspace,
  ensureWorkspaceEnvironment,
  MissingVariablesError,
  prepareHttpRequest,
  type ApiRequest,
  type Collection,
  type Environment,
  type Workspace
} from "@openapi-collection-studio/core";
import { fetchWithProxy, ProxyAgentCache } from "./proxy";

interface AppSettings {
  requestTimeoutMs: number;
  maxResponseBytes: number;
  allowInsecureTls: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  requestTimeoutMs: 30_000,
  maxResponseBytes: 10 * 1024 * 1024,
  allowInsecureTls: false
};

interface SendRequestPayload {
  request: ApiRequest;
  environment?: Environment;
  collection?: Pick<Collection, "baseUrl">;
}

interface SendRequestResult {
  status: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  headers: Record<string, string>;
  body: string;
  rawBody: string;
  truncated?: boolean;
  error?: string;
}

interface WorkspaceLoadResult {
  workspace: Workspace;
  recovered: boolean;
  message?: string;
}

const ENCRYPTED_PREFIX = "enc:v1:";
const MAX_BACKUPS = 5;
const proxyAgents = new ProxyAgentCache();
let storageMutationQueue: Promise<void> = Promise.resolve();

const workspacePath = () => join(app.getPath("userData"), "workspace.json");
const backupsDir = () => join(app.getPath("userData"), "backups");
const settingsPath = () => join(app.getPath("userData"), "app-settings.json");

function serializeStorageMutation<T>(operation: () => Promise<T>): Promise<T> {
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
async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, path);
}

async function rotateBackup(): Promise<void> {
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

async function quarantineCorruptFile(): Promise<string | undefined> {
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

function encryptSecrets(workspace: Workspace): Workspace {
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

function decryptSecrets(workspace: Workspace): Workspace {
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

async function loadWorkspace(): Promise<WorkspaceLoadResult> {
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

async function saveWorkspace(workspace: Workspace): Promise<void> {
  await rotateBackup();
  const persisted = encryptSecrets(
    ensureWorkspaceEnvironment({ ...workspace, updatedAt: new Date().toISOString() })
  );
  await atomicWrite(workspacePath(), JSON.stringify(persisted, null, 2));
}

async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  await atomicWrite(settingsPath(), JSON.stringify(merged, null, 2));
  return merged;
}

async function sendHttpRequest(payload: SendRequestPayload): Promise<SendRequestResult> {
  const settings = await loadSettings();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutMs);
  const previousTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (settings.allowInsecureTls) {
    // Opt-in escape hatch for internal CAs / self-signed gateways.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  try {
    const prepared = prepareHttpRequest(payload.request, payload.environment, payload.collection);
    const startedAt = performance.now();
    const response = await fetchWithProxy(
      prepared.url,
      {
        method: prepared.method,
        headers: prepared.headers,
        body: prepared.body,
        signal: controller.signal
      },
      (url) => session.defaultSession.resolveProxy(url),
      proxyAgents
    );

    const { bytes, truncated } = await readCappedBody(response, settings.maxResponseBytes);
    const rawBody = new TextDecoder().decode(bytes);
    const body = formatBody(rawBody, response.headers.get("content-type"));
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: response.status,
      statusText: response.statusText,
      durationMs: Math.round(performance.now() - startedAt),
      sizeBytes: bytes.byteLength,
      headers,
      body,
      rawBody,
      truncated
    };
  } catch (error) {
    if (error instanceof MissingVariablesError) {
      return emptyError("Missing variables", error.message);
    }
    if (error instanceof Error && error.name === "AbortError") {
      return emptyError(
        "Request timed out",
        `The request exceeded the ${settings.requestTimeoutMs} ms timeout and was aborted.`
      );
    }
    return emptyError("Request failed", error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
    if (settings.allowInsecureTls) {
      if (previousTlsSetting === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting;
      }
    }
  }
}

async function readCappedBody(
  response: Response,
  maxBytes: number
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return { bytes: buffer.slice(0, maxBytes), truncated: buffer.byteLength > maxBytes };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        chunks.push(value.slice(0, value.byteLength - (total - maxBytes)));
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
    }
  }

  const bytes = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_FOLDER_IMPORT_FILES = 2_000;

interface FolderImportFile {
  path: string;
  content: string;
}

async function readPostmanV3Folder(rootPath: string): Promise<{
  rootName: string;
  files: FolderImportFile[];
  skippedScriptCount: number;
}> {
  const files: FolderImportFile[] = [];
  let totalBytes = 0;
  let discoveredFiles = 0;
  let skippedScriptCount = 0;

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 50) {
      throw new Error("The selected folder is nested too deeply to import safely.");
    }
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const fullPath = join(directory, entry.name);
      const relativePath = relative(rootPath, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if ([".git", "node_modules"].includes(entry.name)) {
          continue;
        }
        await visit(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      discoveredFiles += 1;
      if (discoveredFiles > MAX_FOLDER_IMPORT_FILES) {
        throw new Error(`The selected folder contains more than ${MAX_FOLDER_IMPORT_FILES} files.`);
      }
      if (/\.resources\/scripts\//i.test(relativePath)) {
        skippedScriptCount += 1;
        continue;
      }
      const isRequest = /\.request\.ya?ml$/i.test(relativePath);
      const isDefinition = /(?:^|\/)definition\.ya?ml$/i.test(relativePath);
      const isExample = /\.resources\/examples\/.*\.ya?ml$/i.test(relativePath);
      if (!isRequest && !isDefinition && !isExample) {
        continue;
      }
      const size = (await stat(fullPath)).size;
      totalBytes += size;
      if (totalBytes > MAX_IMPORT_BYTES) {
        throw new Error(
          `Postman folder content is larger than ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB.`
        );
      }
      files.push({ path: relativePath, content: await readFile(fullPath, "utf8") });
    }
  };

  await visit(rootPath, 0);
  if (!files.some((file) => /\.request\.ya?ml$/i.test(file.path))) {
    throw new Error("No *.request.yaml files were found in the selected folder.");
  }
  return { rootName: basename(rootPath), files, skippedScriptCount };
}

async function exportFullBackup(workspace: Workspace): Promise<{
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

async function deleteAllLocalData(): Promise<void> {
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

async function fetchImportUrl(
  url: string
): Promise<{ ok: boolean; content?: string; error?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Invalid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http(s) URLs are supported." };
  }

  const settings = await loadSettings();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutMs);
  try {
    const response = await fetchWithProxy(
      url,
      {
        signal: controller.signal,
        headers: { Accept: "application/json, application/yaml, text/yaml, text/plain, */*" }
      },
      (targetUrl) => session.defaultSession.resolveProxy(targetUrl),
      proxyAgents
    );
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} ${response.statusText}` };
    }
    const { bytes, truncated } = await readCappedBody(response, MAX_IMPORT_BYTES);
    if (truncated) {
      return {
        ok: false,
        error: `Document is larger than ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB and cannot be imported.`
      };
    }
    return { ok: true, content: new TextDecoder().decode(bytes) };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "The request timed out." };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function emptyError(statusText: string, message: string): SendRequestResult {
  return {
    status: 0,
    statusText,
    durationMs: 0,
    sizeBytes: 0,
    headers: {},
    body: "",
    rawBody: "",
    error: message
  };
}

function formatBody(body: string, contentType: string | null): string {
  if (contentType?.includes("application/json")) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

function resolveWindowIcon(): Electron.NativeImage | undefined {
  // The running window's title-bar and taskbar icon come from here (the exe
  // file icon is separate and needs rcedit/winCodeSign, which isn't available
  // on this build path). Dev: apps/desktop/build; packaged: bundled in asar.
  const iconPath = process.env.ELECTRON_RENDERER_URL
    ? join(__dirname, "../../build/icon.png")
    : join(app.getAppPath(), "build/icon.png");
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? undefined : image;
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "Specfold",
    icon: resolveWindowIcon(),
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function applyContentSecurityPolicy(): void {
  // Only enforce CSP for packaged loads (file://). The dev server needs the
  // Vite websocket/eval for HMR, so we leave dev untouched.
  if (process.env.ELECTRON_RENDERER_URL) {
    return;
  }
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'"
        ]
      }
    });
  });
}

// Display name shown in menus, dialogs, and the Windows taskbar. Change this
// one constant if the product is ever renamed. Must be set before the first
// getPath("userData") call so dev and packaged builds share a storage folder.
const PRODUCT_NAME = "Specfold";
const APP_ID = "net.gatewaylabs.specfold";

app.setName(PRODUCT_NAME);
if (process.platform === "win32") {
  // Without an explicit AppUserModelID, the taskbar groups the dev process as
  // "Electron". This makes it identify as the product in every mode.
  app.setAppUserModelId(APP_ID);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (existing) {
      if (existing.isMinimized()) {
        existing.restore();
      }
      existing.focus();
    }
  });

  app.whenReady().then(() => {
    applyContentSecurityPolicy();

    ipcMain.handle("workspace:load", () => loadWorkspace());
    ipcMain.handle("workspace:save", (_event, workspace: Workspace) =>
      serializeStorageMutation(() => saveWorkspace(workspace))
    );
    ipcMain.handle("settings:load", () => loadSettings());
    ipcMain.handle("settings:save", (_event, settings: AppSettings) =>
      serializeStorageMutation(() => saveSettings(settings))
    );
    ipcMain.handle("http:send", (_event, payload: SendRequestPayload) => sendHttpRequest(payload));
    ipcMain.handle("file:openImport", async () => {
      const result = await dialog.showOpenDialog({
        title: "Open API document",
        filters: [
          { name: "API specifications and collections", extensions: ["yaml", "yml", "json", "har", "http", "rest"] },
          { name: "All files", extensions: ["*"] }
        ],
        properties: ["openFile"]
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
      }
      const filePath = result.filePaths[0];
      const content = await readFile(filePath, "utf8");
      if (content.length > MAX_IMPORT_BYTES) {
        return {
          canceled: false,
          error: `File is larger than ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB and cannot be imported.`
        };
      }
      return { canceled: false, content, filePath };
    });
    ipcMain.handle("file:openPostmanFolder", async () => {
      const result = await dialog.showOpenDialog({
        title: "Open Postman Collection v3 folder",
        properties: ["openDirectory"]
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
      }
      const folderPath = result.filePaths[0];
      try {
        return {
          canceled: false,
          folderPath,
          source: await readPostmanV3Folder(folderPath)
        };
      } catch (error) {
        return {
          canceled: false,
          folderPath,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });
    ipcMain.handle("import:fetchUrl", (_event, url: string) => fetchImportUrl(url));
    ipcMain.handle("file:exportBackup", (_event, workspace: Workspace) => exportFullBackup(workspace));
    ipcMain.handle("data:deleteAll", () => serializeStorageMutation(deleteAllLocalData));
    ipcMain.handle(
      "file:saveExport",
      async (_event, payload: { defaultPath: string; content: string }) => {
        const result = await dialog.showSaveDialog({
          title: "Save export",
          defaultPath: payload.defaultPath,
          filters: [
            { name: "OpenAPI YAML", extensions: ["yaml", "yml"] },
            { name: "OpenAPI JSON", extensions: ["json"] },
            { name: "All files", extensions: ["*"] }
          ]
        });

        if (result.canceled || !result.filePath) {
          return { canceled: true };
        }

        await atomicWrite(result.filePath, payload.content);
        return { canceled: false, filePath: result.filePath };
      }
    );

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    void proxyAgents.closeAll();
  });
}
