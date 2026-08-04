import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions, type WebContents } from "electron";
import { readFile } from "node:fs/promises";
import type { Workspace } from "@openapi-collection-studio/core";
import { DEFAULT_SETTINGS } from "../shared/contracts";
import { MAX_IMPORT_BYTES } from "./constants";
import { checkForUpdates, fetchImportUrl, sendHttpRequest, testConnection } from "./http";
import { readPostmanV3Folder } from "./importSources";
import { atomicWrite, deleteAllLocalData, exportFullBackup, getLocalDataInfo, loadSettings, loadWorkspace, restoreBackup, saveSettings, saveWorkspace, serializeStorageMutation } from "./storage";
import { clearUploadFiles, registerUploadFile, releaseUploadFile, retainUploadFiles } from "./uploadFiles";
import { applyNativeTheme } from "./window";
import { openTrustedExternal } from "./external";
import { assertTrustedIpcSender } from "./security";
import {
  validateExportPayload,
  validateIpcSettings,
  validateIpcWorkspace,
  validateSendRequestPayload,
  validateUploadId,
  validateUrl
} from "./ipcValidation";

const uploadOwnersWithCleanup = new Set<number>();

export function registerIpcHandlers(): void {
  handleTrusted("app:info", () => ({
    name: "Specfold",
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    releaseUrl: `https://github.com/Gatewaylabsnet/specfold/releases/tag/v${app.getVersion()}`,
    downloadUrl: "https://gatewaylabs.net/specfold",
    license: "Apache-2.0"
  }));
  handleTrusted("app:checkForUpdates", () => checkForUpdates(app.getVersion()));
  handleTrusted("app:openExternal", async (_event, value: unknown) => {
    await openTrustedExternal(validateUrl(value));
  });
  handleTrusted("workspace:load", () => loadWorkspace());
  handleTrusted("workspace:save", (event, value: unknown) => {
    const workspace = validateIpcWorkspace(value);
    registerUploadOwnerCleanup(event.sender);
    retainUploadFiles(event.sender.id, uploadIdsInWorkspace(workspace));
    return serializeStorageMutation(() => saveWorkspace(workspace));
  });
  handleTrusted("settings:load", () => loadSettings());
  handleTrusted("settings:save", async (_event, value: unknown) => {
    const settings = validateIpcSettings(value);
    const saved = await serializeStorageMutation(() => saveSettings(settings));
    applyNativeTheme(saved.theme);
    return saved;
  });
  handleTrusted("environment:testConnection", (_event, value: unknown) =>
    testConnection(validateUrl(value)));
  handleTrusted("http:send", (event, value: unknown) => {
    registerUploadOwnerCleanup(event.sender);
    return sendHttpRequest(validateSendRequestPayload(value), event.sender.id);
  });
  handleTrusted("file:openImport", async () => {
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
  handleTrusted("file:openUpload", async (event) => {
    registerUploadOwnerCleanup(event.sender);
    try {
      const options: OpenDialogOptions = {
        title: "Choose file to upload",
        filters: [{ name: "All files", extensions: ["*"] }],
        properties: ["openFile"]
      };
      const parent = BrowserWindow.fromWebContents(event.sender);
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) return { canceled: true };
      return {
        canceled: false,
        file: await registerUploadFile(result.filePaths[0], event.sender.id)
      };
    } catch (error) {
      return {
        canceled: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  handleTrusted("file:releaseUpload", (event, value: unknown) => {
    releaseUploadFile(validateUploadId(value), event.sender.id);
  });
  handleTrusted("file:openPostmanFolder", async () => {
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
  handleTrusted("import:fetchUrl", (_event, value: unknown) => fetchImportUrl(validateUrl(value)));
  handleTrusted("file:exportBackup", (_event, value: unknown) =>
    exportFullBackup(validateIpcWorkspace(value)));
  handleTrusted("file:restoreBackup", async () => {
    const result = await serializeStorageMutation(restoreBackup);
    if (result.restored) {
      clearUploadFiles();
      applyNativeTheme(result.settings?.theme ?? DEFAULT_SETTINGS.theme);
    }
    return result;
  });
  handleTrusted("data:deleteAll", () => serializeStorageMutation(async () => {
    clearUploadFiles();
    await deleteAllLocalData();
    applyNativeTheme(DEFAULT_SETTINGS.theme);
  }));
  handleTrusted("data:info", () => getLocalDataInfo());
  handleTrusted("data:openFolder", async () => {
    const error = await shell.openPath((await getLocalDataInfo()).dataPath);
    return error ? { ok: false, error } : { ok: true };
  });
  handleTrusted("file:saveExport", async (_event, value: unknown) => {
    const payload = validateExportPayload(value);
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

function handleTrusted<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event);
    return handler(event, ...(args as TArgs));
  });
}

function registerUploadOwnerCleanup(sender: WebContents): void {
  const ownerId = sender.id;
  if (uploadOwnersWithCleanup.has(ownerId)) return;
  uploadOwnersWithCleanup.add(ownerId);
  sender.on("did-start-navigation", (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) clearUploadFiles(ownerId);
  });
  sender.once("render-process-gone", () => clearUploadFiles(ownerId));
  sender.once("destroyed", () => {
    clearUploadFiles(ownerId);
    uploadOwnersWithCleanup.delete(ownerId);
  });
}

function uploadIdsInWorkspace(workspace: Workspace): Set<string> {
  const result = new Set<string>();
  const visitRequests = (requests: unknown) => {
    if (!Array.isArray(requests)) return;
    for (const request of requests) {
      if (!isRecord(request) || !isRecord(request.body) || !Array.isArray(request.body.multipart)) {
        continue;
      }
      for (const field of request.body.multipart) {
        if (isRecord(field) && typeof field.uploadId === "string" && field.uploadId.length <= 128) {
          result.add(field.uploadId);
        }
      }
    }
  };
  const visitFolders = (folders: unknown) => {
    if (!Array.isArray(folders)) return;
    for (const folder of folders) {
      if (!isRecord(folder)) continue;
      visitRequests(folder.requests);
      visitFolders(folder.folders);
    }
  };

  if (Array.isArray(workspace?.collections)) {
    for (const collection of workspace.collections) {
      if (!isRecord(collection)) continue;
      visitRequests(collection.requests);
      visitFolders(collection.folders);
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
