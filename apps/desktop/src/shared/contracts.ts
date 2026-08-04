import type { ApiRequest, Collection, Environment, Folder, PostmanV3FolderSource, Workspace } from "@openapi-collection-studio/core";

export type ThemePreference = "system" | "light" | "dark";
export type FontSizePreference = "compact" | "default" | "large";
export const APP_MENU_ACTIONS = [
  "import",
  "export",
  "settings",
  "about",
  "check-for-updates"
] as const;
export type AppMenuAction = (typeof APP_MENU_ACTIONS)[number];

export interface AppSettings {
  requestTimeoutMs: number;
  maxResponseBytes: number;
  allowInsecureTls: boolean;
  theme: ThemePreference;
  fontSize: FontSizePreference;
}

export const DEFAULT_SETTINGS: AppSettings = {
  requestTimeoutMs: 30_000,
  maxResponseBytes: 10 * 1024 * 1024,
  allowInsecureTls: false,
  theme: "system",
  fontSize: "compact"
};

export interface SendRequestPayload {
  request: ApiRequest;
  environment?: Environment;
  collection?: Pick<Collection, "baseUrl">;
  folderPath?: Array<Pick<Folder, "baseUrl">>;
}

export interface SendRequestResult {
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

export interface WorkspaceLoadResult {
  workspace: Workspace;
  recovered: boolean;
  secureStorageAvailable: boolean;
  message?: string;
}

export interface RestoreBackupResult {
  canceled: boolean;
  restored: boolean;
  secureStorageAvailable: boolean;
  workspace?: Workspace;
  settings?: AppSettings;
  safetyBackupPath?: string;
  error?: string;
}

export interface FileActionResult {
  canceled: boolean;
  filePath?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  url: string;
  status?: number;
  statusText?: string;
  durationMs?: number;
  error?: string;
}

export interface LocalDataInfo {
  dataPath: string;
  backupCount: number;
  latestBackupAt?: string;
}

export interface OpenImportResult extends FileActionResult {
  content?: string;
  error?: string;
}

export interface UploadFileInfo {
  uploadId: string;
  fileName: string;
  sizeBytes: number;
  contentType: string;
}

export interface OpenUploadFileResult {
  canceled: boolean;
  error?: string;
  file?: UploadFileInfo;
}

export interface OpenPostmanFolderResult {
  canceled: boolean;
  folderPath?: string;
  source?: PostmanV3FolderSource;
  error?: string;
}

export interface FetchImportUrlResult {
  ok: boolean;
  content?: string;
  error?: string;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
  releaseUrl: string;
  downloadUrl: string;
  license: string;
}

export interface UpdateCheckResult {
  ok: boolean;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  releaseName?: string;
  releaseUrl?: string;
  publishedAt?: string;
  error?: string;
}

export interface StudioApi {
  onAppMenuAction(listener: (action: AppMenuAction) => void): () => void;
  getAppInfo(): Promise<AppInfo>;
  checkForUpdates(): Promise<UpdateCheckResult>;
  openExternal(url: string): Promise<void>;
  loadWorkspace(): Promise<WorkspaceLoadResult>;
  saveWorkspace(workspace: Workspace): Promise<void>;
  loadSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  testConnection(url: string): Promise<ConnectionTestResult>;
  sendRequest(
    request: ApiRequest,
    environment?: Environment,
    collection?: Pick<Collection, "baseUrl">,
    folderPath?: Array<Pick<Folder, "baseUrl">>
  ): Promise<SendRequestResult>;
  saveExportFile(defaultPath: string, content: string): Promise<FileActionResult>;
  openImportFile(): Promise<OpenImportResult>;
  openUploadFile(): Promise<OpenUploadFileResult>;
  releaseUploadFile(uploadId: string): Promise<void>;
  openPostmanFolder(): Promise<OpenPostmanFolderResult>;
  exportBackup(workspace: Workspace): Promise<FileActionResult>;
  restoreBackup(): Promise<RestoreBackupResult>;
  deleteAllData(): Promise<void>;
  getLocalDataInfo(): Promise<LocalDataInfo>;
  openLocalDataFolder(): Promise<{ ok: boolean; error?: string }>;
  fetchImportUrl(url: string): Promise<FetchImportUrlResult>;
}
