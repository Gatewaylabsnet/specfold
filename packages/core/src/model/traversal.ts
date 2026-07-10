import type { ApiRequest, Collection, Folder } from "./types";

export interface RequestWithLocation {
  request: ApiRequest;
  collection: Collection;
  folder?: Folder;
  folderPath: Folder[];
}

export interface FolderWithPath {
  folder: Folder;
  path: Folder[];
}

export function visitFolders(
  folders: Folder[],
  visitor: (folder: Folder, path: Folder[]) => void,
  parentPath: Folder[] = []
): void {
  for (const folder of folders) {
    const path = [...parentPath, folder];
    visitor(folder, path);
    visitFolders(folder.folders, visitor, path);
  }
}

export function flattenFolders(collection: Collection): FolderWithPath[] {
  const result: FolderWithPath[] = [];
  visitFolders(collection.folders, (folder, path) => result.push({ folder, path }));
  return result;
}

export function flattenRequests(collection: Collection): RequestWithLocation[] {
  const result: RequestWithLocation[] = collection.requests.map((request) => ({
    request,
    collection,
    folderPath: []
  }));

  visitFolders(collection.folders, (folder, folderPath) => {
    for (const request of folder.requests) {
      result.push({ request, collection, folder, folderPath });
    }
  });

  return result;
}

export function findFolder(collection: Collection, folderId: string): Folder | undefined {
  let found: Folder | undefined;
  visitFolders(collection.folders, (folder) => {
    if (folder.id === folderId) {
      found = folder;
    }
  });
  return found;
}

export function findRequest(collection: Collection, requestId: string): RequestWithLocation | undefined {
  return flattenRequests(collection).find(({ request }) => request.id === requestId);
}

export function removeRequest(collection: Collection, requestId: string): ApiRequest | undefined {
  const rootIndex = collection.requests.findIndex((request) => request.id === requestId);
  if (rootIndex >= 0) {
    return collection.requests.splice(rootIndex, 1)[0];
  }

  let removed: ApiRequest | undefined;
  visitFolders(collection.folders, (folder) => {
    if (removed) {
      return;
    }
    const index = folder.requests.findIndex((request) => request.id === requestId);
    if (index >= 0) {
      removed = folder.requests.splice(index, 1)[0];
    }
  });

  return removed;
}

