import { createEnvironment, createKeyValue } from "../../model/factory";
import type { AuthConfig, Collection, Environment, EnvironmentVariable, Folder, HttpMethod, KeyValue, RequestBody } from "../../model/types";
import { asArray, asRecord, asString } from "../shared";
import type { SourceTextFormat } from "../types";
import type { ImportDocumentKind, ImportDocumentPreview } from "./types";

const SUPPORTED_METHODS = new Set<HttpMethod>(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

export function decodeBase64(value: string): string {
  const maybeBuffer = (globalThis as unknown as {
    Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } };
  }).Buffer;
  if (maybeBuffer) {
    return maybeBuffer.from(value, "base64").toString("utf8");
  }
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function harRequestName(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export function authFromHeaders(headers: KeyValue[]): AuthConfig {
  const header = headers.find((item) => item.key.toLowerCase() === "authorization");
  const bearer = header ? /^Bearer\s+(.+)$/i.exec(header.value) : undefined;
  if (bearer) {
    return { type: "bearer", token: bearer[1] };
  }
  const basic = header ? /^Basic\s+(.+)$/i.exec(header.value) : undefined;
  if (basic && !basic[1].includes("{{")) {
    try {
      const decoded = decodeBase64(basic[1]);
      const separator = decoded.indexOf(":");
      if (separator >= 0) {
        return {
          type: "basic",
          username: decoded.slice(0, separator),
          password: decoded.slice(separator + 1)
        };
      }
    } catch {
      // Keep a malformed Basic header as an ordinary header.
    }
  }
  return { type: "none" };
}

export function splitUrl(input: string): { url: string; queryParams: KeyValue[]; pathParams: KeyValue[] } {
  const hashIndex = input.indexOf("#");
  const withoutHash = hashIndex >= 0 ? input.slice(0, hashIndex) : input;
  const questionIndex = withoutHash.indexOf("?");
  if (questionIndex < 0) {
    return { url: withoutHash, queryParams: [], pathParams: [] };
  }
  const query = withoutHash.slice(questionIndex + 1);
  const queryParams = query
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const separator = pair.indexOf("=");
      const key = separator >= 0 ? pair.slice(0, separator) : pair;
      const value = separator >= 0 ? pair.slice(separator + 1) : "";
      return createKeyValue(safeDecode(key), safeDecode(value));
    });
  return { url: withoutHash.slice(0, questionIndex), queryParams, pathParams: [] };
}

export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

export function keyValues(
  input: unknown,
  keyName: string,
  valueName: string,
  normalize: (value: string) => string = (value) => value
): KeyValue[] {
  return asArray(input).flatMap((itemInput) => {
    const item = asRecord(itemInput);
    const key = asString(item[keyName]) ?? asString(item.key) ?? asString(item.name);
    if (!key) {
      return [];
    }
    const result = createKeyValue(
      normalize(key),
      normalize(scalarText(item[valueName])),
      descriptionText(item.description)
    );
    result.enabled = item.disabled !== true;
    return [result];
  });
}

export function portableFormFields(
  input: unknown,
  keyName: string,
  valueName: string,
  normalize: (value: string) => string = (value) => value
): KeyValue[] {
  return asArray(input).flatMap((itemInput) => {
    const item = asRecord(itemInput);
    const key = asString(item[keyName]) ?? asString(item.key) ?? asString(item.name);
    if (!key) {
      return [];
    }
    const isFile = item.type === "file";
    const fileValue = Array.isArray(item.src)
      ? item.src.map((value) => fileNameOnly(scalarText(value))).join(", ")
      : fileNameOnly(scalarText(item.src ?? item.fileName));
    const field = createKeyValue(
      normalize(key),
      normalize(isFile ? fileValue : scalarText(item[valueName])),
      isFile
        ? "File field imported without file contents; select the file manually before sending."
        : descriptionText(item.description)
    );
    field.enabled = !isFile && item.disabled !== true;
    return [field];
  });
}

export function fileNameOnly(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

export function supportedMethod(input: unknown, warnings: string[], name?: string): HttpMethod | undefined {
  const method = (asString(input) ?? "GET").toUpperCase() as HttpMethod;
  if (SUPPORTED_METHODS.has(method)) {
    return method;
  }
  warnings.push(`Skipped ${name ?? "request"}: unsupported HTTP method "${method}".`);
  return undefined;
}

export function rawBody(raw: string, contentType?: string): RequestBody {
  const isJson = contentType?.toLowerCase().includes("json") ?? false;
  return {
    mode: isJson ? "json" : "raw",
    contentType,
    raw,
    json: isJson ? parseJsonValue(raw) : undefined
  };
}

export function parseJsonValue(input: unknown): unknown {
  if (typeof input !== "string") {
    return input;
  }
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

export function contentTypeForLanguage(language?: string): string | undefined {
  if (!language) {
    return undefined;
  }
  if (language.toLowerCase() === "json") {
    return "application/json";
  }
  if (language.toLowerCase() === "xml") {
    return "application/xml";
  }
  return "text/plain";
}

export function contentTypeFromHeaders(headers: KeyValue[]): string | undefined {
  return headers.find((header) => header.key.toLowerCase() === "content-type")?.value;
}

export function descriptionText(input: unknown): string | undefined {
  if (typeof input === "string") {
    return input;
  }
  return asString(asRecord(input).content);
}

export function scalarText(input: unknown): string {
  if (input === undefined || input === null) {
    return "";
  }
  if (typeof input === "string") {
    return input;
  }
  if (typeof input === "number" || typeof input === "boolean") {
    return String(input);
  }
  try {
    return JSON.stringify(input);
  } catch {
    return "";
  }
}

export function numberValue(input: unknown, fallback: number): number {
  const value = typeof input === "number" ? input : Number(input);
  return Number.isFinite(value) ? value : fallback;
}

export function looksSecret(name: string): boolean {
  return /(token|secret|password|passwd|api[-_.]?key|authorization)/i.test(name);
}

export function environmentFromVariables(name: string, variables: EnvironmentVariable[]): Environment {
  const environment = createEnvironment(name);
  environment.variables = variables;
  return environment;
}

export function previewCollections(
  kind: ImportDocumentKind,
  label: string,
  collections: Collection[],
  _environments: Environment[],
  version?: string,
  format: SourceTextFormat = "json"
): ImportDocumentPreview {
  const counts = collections.reduce(
    (total, collection) => {
      const current = countCollection(collection);
      total.requests += current.requests;
      total.folders += current.folders;
      return total;
    },
    { requests: 0, folders: 0 }
  );
  return {
    kind,
    label,
    format,
    title: collections[0]?.name ?? "Imported collection",
    version,
    collectionCount: collections.length,
    requestCount: counts.requests,
    containerCount: counts.folders,
    containerLabel: "folders"
  };
}

export function countCollection(collection: Collection): { requests: number; folders: number } {
  let requests = collection.requests.length;
  let folders = 0;
  const visit = (items: Folder[]) => {
    for (const folder of items) {
      folders += 1;
      requests += folder.requests.length;
      visit(folder.folders);
    }
  };
  visit(collection.folders);
  return { requests, folders };
}
