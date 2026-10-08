import { createApinizerJwtRequest, createFolder, deriveApinizerBaseUrl, ensureWorkspaceEnvironment } from "../model/factory";
import { findFolder, findRequest, flattenRequests, folderBaseUrl } from "../model/traversal";
import type { Collection, Workspace } from "../model/types";
import { importApiDocument } from "../importers";
import { applySafeReimport, stableRequestKey } from "../importers/reimport";
import { parseApiText } from "../importers/shared";
import { agentOpenApiWarnings } from "./openApiWarnings";
import { redactAgentValue, workspaceSecrets } from "./redaction";
import type { AgentMutation, AgentProposal } from "./types";

export function requireAgentCollection(workspace: Workspace, id: string): Collection {
  const collection = workspace.collections.find((item) => item.id === id);
  if (!collection) throw new Error("COLLECTION_NOT_FOUND");
  return collection;
}

export function bindAgentBearer(collection: Collection, variableName: string, requestId?: string, folderId?: string): void {
  if (!/^[a-zA-Z_][\w.-]{0,127}$/.test(variableName)) throw new Error("INVALID_VARIABLE_NAME");
  if (requestId && folderId) throw new Error("INVALID_TARGET");
  if (folderId && !findFolder(collection, folderId)) throw new Error("FOLDER_NOT_FOUND");
  if (requestId && !findRequest(collection, requestId)) throw new Error("REQUEST_NOT_FOUND");
  for (const { request, folderPath } of flattenRequests(collection)) {
    if (requestId && request.id !== requestId) continue;
    if (folderId && !folderPath.some((folder) => folder.id === folderId)) continue;
    if (request.name === "Apinizer JWT Token" && request.url.endsWith("/auth/jwt")) continue;
    request.auth = { type: "bearer", token: `{{${variableName}}}` };
    request.headers = request.headers.filter((header) => header.key.toLowerCase() !== "authorization");
  }
  if (folderId) findFolder(collection, folderId)!.accessTokenVariable = variableName;
}

export function addAgentApinizer(collection: Collection, baseUrl?: string): void {
  const origin = deriveApinizerBaseUrl(baseUrl ?? collection.baseUrl);
  if (!origin) throw new Error("API_BASE_URL_REQUIRED");
  const existing = flattenRequests(collection).find(({ request }) =>
    request.method === "POST" && request.url === `${origin}/auth/jwt` && request.name === "Apinizer JWT Token");
  if (existing) return;
  const request = createApinizerJwtRequest();
  request.url = `${origin}/auth/jwt`;
  // No literal client secret or invented sample access token in an agent recipe.
  request.body.form = request.body.form?.filter((field) => field.key !== "client_secret");
  request.responseExamples = [];
  let folder = collection.folders.find((item) => item.name === "Authentication");
  if (!folder) { folder = createFolder("Authentication"); collection.folders.push(folder); }
  folder.baseUrl = origin;
  folder.requests.push(request);
}

export function previewAgentMutation(workspace: Workspace, input: AgentMutation): AgentProposal {
  let target: Collection | undefined;
  let collection: Collection;
  let warnings: string[] = [];
  if (input.kind === "import-openapi") {
    const parsed = parseApiText(input.text);
    warnings = agentOpenApiWarnings(parsed.document);
    const imported = importApiDocument(input.text, { grouping: "tags" });
    warnings.push(...imported.warnings);
    collection = redactAgentValue(imported.collection, workspaceSecrets(workspace));
    if (input.baseUrl) collection.baseUrl = input.baseUrl;
    validateBaseUrl(collection.baseUrl);
    target = input.targetCollectionId ? requireAgentCollection(workspace, input.targetCollectionId)
      : workspace.collections.find((item) => item.name === collection.name && item.baseUrl === collection.baseUrl);
    if (target) {
      const merged = structuredClone(target);
      applySafeReimport(merged, collection);
      collection = merged;
    }
    if (input.apinizer) {
      addAgentApinizer(collection);
      bindAgentBearer(collection, "apinizerAuthAccessToken");
    }
  } else {
    target = requireAgentCollection(workspace, input.collectionId);
    collection = structuredClone(target);
    if (input.kind === "bind-bearer") bindAgentBearer(collection, input.variableName, input.requestId, input.folderId);
    else { validateBaseUrl(input.baseUrl); addAgentApinizer(collection, input.baseUrl); }
  }
  const oldRequests = new Map(target ? flattenRequests(target).map(({ request }) => [request.id, request]) : []);
  const added: string[] = [], changed: string[] = [];
  for (const { request } of flattenRequests(collection)) {
    if (!oldRequests.has(request.id)) added.push(stableRequestKey(request));
    else if (JSON.stringify(oldRequests.get(request.id)) !== JSON.stringify(request)) changed.push(stableRequestKey(request));
  }
  // This is an internal proposal; transports expose only redacted summaries
  // and store the action, never this complete target collection, in plan files.
  return {
    collection, targetCollectionId: target?.id, warnings: redactAgentValue(warnings, workspaceSecrets(workspace)),
    diff: { added, changed, retained: oldRequests.size - changed.length, requestCount: flattenRequests(collection).length }
  };
}

export function applyAgentProposal(workspace: Workspace, proposal: AgentProposal): Workspace {
  const next = structuredClone(workspace);
  const index = next.collections.findIndex((collection) => collection.id === proposal.targetCollectionId);
  if (proposal.targetCollectionId && index < 0) throw new Error("COLLECTION_NOT_FOUND");
  if (index >= 0) next.collections[index] = proposal.collection;
  else next.collections.push(proposal.collection);
  next.updatedAt = new Date().toISOString();
  return ensureWorkspaceEnvironment(next);
}

export function validateAgentCollection(workspace: Workspace, id: string) {
  const collection = requireAgentCollection(workspace, id);
  const variables = new Map(workspace.environments.find((env) => env.id === workspace.activeEnvironmentId)?.variables
    .map((variable) => [variable.name, variable]) ?? []);
  const issues: string[] = [];
  const keys = new Set<string>();
  for (const { request, folderPath } of flattenRequests(collection)) {
    const key = stableRequestKey(request);
    if (keys.has(key)) issues.push(`Duplicate operation: ${key}`);
    keys.add(key);
    for (const match of JSON.stringify(request).matchAll(/\{\{([\w.-]+)\}\}/g)) {
      if (match[1] === "baseUrl" && (folderBaseUrl(folderPath) || collection.baseUrl)) continue;
      const variable = variables.get(match[1]);
      if (!variable || !variable.enabled || !variable.value) issues.push(`Variable needs configuration: ${match[1]}`);
    }
  }
  return redactAgentValue({ valid: issues.length === 0, issues: [...new Set(issues)], requestCount: keys.size }, workspaceSecrets(workspace));
}

function validateBaseUrl(value?: string): void {
  if (!value) return;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
  } catch (error) { throw new Error("INVALID_API_BASE_URL", { cause: error }); }
}
