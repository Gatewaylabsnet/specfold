import type { Workspace } from "../model/types";
import type { ConnectionProfile, WorkflowAuth } from "./types";

const MAX_PROFILES = 64;
const MAX_URL_LENGTH = 2_048;
const VARIABLE_NAME = /^[A-Za-z_][\w.-]{0,127}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const CREDENTIAL_QUERY_NAME = /auth|token|password|passwd|secret|cookie|apikey|accesskey|credential|username|clientid|signature|^(?:key|sig|pwd|pass|user|login|code)$/i;

function invalid(field: string): never {
  // Field paths are fixed by this module; never echo a rejected value or key.
  throw new Error(`INVALID_CONNECTION_PROFILE: ${field}`);
}

function record(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(field);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !keys.includes(key)) invalid(field);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !("value" in descriptor)) invalid(field);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value || value.length > max || value !== value.trim() ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    invalid(field);
  }
  return value;
}

function identifier(value: unknown, field: string): string {
  const result = text(value, field, 128);
  if (!ID.test(result)) invalid(field);
  return result;
}

function variable(value: unknown, field: string): string {
  const result = text(value, field, 128);
  if (!VARIABLE_NAME.test(result)) invalid(field);
  return result;
}

function httpUrl(value: unknown, field: string, allowQuery: boolean): string {
  const result = text(value, field, MAX_URL_LENGTH);
  // Do not let URL's permissive parsing silently repair placeholders, slashes,
  // whitespace, or empty fragments/userinfo before checking them.
  if (!/^https?:\/\//i.test(result) || /[\s\\{}#]/.test(result) || /%7[bd]/i.test(result)) invalid(field);
  const authority = result.slice(result.indexOf("://") + 3).split(/[/?#]/, 1)[0];
  if (!authority || authority.includes("@") || (!allowQuery && result.includes("?"))) invalid(field);
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    // Parsing errors can include the original URL, so do not attach a cause.
    invalid(field);
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) invalid(field);
  url.searchParams.forEach((_value, key) => {
    const normalized = key.replace(/[^a-z0-9]/gi, "");
    if (CREDENTIAL_QUERY_NAME.test(normalized)) invalid(field);
  });
  return result;
}

function authConfig(value: unknown): WorkflowAuth {
  const item = record(value, ["kind", "tokenVariable", "usernameVariable", "passwordVariable", "key", "in", "valueVariable", "endpoint", "clientIdVariable", "clientSecretVariable"], "auth");
  switch (item.kind) {
    case "none":
      record(item, ["kind"], "auth");
      return { kind: "none" };
    case "bearer":
      record(item, ["kind", "tokenVariable"], "auth");
      return { kind: "bearer", tokenVariable: variable(item.tokenVariable, "auth.tokenVariable") };
    case "basic":
      record(item, ["kind", "usernameVariable", "passwordVariable"], "auth");
      return {
        kind: "basic", usernameVariable: variable(item.usernameVariable, "auth.usernameVariable"),
        passwordVariable: variable(item.passwordVariable, "auth.passwordVariable")
      };
    case "apiKey": {
      record(item, ["kind", "key", "in", "valueVariable"], "auth");
      if (item.in !== "header" && item.in !== "query") invalid("auth.in");
      const key = text(item.key, "auth.key", 128);
      if (item.in === "header" ? !HEADER_NAME.test(key) : !VARIABLE_NAME.test(key)) invalid("auth.key");
      return { kind: "apiKey", key, in: item.in, valueVariable: variable(item.valueVariable, "auth.valueVariable") };
    }
    case "apinizer": {
      record(item, ["kind", "endpoint", "usernameVariable", "passwordVariable", "clientIdVariable", "tokenVariable", "clientSecretVariable"], "auth");
      const auth: WorkflowAuth = {
        kind: "apinizer", endpoint: httpUrl(item.endpoint, "auth.endpoint", true),
        usernameVariable: variable(item.usernameVariable, "auth.usernameVariable"),
        passwordVariable: variable(item.passwordVariable, "auth.passwordVariable"),
        clientIdVariable: variable(item.clientIdVariable, "auth.clientIdVariable"),
        tokenVariable: variable(item.tokenVariable, "auth.tokenVariable")
      };
      if (Object.hasOwn(item, "clientSecretVariable")) {
        auth.clientSecretVariable = variable(item.clientSecretVariable, "auth.clientSecretVariable");
      }
      if ([auth.usernameVariable, auth.passwordVariable, auth.clientIdVariable, auth.clientSecretVariable].includes(auth.tokenVariable)) {
        invalid("auth.tokenVariable");
      }
      return auth;
    }
    default:
      return invalid("auth.kind");
  }
}

/** Validate metadata without resolving or storing any credential values. */
export function validateConnectionProfile(value: unknown): ConnectionProfile {
  const item = record(value, ["id", "name", "provider", "collectionId", "environmentId", "baseUrl", "source", "auth"], "profile");
  if (item.provider !== "openapi" && item.provider !== "apinizer") invalid("provider");
  const source = record(item.source, ["kind", "label"], "source");
  if (source.kind !== "file" && source.kind !== "url" && source.kind !== "existing") invalid("source.kind");
  const auth = authConfig(item.auth);
  if (auth.kind === "apinizer" && item.provider !== "apinizer") invalid("provider/auth");
  return {
    id: identifier(item.id, "id"), name: text(item.name, "name", 160), provider: item.provider,
    collectionId: identifier(item.collectionId, "collectionId"), environmentId: identifier(item.environmentId, "environmentId"),
    baseUrl: httpUrl(item.baseUrl, "baseUrl", false),
    source: {
      kind: source.kind,
      label: source.kind === "url" ? httpUrl(source.label, "source.label", true) : text(source.label, "source.label", MAX_URL_LENGTH)
    },
    auth
  };
}

/** Return references only; missing environment values are handled by preview. */
export function profileAuthVariables(profile: ConnectionProfile): string[] {
  const { auth } = validateConnectionProfile(profile);
  switch (auth.kind) {
    case "none": return [];
    case "bearer": return [auth.tokenVariable];
    case "apiKey": return [auth.valueVariable];
    case "basic": return [...new Set([auth.usernameVariable, auth.passwordVariable])];
    case "apinizer": return [...new Set([
      auth.usernameVariable, auth.passwordVariable, auth.clientIdVariable,
      ...(auth.clientSecretVariable ? [auth.clientSecretVariable] : []), auth.tokenVariable
    ])];
  }
}

/** Add or replace a profile without rewriting legacy collections or requests. */
export function upsertProfile(workspace: Workspace, profile: ConnectionProfile): Workspace {
  const validated = validateConnectionProfile(profile);
  if (!workspace.collections.some((collection) => collection.id === validated.collectionId)) throw new Error("COLLECTION_NOT_FOUND");
  if (!workspace.environments.some((environment) => environment.id === validated.environmentId)) throw new Error("ENVIRONMENT_NOT_FOUND");
  const existing = workspace.connectionProfiles ?? [];
  if (!Array.isArray(existing) || existing.length > MAX_PROFILES) throw new Error("CONNECTION_PROFILE_LIMIT");
  const profiles = existing.map(validateConnectionProfile);
  if (new Set(profiles.map((item) => item.id)).size !== profiles.length) throw new Error("DUPLICATE_CONNECTION_PROFILE_ID");
  const index = profiles.findIndex((item) => item.id === validated.id);
  if (index < 0 && profiles.length >= MAX_PROFILES) throw new Error("CONNECTION_PROFILE_LIMIT");
  if (index < 0) profiles.push(validated);
  else profiles[index] = validated;
  const next = structuredClone(workspace);
  next.connectionProfiles = profiles;
  next.updatedAt = new Date().toISOString();
  return next;
}
