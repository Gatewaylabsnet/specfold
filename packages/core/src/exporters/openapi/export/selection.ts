import type { ApiRequest, Collection, Folder } from "../../../model/types";
import { findFolder, flattenRequests } from "../../../model/traversal";
import type { RequestExportItem } from "./types";

export function openApiVersion(collection: Collection): string {
  const source = collection.openApi?.documentVersion;
  // Preserve a 3.x source version (3.0.x / 3.1.x) so 3.1-only constructs stay
  // valid; anything else (e.g. Swagger "2.0") is normalized to 3.0.3.
  if (typeof source === "string" && /^3\.\d/.test(source)) {
    return source;
  }
  return "3.0.3";
}

export function selectRequests(collection: Collection, folderIds?: string[]): RequestExportItem[] {
  if (!folderIds || folderIds.length === 0) {
    return flattenRequests(collection).map(({ request, folderPath }) => ({
      request,
      folderPath
    }));
  }

  const selected = new Map<string, RequestExportItem>();
  for (const folderId of folderIds) {
    const folder = findFolder(collection, folderId);
    if (!folder) {
      continue;
    }
    collectFolderRequests(folder, [folder], (request, folderPath) => {
      selected.set(request.id, { request, folderPath });
    });
  }
  return [...selected.values()];
}

export function collectFolderRequests(
  folder: Folder,
  path: Folder[],
  visitor: (request: ApiRequest, folderPath: Folder[]) => void
): void {
  folder.requests.forEach((request) => visitor(request, path));
  for (const child of folder.folders) {
    collectFolderRequests(child, [...path, child], visitor);
  }
}

