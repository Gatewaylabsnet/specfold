import type { ApiRequest, Folder } from "@openapi-collection-studio/core";

export function requestMatches(request: ApiRequest, query: string): boolean {
  return request.name.toLowerCase().includes(query) ||
    request.url.toLowerCase().includes(query) ||
    request.method.toLowerCase().includes(query);
}

export function folderMatchCount(folder: Folder, query: string): number {
  let count = folder.requests.filter((request) => requestMatches(request, query)).length;
  for (const child of folder.folders) count += folderMatchCount(child, query);
  return count;
}
