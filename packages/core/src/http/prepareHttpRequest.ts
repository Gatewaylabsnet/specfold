import type {
  ApiRequest,
  Collection,
  Environment,
  Folder,
  KeyValue,
  MultipartField
} from "../model/types";
import { resolveRequestVariables } from "../variables/resolveVariables";
import { collectionBearerAtRoute } from "./collectionBearer";
import { MissingVariablesError, resolveRelativeUrl, substitutePathParams } from "./requestRoute";

export { MissingVariablesError } from "./requestRoute";

export interface PreparedHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  multipart?: MultipartField[];
  collectionTokenApplied?: true;
}

export function prepareHttpRequest(
  request: ApiRequest,
  environment?: Environment,
  collection?: Pick<Collection, "baseUrl" | "autoAccessToken" | "autoTokenCaptureDisabled">,
  folderPath: readonly Pick<Folder, "baseUrl" | "accessTokenVariable">[] = [],
  options: { allowCollectionToken?: boolean } = {}
): PreparedHttpRequest {
  const resolved = resolveRequestVariables(request, environment, collection, folderPath);
  if (resolved.missing.length > 0) {
    throw new MissingVariablesError(resolved.missing);
  }

  const requestWithPathParams = { ...resolved.request, url: substitutePathParams(resolved.request.url, resolved.request.pathParams) };
  const url = appendQueryParams(
    resolveRelativeUrl(requestWithPathParams.url, environment, collection, folderPath),
    requestWithPathParams.queryParams
  );
  const headers = keyValuesToHeaders(requestWithPathParams.headers);
  // A plain prepare call (MCP, workflow or export) must not inherit a desktop secret.
  const automatic = options.allowCollectionToken === true
    ? collectionBearerAtRoute(requestWithPathParams, url, environment, collection, folderPath)
    : undefined;
  if (automatic) setHeader(headers, "Authorization", `Bearer ${automatic.value}`);

  if (requestWithPathParams.auth.type === "bearer") {
    deleteHeader(headers, "authorization");
    const token = requestWithPathParams.auth.token.trim();
    if (token) {
      setHeader(headers, "Authorization", `Bearer ${token}`);
    }
  }
  if (requestWithPathParams.auth.type === "basic") {
    const token = encodeBase64(
      `${requestWithPathParams.auth.username}:${requestWithPathParams.auth.password}`
    );
    setHeader(headers, "Authorization", `Basic ${token}`);
  }
  if (requestWithPathParams.auth.type === "apiKey" && requestWithPathParams.auth.in === "header") {
    const key = requestWithPathParams.auth.key.trim();
    if (key) {
      setHeader(headers, key, requestWithPathParams.auth.value);
    }
  }

  let body = requestWithPathParams.body.raw;
  let multipart: MultipartField[] | undefined;
  if (requestWithPathParams.body.mode === "form") {
    const pairs = (requestWithPathParams.body.form ?? []).filter((item) => item.enabled && item.key);
    body = pairs
      .map((item) => `${encodeURIComponent(item.key)}=${encodeURIComponent(item.value)}`)
      .join("&");
    if (!hasHeader(headers, "content-type")) {
      setHeader(
        headers,
        "Content-Type",
        requestWithPathParams.body.contentType ?? "application/x-www-form-urlencoded"
      );
    }
  }
  if (requestWithPathParams.body.mode === "multipart") {
    multipart = (requestWithPathParams.body.multipart ?? []).filter(
      (field) => field.enabled && field.key.trim()
    );
    body = undefined;
    deleteHeader(headers, "content-type");
  }
  if (
    requestWithPathParams.body.mode === "none" ||
    requestWithPathParams.method === "GET" ||
    requestWithPathParams.method === "HEAD"
  ) {
    body = undefined;
    multipart = undefined;
  }
  if (requestWithPathParams.body.mode === "json" && requestWithPathParams.body.contentType) {
    if (!hasHeader(headers, "content-type")) {
      setHeader(headers, "Content-Type", requestWithPathParams.body.contentType);
    }
  }

  return {
    url: appendApiKeyQuery(url, requestWithPathParams),
    method: requestWithPathParams.method,
    headers,
    body,
    multipart,
    ...(automatic ? { collectionTokenApplied: true as const } : {})
  };
}

function appendQueryParams(urlInput: string, queryParams: KeyValue[]): string {
  const enabled = queryParams.filter((item) => item.enabled && item.key);
  if (enabled.length === 0) {
    return urlInput;
  }

  const url = createUrl(urlInput);
  for (const param of enabled) {
    url.searchParams.set(param.key, param.value);
  }
  return normalizeUrl(urlInput, url);
}

function appendApiKeyQuery(urlInput: string, request: ApiRequest): string {
  if (request.auth.type !== "apiKey" || request.auth.in !== "query") {
    return urlInput;
  }
  const key = request.auth.key.trim();
  if (!key) {
    return urlInput;
  }
  const url = createUrl(urlInput);
  url.searchParams.set(key, request.auth.value);
  return normalizeUrl(urlInput, url);
}

function createUrl(urlInput: string): URL {
  if (/^https?:\/\//i.test(urlInput)) {
    return new URL(urlInput);
  }
  return new URL(urlInput.startsWith("/") ? `http://localhost${urlInput}` : `http://localhost/${urlInput}`);
}

function normalizeUrl(original: string, url: URL): string {
  if (/^https?:\/\//i.test(original)) {
    return url.toString();
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function keyValuesToHeaders(values: KeyValue[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const item of values) {
    if (item.enabled && item.key) {
      headers[item.key] = item.value;
    }
  }
  return headers;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

function setHeader(headers: Record<string, string>, name: string, value: string): void {
  deleteHeader(headers, name);
  headers[name] = value;
}

function deleteHeader(headers: Record<string, string>, name: string): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      delete headers[key];
    }
  }
}

function encodeBase64(value: string): string {
  // Basic auth credentials may contain non-Latin1 characters (e.g. Turkish
  // ş/ğ/ı). Encode as UTF-8 first per RFC 7617 so btoa does not throw.
  const maybeBuffer = (globalThis as unknown as {
    Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } };
  }).Buffer;
  if (maybeBuffer) {
    return maybeBuffer.from(value, "utf8").toString("base64");
  }
  if (typeof btoa === "function" && typeof TextEncoder === "function") {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }
  throw new Error("Base64 encoding is not available in this runtime.");
}
