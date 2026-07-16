import { createId, findRequest, flattenRequests } from "@openapi-collection-studio/core";
import type { AuthConfig, Collection, Environment, EnvironmentVariable } from "@openapi-collection-studio/core";
import type { SaveStatus } from "./types";

export function authForType(type: AuthConfig["type"]): AuthConfig {
  if (type === "bearer") {
    return { type, token: "{{accessToken}}" };
  }
  if (type === "basic") {
    return { type, username: "{{username}}", password: "{{password}}" };
  }
  if (type === "apiKey") {
    return { type, in: "header", key: "X-API-Key", value: "{{apiKey}}" };
  }
  return { type: "none" };
}

export function activeRequestFolderId(collection: Collection | undefined, requestId: string): string | undefined {
  if (!collection) {
    return undefined;
  }
  return findRequest(collection, requestId)?.folder?.id;
}

export function isBaseUrlVariable(variable: Pick<EnvironmentVariable, "name">): boolean {
  return variable.name.trim() === "baseUrl";
}

export function environmentBaseUrl(environment: Environment): string {
  return environment.variables.find(isBaseUrlVariable)?.value ?? "";
}

export function applyEnvironmentBaseUrlToCollection(
  collection: Collection,
  environment: Environment | undefined
): void {
  const baseUrl = environment ? environmentBaseUrl(environment).trim() : "";
  if (baseUrl) {
    collection.baseUrl = baseUrl;
  }
}

export function upsertEnvironmentBaseUrl(environment: Environment, value: string): void {
  const nextValue = value.trim();
  const existing = environment.variables.find(isBaseUrlVariable);
  const customVariables = environment.variables.filter((variable) => !isBaseUrlVariable(variable));
  if (!nextValue) {
    environment.variables = customVariables;
    return;
  }
  const baseUrl = existing ?? createEnvironmentVariable("baseUrl", nextValue);
  baseUrl.name = "baseUrl";
  baseUrl.value = nextValue;
  baseUrl.enabled = true;
  baseUrl.secret = false;
  environment.variables = [baseUrl, ...customVariables];
}

export function replaceEnvironmentCustomVariables(
  environment: Environment,
  variables: EnvironmentVariable[]
): void {
  const baseUrl = environment.variables.find(isBaseUrlVariable) ?? variables.find(isBaseUrlVariable);
  const customVariables = variables.filter((variable) => !isBaseUrlVariable(variable));
  environment.variables = baseUrl ? [baseUrl, ...customVariables] : customVariables;
}

export function firstRequestId(collection: Collection): string | undefined {
  return flattenRequests(collection)[0]?.request.id;
}

export function createEnvironmentVariable(name: string, value: string): EnvironmentVariable {
  return {
    id: createId("var"),
    name,
    value,
    enabled: true,
    secret: name.toLowerCase().includes("token") || name.toLowerCase().includes("password")
  };
}

export function saveStatusLabel(status: SaveStatus): string {
  if (status === "dirty") {
    return "Unsaved";
  }
  if (status === "saving") {
    return "Saving";
  }
  if (status === "error") {
    return "Save failed";
  }
  return "Saved";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatHistoryTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function tabLabel(tab: string): string {
  if (tab === "raw") {
    return "Raw";
  }
  return tab.charAt(0).toUpperCase() + tab.slice(1);
}

export function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

/**
 * Read a dotted/bracketed path (e.g. "data.token", "items[0].id") out of a
 * JSON response body. Returns undefined when the body is not JSON or the path
 * does not resolve.
 */
export function extractJsonPath(body: string, path: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }

  const segments = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  let current: unknown = parsed;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }
    return undefined;
  }
  return current;
}
