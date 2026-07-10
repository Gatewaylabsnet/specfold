import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createEmptyWorkspace,
  MissingVariablesError,
  prepareHttpRequest,
  type ApiRequest,
  type Environment,
  type Workspace
} from "@openapi-collection-studio/core";

interface SendRequestPayload {
  request: ApiRequest;
  environment?: Environment;
}

interface SendRequestResult {
  status: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  headers: Record<string, string>;
  body: string;
  rawBody: string;
  error?: string;
}

const workspacePath = () => join(app.getPath("userData"), "workspace.json");

async function loadWorkspace(): Promise<Workspace> {
  try {
    const raw = await readFile(workspacePath(), "utf8");
    const parsed = JSON.parse(raw) as Workspace;
    if (parsed.schemaVersion !== 1) {
      return createEmptyWorkspace();
    }
    return parsed;
  } catch {
    return createEmptyWorkspace();
  }
}

async function saveWorkspace(workspace: Workspace): Promise<void> {
  const path = workspacePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({ ...workspace, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

async function sendHttpRequest(payload: SendRequestPayload): Promise<SendRequestResult> {
  try {
    const prepared = prepareHttpRequest(payload.request, payload.environment);
    const startedAt = performance.now();
    const response = await fetch(prepared.url, {
      method: prepared.method,
      headers: prepared.headers,
      body: prepared.body
    });
    const arrayBuffer = await response.arrayBuffer();
    const rawBody = new TextDecoder().decode(arrayBuffer);
    const body = formatBody(rawBody, response.headers.get("content-type"));
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: response.status,
      statusText: response.statusText,
      durationMs: Math.round(performance.now() - startedAt),
      sizeBytes: arrayBuffer.byteLength,
      headers,
      body,
      rawBody
    };
  } catch (error) {
    if (error instanceof MissingVariablesError) {
      return {
        status: 0,
        statusText: "Missing variables",
        durationMs: 0,
        sizeBytes: 0,
        headers: {},
        body: "",
        rawBody: "",
        error: error.message
      };
    }

    return {
      status: 0,
      statusText: "Request failed",
      durationMs: 0,
      sizeBytes: 0,
      headers: {},
      body: "",
      rawBody: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
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

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "OpenAPI Collection Studio",
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  ipcMain.handle("workspace:load", () => loadWorkspace());
  ipcMain.handle("workspace:save", (_event, workspace: Workspace) => saveWorkspace(workspace));
  ipcMain.handle("http:send", (_event, payload: SendRequestPayload) => sendHttpRequest(payload));
  ipcMain.handle("file:saveExport", async (_event, payload: { defaultPath: string; content: string }) => {
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

    await writeFile(result.filePath, payload.content, "utf8");
    return { canceled: false, filePath: result.filePath };
  });

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
