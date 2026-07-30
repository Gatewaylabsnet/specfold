import type { Workspace } from "@openapi-collection-studio/core";
import type { AppSettings, SendRequestPayload } from "../shared/contracts";

const MAX_IPC_DOCUMENT_BYTES = 100 * 1024 * 1024;
const MAX_URL_LENGTH = 8_192;
const MAX_PATH_LENGTH = 4_096;

export function validateIpcWorkspace(value: unknown): Workspace {
  if (!isRecord(value) || value.schemaVersion !== 1 ||
      !Array.isArray(value.collections) || !Array.isArray(value.environments)) {
    throw new Error("Invalid workspace payload.");
  }
  assertJsonSize(value, MAX_IPC_DOCUMENT_BYTES, "Workspace");
  return value as unknown as Workspace;
}

export function validateIpcSettings(value: unknown): AppSettings {
  if (!isRecord(value) ||
      !isFiniteNumber(value.requestTimeoutMs) || value.requestTimeoutMs < 0 ||
      !isFiniteNumber(value.maxResponseBytes) || value.maxResponseBytes <= 0 ||
      typeof value.allowInsecureTls !== "boolean" ||
      !isOneOf(value.theme, ["system", "light", "dark"]) ||
      !isOneOf(value.fontSize, ["compact", "default", "large"])) {
    throw new Error("Invalid settings payload.");
  }
  return value as unknown as AppSettings;
}

export function validateSendRequestPayload(value: unknown): SendRequestPayload {
  if (!isRecord(value) || !isRecord(value.request)) {
    throw new Error("Invalid request payload.");
  }
  assertJsonSize(value, MAX_IPC_DOCUMENT_BYTES, "Request");
  return value as unknown as SendRequestPayload;
}

export function validateUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) {
    throw new Error("Invalid URL payload.");
  }
  return value;
}

export function validateUploadId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new Error("Invalid upload identifier.");
  }
  return value;
}

export function validateExportPayload(
  value: unknown
): { defaultPath: string; content: string } {
  if (!isRecord(value) ||
      typeof value.defaultPath !== "string" || value.defaultPath.length === 0 ||
      value.defaultPath.length > MAX_PATH_LENGTH ||
      typeof value.content !== "string") {
    throw new Error("Invalid export payload.");
  }
  if (Buffer.byteLength(value.content, "utf8") > MAX_IPC_DOCUMENT_BYTES) {
    throw new Error("Export is larger than 100 MB.");
  }
  return { defaultPath: value.defaultPath, content: value.content };
}

function assertJsonSize(value: unknown, maxBytes: number, label: string): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label} payload is not serializable.`);
  }
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new Error(`${label} payload is larger than 100 MB.`);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.includes(value as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
