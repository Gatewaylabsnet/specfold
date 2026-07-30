import type { Workspace } from "@openapi-collection-studio/core";
import { DEFAULT_SETTINGS, type AppSettings } from "../shared/contracts";

export interface BackupDocument {
  schema: "specfold.backup.v1";
  exportedAt: string;
  appVersion: string;
  secretsIncluded: true;
  workspace: Workspace;
  settings: AppSettings;
}

export function validateWorkspace(value: unknown): Workspace {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("The backup workspace must use schemaVersion 1.");
  }
  if (!Array.isArray(value.collections) || !Array.isArray(value.environments)) {
    throw new Error("The backup workspace must contain collection and environment arrays.");
  }
  return structuredClone(value) as unknown as Workspace;
}

export function normalizeSettings(value: unknown): AppSettings {
  const input = isRecord(value) ? value : {};
  return {
    requestTimeoutMs: typeof input.requestTimeoutMs === "number" && input.requestTimeoutMs >= 0
      ? input.requestTimeoutMs : DEFAULT_SETTINGS.requestTimeoutMs,
    maxResponseBytes: typeof input.maxResponseBytes === "number" && input.maxResponseBytes > 0
      ? input.maxResponseBytes : DEFAULT_SETTINGS.maxResponseBytes,
    allowInsecureTls: typeof input.allowInsecureTls === "boolean"
      ? input.allowInsecureTls : DEFAULT_SETTINGS.allowInsecureTls,
    theme: input.theme === "light" || input.theme === "dark" || input.theme === "system"
      ? input.theme : DEFAULT_SETTINGS.theme,
    fontSize: input.fontSize === "compact" || input.fontSize === "default" || input.fontSize === "large"
      ? input.fontSize : DEFAULT_SETTINGS.fontSize
  };
}

export function validateBackupDocument(value: unknown): BackupDocument {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
