import { findRequest, flattenRequests, type ApiRequest, type ConnectionProfile, type WorkflowAuth, type Workspace } from "@openapi-collection-studio/core";
import { environmentBaseUrl } from "../helpers";
import { defaultAuth, newProfile } from "./model";

export interface WorkflowStartContext { collectionId?: string; requestId?: string }
export interface WorkflowStart { profile: ConnectionProfile; credentials: Record<string, string>; note?: string; requiresAuthChoice?: boolean }
const reference = (value: string) => /^\{\{([A-Za-z_][\w.-]{0,127})\}\}$/.exec(value.trim())?.[1];
const tokenRequest = (request: ApiRequest) => /\/(?:auth\/jwt|(?:oauth2?\/)?token)(?:[?#]|$)/i.test(request.url);

export function workflowStart(workspace: Workspace, context?: WorkflowStartContext): WorkflowStart {
  const fallback = newProfile(workspace);
  if (!context) return { profile: fallback, credentials: {} };
  const collection = workspace.collections.find((item) => item.id === context.collectionId);
  if (!collection) return { profile: fallback, credentials: {} };
  const environment = workspace.environments.find((item) => item.id === workspace.activeEnvironmentId) ?? workspace.environments[0];
  const saved = workspace.connectionProfiles?.filter((item) => item.collectionId === collection.id && item.environmentId === environment?.id);
  const requests = flattenRequests(collection).map((item) => item.request).filter((request) => !tokenRequest(request));
  const selected = context.requestId ? findRequest(collection, context.requestId)?.request : undefined;
  const request = selected && !tokenRequest(selected) ? selected : requests.find((item) => item.auth.type !== "none");
  const profile = { ...fallback, name: `${collection.name} checks`, collectionId: collection.id,
    environmentId: environment?.id ?? fallback.environmentId,
    baseUrl: collection.baseUrl || (environment ? environmentBaseUrl(environment) : ""),
    source: { kind: "existing" as const, label: collection.name } };
  const credentials: Record<string, string> = {};
  let auth = request?.auth;
  const authorization = request?.headers.find((header) => header.enabled && header.key.toLowerCase() === "authorization")?.value;
  if (auth?.type === "none" && authorization?.match(/^Bearer\s+(.+)$/i)) {
    auth = { type: "bearer", token: authorization.replace(/^Bearer\s+/i, "") };
  }
  let requiresAuthChoice = !!authorization && auth?.type === "none";
  const kind = auth?.type ?? "none";
  const defaults = defaultAuth(kind === "apiKey" ? "apiKey" : kind, profile.baseUrl, profile.id);
  function binding(value: string, generated: string): string {
    const existing = reference(value);
    if (existing) return existing;
    if (value.includes("{{")) { requiresAuthChoice = true; return generated; }
    // Keep literals in a private save draft, never in credential inputs/profile metadata.
    if (value) credentials[generated] = value;
    return generated;
  }
  let seeded: WorkflowAuth = { kind: "none" };
  if (auth?.type === "bearer" && defaults.kind === "bearer") seeded = { kind: "bearer", tokenVariable: binding(auth.token, defaults.tokenVariable) };
  if (auth?.type === "basic" && defaults.kind === "basic") seeded = { kind: "basic",
    usernameVariable: binding(auth.username, defaults.usernameVariable), passwordVariable: binding(auth.password, defaults.passwordVariable) };
  if (auth?.type === "apiKey" && defaults.kind === "apiKey") seeded = { kind: "apiKey", key: auth.key, in: auth.in,
    valueVariable: binding(auth.value, defaults.valueVariable) };
  profile.auth = seeded;
  if (!requiresAuthChoice && saved?.length === 1 && (JSON.stringify(saved[0].auth) === JSON.stringify(seeded) ||
    (!request || kind === "none") || (saved[0].auth.kind === "apinizer" && seeded.kind === "bearer" && saved[0].auth.tokenVariable === seeded.tokenVariable))) {
    return { profile: structuredClone(saved[0]), credentials: {},
      note: "Using the saved test setup for the selected API and environment. Review its authentication before running." };
  }
  const mixed = requests.some((item) => JSON.stringify(item.auth) !== JSON.stringify(request?.auth ?? { type: "none" }));
  return { profile, credentials, requiresAuthChoice, note: request && kind !== "none"
    ? `Using the selected API's ${kind} authentication. It applies to this setup's execution copies.${mixed ? " Some saved requests have different authentication; review the preview." : ""}`
    : "No authentication is selected. Choose how this API should authenticate before reviewing tests." };
}

export function blankWorkflow(workspace: Workspace): WorkflowStart {
  return { profile: { ...newProfile(workspace), name: "My API", collectionId: "", baseUrl: "",
    source: { kind: "file", label: "" }, auth: { kind: "none" } }, credentials: {} };
}
