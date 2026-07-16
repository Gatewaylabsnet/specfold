import { app, dialog, safeStorage } from "electron";
import type { Workspace } from "@openapi-collection-studio/core";
import type {
  AppSettings,
  FileActionResult,
  RestoreBackupResult,
  WorkspaceLoadResult
} from "../shared/contracts";
import {
  atomicWriteFile,
  createStorageService,
  storagePaths,
  type SecureStorageAdapter
} from "./storageService";

let storageMutationQueue: Promise<void> = Promise.resolve();
let service: ReturnType<typeof createStorageService> | undefined;

function storageService(): ReturnType<typeof createStorageService> {
  if (!service) {
    const secureStorage: SecureStorageAdapter = {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptString(value),
      decryptString: (value) => safeStorage.decryptString(value)
    };
    service = createStorageService({
      paths: storagePaths(app.getPath("userData")),
      secureStorage,
      appVersion: app.getVersion()
    });
  }
  return service;
}

export function serializeStorageMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageMutationQueue.then(operation, operation);
  storageMutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

export const atomicWrite = atomicWriteFile;

export function loadWorkspace(): Promise<WorkspaceLoadResult> {
  return storageService().loadWorkspace();
}

export function saveWorkspace(workspace: Workspace): Promise<void> {
  return storageService().saveWorkspace(workspace);
}

export function loadSettings(): Promise<AppSettings> {
  return storageService().loadSettings();
}

export function saveSettings(settings: AppSettings): Promise<AppSettings> {
  return storageService().saveSettings(settings);
}

export async function exportFullBackup(workspace: Workspace): Promise<FileActionResult> {
  const result = await dialog.showSaveDialog({
    title: "Export complete Specfold backup",
    defaultPath: `specfold-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [
      { name: "Specfold backup", extensions: ["json"] },
      { name: "All files", extensions: ["*"] }
    ]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await storageService().writeBackup(result.filePath, workspace);
  return { canceled: false, filePath: result.filePath };
}

export async function restoreBackup(): Promise<RestoreBackupResult> {
  const currentService = storageService();
  const result = await dialog.showOpenDialog({
    title: "Restore Specfold backup",
    filters: [
      { name: "Specfold backup", extensions: ["json"] },
      { name: "All files", extensions: ["*"] }
    ],
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return {
      canceled: true,
      restored: false,
      secureStorageAvailable: currentService.secureStorageAvailable()
    };
  }
  try {
    return await currentService.restoreBackupFile(result.filePaths[0]);
  } catch (error) {
    return {
      canceled: false,
      restored: false,
      secureStorageAvailable: currentService.secureStorageAvailable(),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function deleteAllLocalData(): Promise<void> {
  return storageService().deleteAllLocalData();
}
