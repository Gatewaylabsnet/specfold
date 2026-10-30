import { createId, findFolder, flattenRequests, redactAgentValue, workspaceSecrets, type Workspace } from "@openapi-collection-studio/core";
import { extractJsonPath } from "./helpers";

export interface TokenBindingIntent {
  collectionId: string; environmentId: string; sourceRequestId: string;
  folderId?: string; path: string; variableName: string; requestIds: string[];
}
export interface TokenBindingRow {
  id: string; name: string; method: string; route: string; previousAuth: string;
  excluded: boolean; recommended: boolean;
}
export interface TokenBindingReview {
  rows: TokenBindingRow[]; scopeName: string; environmentName: string; variableName: string;
  replacesVariable: boolean;
  matches(workspace: Workspace): boolean;
  apply(workspace: Workspace): Workspace;
}

/** Enumerate field names only; credential values never enter the picker/preview. */
export function responseTokenFields(body: string): string[] {
  const paths: string[] = []; let visited = 0;
  function walk(value: unknown, prefix = "", depth = 0) {
    if (depth > 8 || ++visited > 2000 || paths.length >= 50 || !value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (++visited > 2000) break;
      if (!/^[\w-]{1,64}$/.test(key) || ["__proto__", "prototype", "constructor"].includes(key)) continue;
      const next = prefix ? `${prefix}.${key}` : key;
      if (typeof child === "string" && child.trim() && /^(access[_-]?token|id[_-]?token|token|jwt)$/i.test(key)) paths.push(next);
      else if (child && typeof child === "object") walk(child, next, depth + 1);
      if (paths.length >= 50) break;
    }
  }
  try { walk(JSON.parse(body)); } catch { /* Advanced path remains available. */ }
  return paths;
}

function targets(workspace: Workspace, intent: TokenBindingIntent, body = ""): TokenBindingRow[] {
  const collection = workspace.collections.find((item) => item.id === intent.collectionId);
  if (!collection || (intent.folderId && !findFolder(collection, intent.folderId))) throw new Error("Choose an available collection or folder.");
  const captured = extractJsonPath(body, intent.path);
  const secrets = [...workspaceSecrets(workspace), ...(typeof captured === "string" ? [captured] : [])];
  return flattenRequests(collection).filter(({ folderPath }) => !intent.folderId || folderPath.some((folder) => folder.id === intent.folderId))
    .map(({ request }) => {
      const excluded = request.id === intent.sourceRequestId || /\/(?:auth\/jwt|(?:oauth2?\/)?token)(?:[?#]|$)/i.test(request.url);
      const customAuthorization = request.headers.some((header) => header.enabled && header.key.toLowerCase() === "authorization");
      // Strip query/fragment entirely: URLs can contain credentials unrelated to auth fields.
      const route = redactAgentValue(request.url.split(/[?#]/)[0].replace(/\/\/[^/@]+@/, "//[redacted]@"), secrets);
      return { id: request.id, name: redactAgentValue(request.name, secrets), method: request.method, route,
        previousAuth: customAuthorization ? "Authorization header" : request.auth.type,
        excluded, recommended: !excluded && !customAuthorization && ["none", "bearer"].includes(request.auth.type) };
    });
}

export function tokenBindingTargets(workspace: Workspace, intent: TokenBindingIntent, body = ""): TokenBindingRow[] {
  try { return targets(workspace, intent, body); } catch { return []; }
}

/** Private closure retains the snapshot/value; serializable review metadata contains neither. */
export function prepareTokenBinding(workspace: Workspace, body: string, intent: TokenBindingIntent): TokenBindingReview {
  intent = structuredClone(intent);
  if (!/^[A-Za-z_][\w.-]{0,127}$/.test(intent.variableName) || ["__proto__", "prototype", "constructor"].includes(intent.variableName)) {
    throw new Error("Choose a valid token variable name.");
  }
  const token = extractJsonPath(body, intent.path);
  if (typeof token !== "string" || !token.trim() || token.length > 64 * 1024 || /[\r\n\0]/.test(token)) throw new Error("Select a field containing a non-empty, single-line token string.");
  if (intent.variableName === token) throw new Error("Use a variable name, not the credential value.");
  const environment = workspace.environments.find((item) => item.id === intent.environmentId);
  if (!environment) throw new Error("Choose an available environment.");
  const existing = environment.variables.filter((item) => item.name === intent.variableName);
  if (existing.length > 1) throw new Error("Resolve duplicate token variable names before binding.");
  const rows = targets(workspace, intent, body);
  const ids = new Set(intent.requestIds);
  if (!ids.size || ids.size !== intent.requestIds.length || [...ids].some((id) => !rows.some((row) => row.id === id && !row.excluded))) {
    throw new Error("Select the requests to receive this token. Token endpoints are excluded.");
  }
  const collection = workspace.collections.find((item) => item.id === intent.collectionId)!;
  if (existing[0] && existing[0].value !== token) {
    const reference = `{{${intent.variableName}}}`;
    const outside = workspace.collections.some((item) => flattenRequests(item).some(({ request }) =>
      !(item.id === collection.id && ids.has(request.id)) && JSON.stringify(request).includes(reference)));
    const sharedSetup = workspace.connectionProfiles?.some((profile) => profile.environmentId === environment.id &&
      Object.values(profile.auth).includes(intent.variableName));
    const alias = environment.variables.some((variable) => variable.name !== intent.variableName && variable.value.includes(reference));
    if (outside || sharedSetup || alias) throw new Error("This variable is shared outside the selected requests. Choose a new variable name in Advanced to keep other requests and setups unchanged.");
  }
  const snapshot = JSON.stringify(workspace);
  const secretSafe = <T,>(value: T): T => redactAgentValue(value, [...workspaceSecrets(workspace), token]);
  return {
    rows: secretSafe(rows.filter((row) => ids.has(row.id))),
    scopeName: secretSafe(intent.folderId ? findFolder(collection, intent.folderId)!.name : collection.name),
    environmentName: secretSafe(environment.name), variableName: intent.variableName,
    replacesVariable: existing.length === 1,
    matches: (current) => JSON.stringify(current) === snapshot,
    apply(current) {
      if (JSON.stringify(current) !== snapshot) throw new Error("The workspace changed. Review the token binding again.");
      const next = structuredClone(current);
      const target = next.collections.find((item) => item.id === intent.collectionId)!;
      const env = next.environments.find((item) => item.id === intent.environmentId)!;
      const variable = env.variables.find((item) => item.name === intent.variableName);
      if (variable) Object.assign(variable, { value: token, enabled: true, secret: true });
      else env.variables.push({ id: createId("var"), name: intent.variableName, value: token, enabled: true, secret: true });
      for (const { request } of flattenRequests(target)) if (ids.has(request.id)) {
        if (request.auth.type === "apiKey") {
          const { key, in: location } = request.auth;
          if (location === "header") request.headers = request.headers.filter((header) => header.key.toLowerCase() !== key.toLowerCase());
          else request.queryParams = request.queryParams.filter((field) => field.key !== key);
        }
        request.auth = { type: "bearer", token: `{{${intent.variableName}}}` };
        request.headers = request.headers.filter((header) => header.key.toLowerCase() !== "authorization");
      }
      next.updatedAt = new Date().toISOString();
      return next;
    }
  };
}
