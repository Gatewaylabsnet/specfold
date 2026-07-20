import { openAsBlob } from "node:fs";
import type { Stats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import type { MultipartField } from "@openapi-collection-studio/core";
import type { UploadFileInfo } from "../shared/contracts";

export const MAX_MULTIPART_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_MULTIPART_FILE_COUNT = 50;
export const MAX_MULTIPART_PART_COUNT = 200;
const MAX_UPLOAD_REGISTRY_ENTRIES = 500;
const MAX_PART_NAME_BYTES = 1_024;
const MAX_CONTENT_TYPE_LENGTH = 255;

interface UploadEntry extends UploadFileInfo {
  ownerId: number;
  attachedToWorkspace: boolean;
  canonicalPath: string;
  modifiedAtMs: number;
  device: number;
  inode: number;
}

const uploads = new Map<string, UploadEntry>();

const CONTENT_TYPES: Record<string, string> = {
  ".csv": "text/csv",
  ".gif": "image/gif",
  ".htm": "text/html",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".zip": "application/zip"
};

export async function registerUploadFile(filePath: string, ownerId: number): Promise<UploadFileInfo> {
  if (uploads.size >= MAX_UPLOAD_REGISTRY_ENTRIES) {
    throw new Error("Too many files are selected in this session. Clear unused file selections and try again.");
  }

  const selected = await lstat(filePath);
  if (selected.isSymbolicLink()) {
    throw new Error("Symbolic links cannot be selected for upload.");
  }
  if (!selected.isFile()) {
    throw new Error("Only regular files can be selected for upload.");
  }

  const canonicalPath = await realpath(filePath);
  const current = await lstat(canonicalPath);
  if (current.isSymbolicLink() || !current.isFile()) {
    throw new Error("Only regular files can be selected for upload.");
  }
  if (current.size > MAX_MULTIPART_UPLOAD_BYTES) {
    throw new Error("The selected file is larger than the 100 MB upload limit.");
  }

  const fileName = safeFileName(basename(canonicalPath));
  const entry: UploadEntry = {
    uploadId: randomUUID(),
    ownerId,
    attachedToWorkspace: false,
    canonicalPath,
    fileName,
    sizeBytes: current.size,
    contentType: inferContentType(fileName),
    modifiedAtMs: current.mtimeMs,
    device: current.dev,
    inode: current.ino
  };
  uploads.set(entry.uploadId, entry);
  const unattachedExpiry = setTimeout(() => {
    const currentEntry = uploads.get(entry.uploadId);
    if (currentEntry && !currentEntry.attachedToWorkspace) {
      uploads.delete(entry.uploadId);
    }
  }, 30_000);
  unattachedExpiry.unref();
  return publicFileInfo(entry);
}

export function releaseUploadFile(uploadId: string, ownerId: number): void {
  const entry = uploads.get(uploadId);
  if (entry?.ownerId === ownerId) {
    uploads.delete(uploadId);
  }
}

export function clearUploadFiles(ownerId?: number): void {
  if (ownerId === undefined) {
    uploads.clear();
    return;
  }
  for (const [uploadId, entry] of uploads) {
    if (entry.ownerId === ownerId) {
      uploads.delete(uploadId);
    }
  }
}

/** Remove grants that are no longer referenced by the owner's live workspace. */
export function retainUploadFiles(ownerId: number, retainedUploadIds: ReadonlySet<string>): void {
  for (const [uploadId, entry] of uploads) {
    if (entry.ownerId !== ownerId) continue;
    if (retainedUploadIds.has(uploadId)) {
      entry.attachedToWorkspace = true;
    } else if (entry.attachedToWorkspace) {
      uploads.delete(uploadId);
    }
  }
}

export async function createMultipartFormData(
  fields: readonly MultipartField[],
  ownerId: number
): Promise<{ formData: FormData; sizeBytes: number }> {
  if (fields.length > MAX_MULTIPART_PART_COUNT) {
    throw new Error(`Multipart requests support at most ${MAX_MULTIPART_PART_COUNT} parts.`);
  }

  const fileFields = fields.filter((field) => field.type === "file");
  if (fileFields.length > MAX_MULTIPART_FILE_COUNT) {
    throw new Error(`Multipart requests support at most ${MAX_MULTIPART_FILE_COUNT} files.`);
  }

  let sizeBytes = 0;
  const resolvedFiles: UploadEntry[] = [];
  for (const field of fields) {
    validatePartName(field.key);
    if (field.type === "text") {
      if (typeof field.value !== "string") {
        throw new Error(`Multipart text field "${displayPartName(field.key)}" has an invalid value.`);
      }
      sizeBytes += Buffer.byteLength(field.value, "utf8");
      assertUploadSize(sizeBytes);
      continue;
    }
    if (field.type !== "file") {
      throw new Error("Multipart request contains an unsupported part type.");
    }
    if (!field.uploadId) {
      throw new Error(`Choose a file for multipart field "${displayPartName(field.key)}" before sending.`);
    }
    const entry = await resolveUploadFile(field.uploadId, ownerId);
    sizeBytes += entry.sizeBytes;
    assertUploadSize(sizeBytes);
    resolvedFiles.push(entry);
  }

  const formData = new FormData();
  let fileIndex = 0;
  for (const field of fields) {
    if (field.type === "text") {
      formData.append(field.key, field.value);
      continue;
    }
    const entry = resolvedFiles[fileIndex++];
    if (!entry) {
      throw new Error(`Choose a file for multipart field "${displayPartName(field.key)}" before sending.`);
    }
    const contentType = normalizeContentType(field.contentType || entry.contentType);
    const blob = await openAsBlob(entry.canonicalPath, { type: contentType });
    formData.append(field.key, blob, entry.fileName);
  }
  return { formData, sizeBytes };
}

export function stripMultipartTransportHeaders(headers: Record<string, string>): Record<string, string> {
  const result = { ...headers };
  for (const key of Object.keys(result)) {
    const normalized = key.toLowerCase();
    if (normalized === "content-type" || normalized === "content-length") {
      delete result[key];
    }
  }
  return result;
}

async function resolveUploadFile(uploadId: string, ownerId: number): Promise<UploadEntry> {
  const entry = uploads.get(uploadId);
  if (!entry || entry.ownerId !== ownerId) {
    throw new Error("The selected upload file is unavailable or expired. Choose the file again.");
  }

  let current: Stats;
  let currentCanonicalPath: string;
  try {
    current = await lstat(entry.canonicalPath);
    currentCanonicalPath = await realpath(entry.canonicalPath);
  } catch {
    uploads.delete(uploadId);
    throw new Error(`Selected file "${entry.fileName}" no longer exists. Choose it again.`);
  }

  if (
    current.isSymbolicLink() ||
    !current.isFile() ||
    normalizePath(currentCanonicalPath) !== normalizePath(entry.canonicalPath)
  ) {
    uploads.delete(uploadId);
    throw new Error(`Selected file "${entry.fileName}" is no longer a regular file. Choose it again.`);
  }

  const identityChanged =
    current.size !== entry.sizeBytes ||
    current.mtimeMs !== entry.modifiedAtMs ||
    (entry.device !== 0 && current.dev !== entry.device) ||
    (entry.inode !== 0 && current.ino !== entry.inode);
  if (identityChanged) {
    uploads.delete(uploadId);
    throw new Error(`Selected file "${entry.fileName}" changed after selection. Choose it again.`);
  }
  return entry;
}

function publicFileInfo(entry: UploadEntry): UploadFileInfo {
  return {
    uploadId: entry.uploadId,
    fileName: entry.fileName,
    sizeBytes: entry.sizeBytes,
    contentType: entry.contentType
  };
}

function inferContentType(fileName: string): string {
  return CONTENT_TYPES[extname(fileName).toLowerCase()] ?? "application/octet-stream";
}

function normalizeContentType(value: string): string {
  const contentType = value.trim();
  if (
    !contentType ||
    contentType.length > MAX_CONTENT_TYPE_LENGTH ||
    /[\0\r\n]/.test(contentType) ||
    !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:\s*;[^\r\n]*)?$/.test(contentType)
  ) {
    throw new Error("Multipart file content type is invalid.");
  }
  return contentType;
}

function safeFileName(value: string): string {
  const safe = value.replace(/[\0\r\n"]/g, "_").trim();
  return safe || "upload.bin";
}

function validatePartName(value: string): void {
  if (!value.trim()) {
    throw new Error("Multipart field names cannot be empty.");
  }
  if (/[\0\r\n]/.test(value) || Buffer.byteLength(value, "utf8") > MAX_PART_NAME_BYTES) {
    throw new Error("Multipart field name is invalid or too long.");
  }
}

function displayPartName(value: string): string {
  return value.replace(/[\0\r\n]/g, " ").slice(0, 80) || "file";
}

function assertUploadSize(sizeBytes: number): void {
  if (sizeBytes > MAX_MULTIPART_UPLOAD_BYTES) {
    throw new Error("Multipart request content is larger than the 100 MB upload limit.");
  }
}

function normalizePath(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}
