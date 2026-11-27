import {
  collectionTokenOrigin, createId, environmentToMap, findRequest, flattenRequests, isCollectionBearerToken,
  isCollectionTokenIssuer, resolveCollectionTokenRequestUrl, resolveVariablesInText, type Workspace
} from "@openapi-collection-studio/core";

function readAccessToken(raw: string): string | undefined {
  if (raw.length > 256 * 1024) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const fields = value as Record<string, unknown>;
    if (fields.token_type !== undefined && (typeof fields.token_type !== "string" || fields.token_type.toLowerCase() !== "bearer")) return undefined;
    if (fields.access_token !== undefined && fields.accessToken !== undefined && fields.access_token !== fields.accessToken) return undefined;
    const token = fields.access_token ?? fields.accessToken;
    return typeof token === "string" && isCollectionBearerToken(token) ? token : undefined;
  } catch { return undefined; }
}

/** A local manual Send can prepare a bounded, single-collection capture. */
export function prepareCollectionTokenCapture(workspace: Workspace, collectionId: string, environmentId: string,
  requestId: string, issuerOrigin: string, rawBody: string) {
  const token = readAccessToken(rawBody);
  const collection = workspace.collections.find(({ id }) => id === collectionId);
  const environment = workspace.environments.find(({ id }) => id === environmentId);
  const location = collection && findRequest(collection, requestId);
  if (!token || !collection || collection.autoTokenCaptureDisabled || !environment || workspace.activeEnvironmentId !== environmentId ||
      !location || collectionTokenOrigin(issuerOrigin) !== issuerOrigin) return undefined;
  const route = resolveCollectionTokenRequestUrl(location.request, environment, collection, location.folderPath);
  if (!route || collectionTokenOrigin(route) !== issuerOrigin || !isCollectionTokenIssuer(location.request, route)) return undefined;
  const variables = environmentToMap(environment, collection);
  if (variables.baseUrl) {
    const base = resolveVariablesInText(variables.baseUrl, variables);
    if (base.missing.length || collectionTokenOrigin(base.value) !== issuerOrigin) return undefined;
  }
  const previous = collection.autoAccessToken;
  if (previous && (previous.issuerRequestId !== requestId || previous.origin !== issuerOrigin)) return undefined;
  const variableName = previous?.variableName ?? ("specfoldCollectionAccessToken_" + createId("token").replaceAll("-", ""));
  const matches = environment.variables.filter((item) => item.name === variableName);
  if (matches.length > 1 || (matches[0] && (!matches[0].secret || !matches[0].enabled))) return undefined;

  // Refuse to overwrite a generated token if the user later shares its variable
  // with another collection, connection profile or environment variable.
  const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reference = new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`);
  if (previous && (
    workspace.collections.some((item) => item.id !== collectionId && (
      item.autoAccessToken?.variableName === variableName || reference.test(JSON.stringify(item)) ||
      flattenRequests(item).some(({ request }) => request.auth.type === "bearer" && request.auth.token === variableName))) ||
    workspace.connectionProfiles?.some((profile) => profile.environmentId === environmentId && Object.values(profile.auth).includes(variableName)) ||
    environment.variables.some((item) => item.name !== variableName && reference.test(item.value))
  )) return undefined;

  const next = structuredClone(workspace);
  const nextCollection = next.collections.find(({ id }) => id === collectionId)!;
  const nextEnv = next.environments.find(({ id }) => id === environmentId)!;
  const variable = nextEnv.variables.find((item) => item.name === variableName);
  if (variable) variable.value = token;
  else nextEnv.variables.push({ id: createId("var"), name: variableName, value: token, secret: true, enabled: true });
  nextCollection.autoAccessToken = { variableName, issuerRequestId: requestId, origin: issuerOrigin };
  next.updatedAt = new Date().toISOString();
  return next;
}
