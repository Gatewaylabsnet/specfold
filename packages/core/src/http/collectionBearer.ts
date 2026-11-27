import type { ApiRequest, Collection, Environment, EnvironmentVariable, Folder } from "../model/types";
import { folderAccessTokenVariable } from "../model/traversal";
import { environmentToMap, resolveKeyValues, resolveVariablesInText } from "../variables/resolveVariables";
import { resolveRelativeUrl, substitutePathParams } from "./requestRoute";

type CollectionRoute = Pick<Collection, "baseUrl" | "autoAccessToken" | "autoTokenCaptureDisabled">;
type FolderRoute = Pick<Folder, "baseUrl" | "accessTokenVariable">;

export function collectionTokenOrigin(url: string): string | undefined {
  if (!/^https?:\/\//i.test(url)) return undefined;
  try {
    const parsed = new URL(url);
    const loopback = parsed.hostname === "localhost" || parsed.hostname === "[::1]" ||
      /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(parsed.hostname);
    return !parsed.username && !parsed.password && (parsed.protocol === "https:" || (parsed.protocol === "http:" && loopback))
      ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

/** OAuth Bearer's opaque token syntax; never interpret captured data as templates. */
export function isCollectionBearerToken(value: unknown): value is string {
  return typeof value === "string" && value.length <= 16 * 1024 && /^[A-Za-z0-9._~+/-]+=*$/.test(value);
}

/** Restrict automatic capture to the known JWT/OpenID/OAuth routes and POST. */
export function isCollectionTokenIssuer(request: Pick<ApiRequest, "method" | "url" | "body">, resolvedUrl?: string): boolean {
  if (request.method !== "POST") return false;
  const input = resolvedUrl ?? request.url;
  let route = input.split(/[?#]/, 1)[0];
  if (collectionTokenOrigin(input)) route = new URL(input).pathname;
  try { route = decodeURIComponent(route); } catch { return false; }
  if (/\/(?:auth\/(?:token|jwt)|oauth2?\/token|connect\/token|protocol\/openid-connect\/token)\/?$/i.test(route)) return true;
  return /\/token\/?$/i.test(route) && request.body.mode === "form" &&
    Boolean(request.body.form?.some(({ key, value, enabled }) =>
      enabled && key === "grant_type" && /^(?:password|client_credentials|refresh_token|authorization_code)$/.test(value)));
}

/** Resolve the route exactly as the sender does without preparing or using auth. */
export function resolveCollectionTokenRequestUrl(
  request: Pick<ApiRequest, "url" | "pathParams">,
  environment?: Environment,
  collection?: CollectionRoute,
  folderPath: readonly FolderRoute[] = []
): string | undefined {
  const variables = environmentToMap(environment, collection, folderPath);
  const resolved = resolveVariablesInText(request.url, variables);
  const path = resolveKeyValues(request.pathParams.filter((param) => param.enabled), variables);
  if (resolved.missing.length || path.missing.length) return undefined;
  try {
    return resolveRelativeUrl(substitutePathParams(resolved.value, path.values), environment, collection, folderPath);
  } catch {
    return undefined;
  }
}

/** Only the actual HTTP request builder may use the returned token value. */
export function collectionBearerAtRoute(
  request: ApiRequest,
  url: string,
  environment?: Environment,
  collection?: CollectionRoute,
  folderPath: readonly FolderRoute[] = []
): EnvironmentVariable | undefined {
  const binding = collection?.autoAccessToken;
  if (!binding || (collection?.autoTokenCaptureDisabled ?? false) !== false ||
      typeof binding.issuerRequestId !== "string" || !binding.issuerRequestId ||
      typeof binding.variableName !== "string" || !/^[A-Za-z_][\w.-]{0,127}$/.test(binding.variableName) ||
      ["__proto__", "prototype", "constructor"].includes(binding.variableName) ||
      request.auth.type !== "none" || request.id === binding.issuerRequestId ||
      folderAccessTokenVariable(folderPath) || isCollectionTokenIssuer(request, url) ||
      request.headers.some(({ key, enabled }) => enabled && ["authorization", "host", ":authority"].includes(key.trim().toLowerCase()))) {
    return undefined;
  }

  const origin = collectionTokenOrigin(url);
  if (!origin || origin !== binding.origin) return undefined;
  const matching = environment?.variables.filter(({ name }) => name.trim() === binding.variableName);
  if (matching?.length !== 1) return undefined;
  const [variable] = matching;
  return variable.enabled && variable.secret === true && isCollectionBearerToken(variable.value) ? variable : undefined;
}

/** UI-safe policy check: return only the name, never the resolved token. */
export function collectionBearerForRequest(
  request: ApiRequest,
  environment?: Environment,
  collection?: CollectionRoute,
  folderPath: readonly FolderRoute[] = []
): string | undefined {
  if (!collection?.autoAccessToken || collection.autoTokenCaptureDisabled) return undefined;
  const url = resolveCollectionTokenRequestUrl(request, environment, collection, folderPath);
  if (!url) return undefined;
  const resolved = resolveKeyValues(request.headers.filter(({ enabled }) => enabled)
    .map((header) => ({ ...header, value: "" })), environmentToMap(environment, collection, folderPath));
  if (resolved.missing.length) return undefined;
  return collectionBearerAtRoute({ ...request, headers: resolved.values }, url, environment, collection, folderPath)?.name.trim();
}
