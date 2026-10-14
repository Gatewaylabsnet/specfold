import { createId, validateConnectionProfile, type Workspace, type ConnectionProfile, type WorkflowAuth } from "@openapi-collection-studio/core";

export type SourceChoice = "existing" | "file" | "url";
export const savedProfiles = (workspace: Workspace): ConnectionProfile[] => workspace.connectionProfiles ?? [];
export function safeSourceUrl(value: string): string {
  return validateConnectionProfile({ id: "source-preview", name: "Source preview", provider: "openapi", collectionId: "source-preview",
    environmentId: "source-preview", baseUrl: "https://example.invalid", source: { kind: "url", label: value }, auth: { kind: "none" } }).source.label;
}
export function statusSummary(statuses: number[]): string {
  const remaining = new Set(statuses); const groups: string[] = [];
  for (let hundred = 1; hundred <= 5; hundred++) {
    const codes = Array.from({ length: 100 }, (_, index) => hundred * 100 + index);
    if (codes.every((code) => remaining.has(code))) { groups.push(`${hundred}xx`); codes.forEach((code) => remaining.delete(code)); }
  }
  return [...groups, ...remaining].join(", ") || "Not documented";
}
export function defaultAuth(kind: WorkflowAuth["kind"], baseUrl: string, profileId: string): WorkflowAuth {
  const variable = (name: string) => `workflow_${profileId.replace(/[^a-z0-9_]/gi, "_").slice(-64)}_${name}`;
  if (kind === "bearer") return { kind, tokenVariable: variable("accessToken") };
  if (kind === "basic") return { kind, usernameVariable: variable("username"), passwordVariable: variable("password") };
  if (kind === "apiKey") return { kind, key: "X-API-Key", in: "header", valueVariable: variable("apiKey") };
  if (kind === "apinizer") {
    let endpoint = "";
    try { endpoint = `${new URL(baseUrl).origin}/auth/jwt`; } catch { /* User supplies an endpoint. */ }
    return { kind, endpoint, usernameVariable: variable("username"), passwordVariable: variable("password"), clientIdVariable: variable("clientId"), tokenVariable: variable("accessToken") };
  }
  return { kind: "none" };
}
export function safeSaveError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    WORKSPACE_CHANGED: "The workspace changed. Retry saving to use its latest version.",
    REVISION_CONFLICT: "The workspace changed. Retry saving to use its latest version.",
    SECURE_STORAGE_REQUIRED: "Secure storage is required for authentication. Restore OS secure storage and retry.",
    DUPLICATE_AUTH_VARIABLE: "This environment has duplicate authentication variable names. Choose unique variable references in Advanced.",
    "INVALID_CONNECTION_PROFILE: baseUrl": "Use a complete HTTP or HTTPS base URL without credentials, query parameters or fragments.",
    "INVALID_CONNECTION_PROFILE: auth.endpoint": "Check the token endpoint. Credentials and secret query parameters are not allowed in its URL.",
    "INVALID_CONNECTION_PROFILE: auth.key": "Enter a valid API key header or query parameter name.",
    "INVALID_CONNECTION_PROFILE: name": "Use a profile name between 1 and 160 characters without surrounding whitespace.",
    CREDENTIAL_URL_NOT_ALLOWED: "The specification includes credentials in a URL. Remove them before importing it."
  };
  const known = Object.entries(messages).find(([key]) => code === key || code.endsWith(`: ${key}`));
  return known?.[1] ?? "Could not save the workflow. Check the connection, variable references and secure storage, then try again.";
}
export function newProfile(workspace: Workspace): ConnectionProfile {
  const collection = workspace.collections[0];
  return { id: createId("profile"), name: collection ? `${collection.name} workflow` : "My API",
    provider: "openapi", collectionId: collection?.id ?? "", environmentId: workspace.activeEnvironmentId ?? workspace.environments[0]?.id ?? "",
    baseUrl: collection?.baseUrl ?? "", source: { kind: "existing", label: collection?.name ?? "Existing collection" }, auth: { kind: "none" } };
}
export interface CredentialField { key: string; label: string; variable: string; optional?: boolean }
export function credentialFields(auth: WorkflowAuth): CredentialField[] {
  if (auth.kind === "bearer") return [{ key: "tokenVariable", label: "Bearer token", variable: auth.tokenVariable }];
  if (auth.kind === "apiKey") return [{ key: "valueVariable", label: "API key value", variable: auth.valueVariable }];
  if (auth.kind === "basic" || auth.kind === "apinizer") {
    const fields = [{ key: "usernameVariable", label: "Username", variable: auth.usernameVariable },
      { key: "passwordVariable", label: "Password", variable: auth.passwordVariable }];
    if (auth.kind === "apinizer") {
      fields.push({ key: "clientIdVariable", label: "Client ID", variable: auth.clientIdVariable });
      if (auth.clientSecretVariable) fields.push({ key: "clientSecretVariable", label: "Client secret", variable: auth.clientSecretVariable });
    }
    return fields;
  }
  return [];
}
export function validConnection(profile: ConnectionProfile, sourceText?: string): boolean {
  try {
    const url = new URL(profile.baseUrl);
    return !!profile.name.trim() && !!profile.environmentId && ["https:", "http:"].includes(url.protocol) &&
      !url.username && !url.password && !url.search && !url.hash &&
      (profile.source.kind === "existing" ? !!profile.collectionId : !!sourceText || !!profile.collectionId);
  } catch { return false; }
}
export function validAuthentication(auth: WorkflowAuth): boolean {
  const names = credentialFields(auth).map((field) => field.variable);
  if (auth.kind === "apinizer") names.push(auth.tokenVariable);
  if (names.some((name) => !/^[a-zA-Z_][\w.-]{0,127}$/.test(name))) return false;
  if (auth.kind === "apiKey" && !auth.key.trim()) return false;
  if (auth.kind === "apinizer") {
    try { const url = new URL(auth.endpoint); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
    catch { return false; }
  }
  return true;
}
