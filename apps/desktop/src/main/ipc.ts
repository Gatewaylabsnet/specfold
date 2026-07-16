import { dialog, ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import type { Workspace } from "@openapi-collection-studio/core";
import type { AppSettings, SendRequestPayload } from "../shared/contracts";
import { MAX_IMPORT_BYTES } from "./constants";
import { fetchImportUrl, sendHttpRequest } from "./http";
import { readPostmanV3Folder } from "./importSources";
import { atomicWrite, deleteAllLocalData, exportFullBackup, loadSettings, loadWorkspace, saveSettings, saveWorkspace, serializeStorageMutation } from "./storage";

export function registerIpcHandlers(): void {
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
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const filePath = result.filePaths[0];
    const content = await readFile(filePath, "utf8");
    if (content.length > MAX_IMPORT_BYTES) {
      return { canceled: false, error: `File is larger than ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB and cannot be imported.` };
    }
    return { canceled: false, content, filePath };
  });
  ipcMain.handle("file:openPostmanFolder", async () => {
    const result = await dialog.showOpenDialog({
      title: "Open Postman Collection v3 folder",
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const folderPath = result.filePaths[0];
    try {
      return { canceled: false, folderPath, source: await readPostmanV3Folder(folderPath) };
    } catch (error) {
      return { canceled: false, folderPath, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle("import:fetchUrl", (_event, url: string) => fetchImportUrl(url));
  ipcMain.handle("file:exportBackup", (_event, workspace: Workspace) => exportFullBackup(workspace));
  ipcMain.handle("data:deleteAll", () => serializeStorageMutation(deleteAllLocalData));
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
    if (result.canceled || !result.filePath) return { canceled: true };
    await atomicWrite(result.filePath, payload.content);
    return { canceled: false, filePath: result.filePath };
  });
}
