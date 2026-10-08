import type { Workspace } from "../model/types";
import { flattenRequests } from "../model/traversal";

export const REDACTED = "[REDACTED]";
export const isCredentialName = (name: string): boolean =>
  /authorization|token|password|passwd|secret|cookie|api[-_]?key|username|client.?id/i.test(name);
export const isPersonalName = (name: string): boolean =>
  /tckn|tc.?kimlik|identity.?number|national.?id|ssn|email|phone|telefon|address|adres|birth|dogum/i.test(name);
export const isVariableReference = (value: string): boolean =>
  /^\{\{[a-zA-Z_][\w.-]{0,127}\}\}$/.test(value);
export const isCredentialReference = (value: string): boolean => isVariableReference(value) ||
  /^(?:Bearer|Basic)\s+\{\{[a-zA-Z_][\w.-]{0,127}\}\}$/i.test(value);

export function workspaceSecrets(workspace: Workspace): string[] {
  const referenced = new Set<string>();
  const addReferences = (value: string) => {
    for (const match of value.matchAll(/\{\{([\w.-]+)\}\}/g)) referenced.add(match[1]);
  };
  const inspectBody = (value: unknown, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 40) return;
    for (const [key, item] of Object.entries(value)) {
      if (isCredentialName(key) && typeof item === "string") addReferences(item);
      else if (typeof item === "object") inspectBody(item, depth + 1);
    }
  };
  for (const collection of workspace.collections) for (const { request } of flattenRequests(collection)) {
    if (request.auth.type === "bearer") addReferences(request.auth.token);
    if (request.auth.type === "basic") { addReferences(request.auth.username); addReferences(request.auth.password); }
    if (request.auth.type === "apiKey") addReferences(request.auth.value);
    for (const field of [...request.headers, ...request.queryParams, ...(request.body.form ?? [])]) {
      if (isCredentialName(field.key)) addReferences(field.value);
    }
    if (request.body.raw?.trim().startsWith("{")) {
      try { inspectBody(JSON.parse(request.body.raw)); } catch { /* No raw input is logged. */ }
    }
  }
  const variables = workspace.environments.flatMap((environment) => environment.variables);
  for (const variable of variables) if (variable.secret || isCredentialName(variable.name)) referenced.add(variable.name);
  // Follow reference names, not values; bound alias chains and never resolve credentials.
  for (let pass = 0; pass < 40; pass++) {
    const before = referenced.size;
    for (const variable of variables) if (referenced.has(variable.name)) addReferences(variable.value);
    if (before === referenced.size) break;
  }
  return variables.filter((variable) => referenced.has(variable.name))
    .map((variable) => variable.value).filter((value) => value && !isVariableReference(value));
}

/** Defense in depth, not a general-purpose PII classifier. Never resolves variables. */
export function redactAgentValue<T>(input: T, secrets: readonly string[] = []): T {
  const scrubText = (value: string): string => {
    if (isVariableReference(value)) return value;
    let text = value;
    for (const secret of secrets) text = text.split(secret).join(REDACTED);
    text = text.replace(/enc:v1:[A-Za-z0-9+/=]+/g, REDACTED)
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?\b/g, REDACTED)
      .replace(/\bBearer\s+(?!\{\{)[^\s"',}]+/gi, `Bearer ${REDACTED}`)
      .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, `$1${REDACTED}@`)
      .replace(/\b\d{11}\b/g, REDACTED)
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED)
      .replace(/\b(?:\+90|0090|0)[ -]?(?:\d[ -]?){10}\b/g, REDACTED)
      .replace(/((?:password|passwd|client.?secret|access.?token|token|api.?key|username)\s*[=:]\s*)(?!\{\{)[^\s&"',}]+/gi, `$1${REDACTED}`);
    return text;
  };
  const visit = (value: unknown, sensitive = false, depth = 0): unknown => {
    if (depth > 80) return REDACTED;
    if (typeof value === "string") {
      if (isCredentialReference(value)) return value;
      if (sensitive && value) return REDACTED;
      if (value.startsWith("enc:v1:")) return REDACTED;
      if (/^\s*[{[]/.test(value)) {
        try { return JSON.stringify(visit(JSON.parse(value), false, depth + 1), null, 2); }
        catch { /* Raw/non-JSON bodies still get textual redaction. */ }
      }
      return scrubText(value);
    }
    if (typeof value === "number") return sensitive || /^\d{11}$/.test(String(value)) ? REDACTED : value;
    if (Array.isArray(value)) return value.map((item) => visit(item, sensitive, depth + 1));
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    const fieldName = typeof record.key === "string" ? record.key
      : typeof record.name === "string" && "value" in record ? record.name : "";
    return Object.fromEntries(Object.entries(record).filter(([key]) =>
      !["__proto__", "constructor", "prototype", "uploadId", "fileName"].includes(key)
    ).map(([key, item]) => [key, visit(item,
      isCredentialName(key) || isPersonalName(key) ||
      (key === "value" && (record.secret === true || isCredentialName(fieldName) || isPersonalName(fieldName))) ||
      (sensitive && ["example", "default", "value", "examples"].includes(key)), depth + 1)]));
  };
  return visit(input) as T;
}
