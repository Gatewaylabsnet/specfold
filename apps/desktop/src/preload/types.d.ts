import type { ApiRequest, Environment, Workspace } from "@openapi-collection-studio/core";

export interface StudioApi {
  loadWorkspace(): Promise<Workspace>;
  saveWorkspace(workspace: Workspace): Promise<void>;
  sendRequest(request: ApiRequest, environment?: Environment): Promise<{
    status: number;
    statusText: string;
    durationMs: number;
    sizeBytes: number;
    headers: Record<string, string>;
    body: string;
    rawBody: string;
    error?: string;
  }>;
  saveExportFile(defaultPath: string, content: string): Promise<{
    canceled: boolean;
    filePath?: string;
  }>;
}

declare global {
  interface Window {
    studio: StudioApi;
  }
}
