import type { ApiRequest, Collection, Folder, MultipartField, Workspace } from "./types";

export interface StripTransientUploadOptions {
  /** Imported file placeholders must be explicitly re-selected before send. */
  disableFileFields?: boolean;
  /** Callers parsing untrusted roots should state the expected document kind. */
  rootKind?: "collection" | "workspace";
}

/**
 * Clone a collection or workspace and remove every process-local upload grant.
 * File values are blanked and filenames are reduced to a basename so neither
 * file contents nor local paths can leak into workspace/backup/export JSON.
 */
export function stripTransientUploadData<T extends Collection | Workspace>(
  value: T,
  options: StripTransientUploadOptions = {}
): T {
  const clone = structuredClone(value) as T;
  const treatAsWorkspace = options.rootKind === "workspace" ||
    (options.rootKind === undefined && isWorkspace(clone) && !isCollection(clone));
  const collections: Collection[] = treatAsWorkspace
    ? (clone as Workspace).collections
    : [clone as Collection];
  for (const collection of collections) {
    sanitizeRequests(collection.requests, options);
    sanitizeFolders(collection.folders, options);
  }
  return clone;
}

function sanitizeFolders(folders: Folder[], options: StripTransientUploadOptions): void {
  for (const folder of folders ?? []) {
    sanitizeRequests(folder.requests ?? [], options);
    sanitizeFolders(folder.folders ?? [], options);
  }
}

function sanitizeRequests(requests: ApiRequest[], options: StripTransientUploadOptions): void {
  for (const request of requests ?? []) {
    if (!Array.isArray(request.body?.multipart)) {
      continue;
    }
    request.body.multipart = request.body.multipart.map((field) => portableField(field, options));
  }
}

function portableField(
  field: MultipartField,
  options: StripTransientUploadOptions
): MultipartField {
  // Treat an unknown runtime discriminator as a file-like field: dropping its
  // value is safer than accidentally serializing imported path/content data.
  const type = field.type === "text" ? "text" : "file";
  const common = {
    id: field.id,
    key: field.key,
    enabled: type === "file" && options.disableFileFields ? false : field.enabled,
    type,
    value: type === "file" ? "" : field.value,
    description: field.description,
    contentType: field.contentType,
    isArray: field.isArray,
    required: field.required
  } satisfies MultipartField;

  if (type === "text") {
    return common;
  }

  const fileName = basenameOnly(field.fileName ?? "");
  return {
    ...common,
    type: "file",
    fileName: fileName || undefined,
    sizeBytes: field.sizeBytes
  };
}

function basenameOnly(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

function isWorkspace(value: Collection | Workspace): value is Workspace {
  return typeof value === "object" && value !== null &&
    Array.isArray((value as Workspace).collections) &&
    Array.isArray((value as Workspace).environments);
}

function isCollection(value: Collection | Workspace): value is Collection {
  return typeof value === "object" && value !== null &&
    Array.isArray((value as Collection).requests) &&
    Array.isArray((value as Collection).folders);
}
