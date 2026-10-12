import type { HttpMethod } from "@openapi-collection-studio/core";
import type { AppSettings as SharedAppSettings, FontSizePreference, ThemePreference } from "../../shared/contracts";

export type Screen = "editor" | "import" | "environments" | "export" | "settings";
export type RequestTab = "params" | "auth" | "headers" | "body";
export type ResponseTab = "body" | "headers" | "raw";
export type ExportFormat = "openapi-yaml" | "openapi-json" | "collection-json" | "postman-json" | "http-file";
export type SaveStatus = "saved" | "dirty" | "saving" | "error";

export type AppSettings = SharedAppSettings;
export type { FontSizePreference, ThemePreference };

export { DEFAULT_SETTINGS } from "../../shared/contracts";

export interface ResponseState {
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

export interface ResponseHistoryEntry { at: string; response: ResponseState; }
export const MAX_HISTORY_PER_REQUEST = 10;
export const methods: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];
