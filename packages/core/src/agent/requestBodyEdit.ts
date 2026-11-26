import type { ApiRequest, KeyValue, MultipartField, RequestBody } from "../model/types";
import { validateWorkflowValue } from "../workflow/assertions";
import { resolveWorkflowReferences } from "../workflow/provenance";
import { isCredentialName, isCredentialReference } from "./redaction";
import { copyEditJson, editBodyHasControl, editBodyTextBytes, MAX_EDIT_BODY_TEXT, patchSavedJson, type JsonBodyPatch } from "./requestJsonPatch";

export type { JsonBodyPatch } from "./requestJsonPatch";
type FormEditField = { key: string; value: string; enabled?: boolean };
export type RequestBodyEdit =
  | { op: "clear" }
  | { op: "patch-json"; patch: JsonBodyPatch[] }
  | { op: "replace"; mode: "json"; value: unknown; contentType?: string }
  | { op: "replace"; mode: "raw"; value: string; contentType?: string }
  | { op: "replace"; mode: "form" | "multipart"; fields: FormEditField[]; contentType?: string };

type CredentialAllowed = (variableName: string) => boolean;
type BodyEditResult = { body: RequestBody; changes: Array<{ scope: string; message: string }>; warnings: string[] };
const invalid = (): never => { throw new Error("REQUEST_BODY_INVALID"); };
const secret = (): never => { throw new Error("REQUEST_BODY_SECRET_REFERENCE_REQUIRED"); };
const limit = (): never => { throw new Error("REQUEST_BODY_LIMIT"); };
const credentialName = (key: string): boolean =>
  isCredentialName(key) || /credential|session[-_]?id|private[-_]?key|encryption[-_]?key|signing[-_]?key/i.test(key);

export function requestEditCredentialValue(value: unknown, credentialAllowed?: CredentialAllowed): void {
  if (value === "" || value === null || value === undefined) return; // An explicit blank is not a secret.
  if (typeof value !== "string" || !isCredentialReference(value)) return secret();
  const name = value.match(/\{\{([^}]+)\}\}/)?.[1];
  if (!name || (credentialAllowed && !credentialAllowed(name))) secret();
}

/** Reject recognized credentials in supplied data; never redact and then save a different input. */
function checkLiteral(value: string, credentialAllowed?: CredentialAllowed): void {
  if (value.length > MAX_EDIT_BODY_TEXT) limit();
  if (/enc:v1:|-----BEGIN[^\r\n]*(?:PRIVATE KEY|PKCS12)-----|\beyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?\b|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/.test(value)) secret();
  for (const match of value.matchAll(/\b(?:Bearer|Basic)\s+(\{\{[\w.-]+\}\}|[^\s"',;}]+)/gi)) {
    requestEditCredentialValue(match[1], credentialAllowed);
  }
  for (const match of value.matchAll(/["']?([\w.-]+)["']?\s*[:=]\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|(\{\{[\w.-]+\}\}|[^\s&,;}<>]+))/g)) {
    if (credentialName(match[1])) requestEditCredentialValue(match[2] ?? match[3] ?? match[4], credentialAllowed);
  }
  for (const match of value.matchAll(/<(?:[\w.-]+:)?([\w.-]+)(?:\s+[^>]*)?>([^<>]*)(?=<)/g)) {
    if (credentialName(match[1])) requestEditCredentialValue(match[2].trim(), credentialAllowed);
  }
  if (value.includes("%") && value.includes("=")) {
    for (const [key, item] of new URLSearchParams(value)) {
      if (credentialName(key)) requestEditCredentialValue(item, credentialAllowed);
    }
  }
}

function checkJsonInput(value: unknown, credentialAllowed?: CredentialAllowed, sensitive = false): void {
  if (sensitive) { requestEditCredentialValue(value, credentialAllowed); return; }
  if (typeof value === "string") { checkLiteral(value, credentialAllowed); return; }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      checkLiteral(key, credentialAllowed);
      checkJsonInput(child, credentialAllowed, credentialName(key));
    }
  }
}

function checkFields(fields: FormEditField[], credentialAllowed?: CredentialAllowed): void {
  if (!Array.isArray(fields) || fields.length > 100) limit();
  let characters = 0;
  for (const field of fields) {
    if (!field || typeof field.key !== "string" || !field.key.trim() || field.key.length > 256 ||
        editBodyHasControl(field.key) || typeof field.value !== "string" ||
        (field.enabled !== undefined && typeof field.enabled !== "boolean") ||
        Object.keys(field).some((key) => !["key", "value", "enabled"].includes(key))) invalid();
    if (field.value.length > MAX_EDIT_BODY_TEXT) limit();
    characters += editBodyTextBytes(field.key) + editBodyTextBytes(field.value);
    if (characters > MAX_EDIT_BODY_TEXT) limit();
    checkLiteral(field.key, credentialAllowed);
    if (credentialName(field.key)) requestEditCredentialValue(field.value, credentialAllowed);
    else checkLiteral(field.value, credentialAllowed);
  }
}

function replaceTextFields(requestId: string, incoming: FormEditField[], previous: KeyValue[],
  reservedIds: string[] = []): KeyValue[] {
  const reserved = new Set([...previous.map(({ id }) => id), ...reservedIds]);
  let ordinal = 0;
  return incoming.map((field, index) => {
    const saved = previous[index]?.key === field.key ? previous[index] : undefined;
    let id = saved?.id;
    if (!id) {
      do { id = `agent_body_${requestId.slice(0, 144)}_${ordinal++}`; } while (reserved.has(id));
      reserved.add(id);
    }
    return { ...saved, id, key: field.key, value: field.value, enabled: field.enabled ?? saved?.enabled ?? true };
  });
}

function replaceMultipart(requestId: string, incoming: FormEditField[], previous: MultipartField[]): MultipartField[] {
  const files = previous.filter(({ type }) => type === "file");
  const text: MultipartField[] = replaceTextFields(requestId, incoming, previous.filter(({ type }) => type === "text"),
    files.map(({ id }) => id)).map((field) => ({ ...field, type: "text" }));
  let index = 0;
  const result: MultipartField[] = [];
  for (const field of previous) {
    if (field.type === "file") result.push(field);
    else if (index < text.length) result.push(text[index++]);
  }
  return result.concat(text.slice(index));
}

function schemaWarnings(body: RequestBody, document: unknown, jsonValue: unknown): string[] {
  if (body.mode === "none") return body.required ? ["The retained OpenAPI contract declares a required body. No schema was edited."] : [];
  if (body.schema === undefined) return [];
  if (body.mode !== "json") return ["The retained OpenAPI schema was not checked against this body format."];
  try {
    const resolved = resolveWorkflowReferences(body.schema, document ?? {});
    const outcome = resolved.unresolved ? "blocked" : validateWorkflowValue(jsonValue, resolved.value).outcome;
    if (outcome === "failed") return ["The proposed JSON does not satisfy the retained OpenAPI schema. No schema was edited."];
    if (outcome === "passed") return [];
  } catch { /* Bounded inspection can decline unsupported schemas without blocking an edit. */ }
  return ["The retained OpenAPI schema could not be fully checked. Review it before sending."];
}

/** New payload data only; never edits the source OpenAPI declaration or any HTTP header. */
export function applyRequestBodyEdit(request: ApiRequest, edit: RequestBodyEdit, document?: unknown,
  credentialAllowed?: CredentialAllowed): BodyEditResult {
  const previous = request.body;
  const body = structuredClone(previous);
  const { mode: oldMode } = previous;
  const changes: BodyEditResult["changes"] = [];
  const change = (message: string, scope = "Body") => changes.push({ scope, message });
  let jsonValue: unknown;
  if (edit.op === "patch-json") {
    if (previous.mode !== "json" || typeof previous.raw !== "string") return invalid();
    if (previous.raw.startsWith("enc:v1:")) throw new Error("REQUEST_BODY_OPAQUE");
    const patched = patchSavedJson(previous.raw, edit.patch, (segments, value) => {
      for (const segment of segments) checkLiteral(segment, credentialAllowed);
      if (value !== undefined) checkJsonInput(value, credentialAllowed, segments.some(credentialName));
    });
    jsonValue = patched.value;
    if (!patched.unchanged) {
      body.raw = JSON.stringify(jsonValue, null, 2);
      if (previous.json !== undefined) body.json = jsonValue;
      patched.messages.forEach((message) => change(message, "Body JSON"));
    }
  } else {
    if (edit.op === "clear" || (edit.op === "replace" && oldMode !== edit.mode)) {
      delete body.raw;
      delete body.json;
      delete body.form;
      delete body.multipart;
    }
    if (edit.op === "clear") {
      body.mode = "none";
      change("Clear saved payload.");
    } else if (edit.op === "replace") {
      body.mode = edit.mode;
      if (edit.contentType !== undefined) {
        if (typeof edit.contentType !== "string" || edit.contentType.length > 256 || editBodyHasControl(edit.contentType)) return invalid();
        checkLiteral(edit.contentType, credentialAllowed);
        body.contentType = edit.contentType;
        if (body.contentType !== previous.contentType) change("Change the stored media type.", "Body Content-Type");
      }
      switch (edit.mode) {
        case "json":
          jsonValue = copyEditJson(edit.value);
          checkJsonInput(jsonValue, credentialAllowed);
          body.raw = JSON.stringify(jsonValue, null, 2);
          if (previous.json !== undefined && oldMode === "json") body.json = jsonValue;
          change("Replace the complete JSON payload.");
          break;
        case "raw":
          if (typeof edit.value !== "string") return invalid();
          if (edit.value.startsWith("enc:v1:")) return secret();
          checkLiteral(edit.value, credentialAllowed);
          try { jsonValue = JSON.parse(edit.value); } catch { /* This mode also accepts arbitrary plain text. */ }
          if (jsonValue !== undefined) checkJsonInput(copyEditJson(jsonValue), credentialAllowed);
          body.raw = edit.value;
          change(edit.value === "" ? "Set the text payload to an empty string." : "Replace the complete text payload.");
          break;
        case "form":
          checkFields(edit.fields, credentialAllowed);
          body.form = replaceTextFields(request.id, edit.fields, oldMode === "form" ? previous.form ?? [] : []);
          change(`Replace the URL-encoded form with ${edit.fields.length} field(s).`);
          break;
        case "multipart":
          checkFields(edit.fields, credentialAllowed);
          body.multipart = replaceMultipart(request.id, edit.fields, oldMode === "multipart" ? previous.multipart ?? [] : []);
          change(`Replace multipart text fields with ${edit.fields.length} field(s); existing file placeholders are retained.`);
          break;
        default: return invalid();
      }
    } else return invalid();
  }
  if (body.raw !== undefined && body.raw.length > MAX_EDIT_BODY_TEXT) return limit();
  if (body.mode !== oldMode) {
    change(`Change the body type from ${oldMode} to ${body.mode}; previous payload variants are discarded.`, "Body type");
    if (oldMode === "multipart" && previous.multipart?.some(({ type }) => type === "file")) {
      change("The replacement removes the existing multipart file placeholders; no file is read or sent.");
    }
  }
  const warnings = schemaWarnings(body, document, jsonValue);
  const media = body.contentType?.split(";")[0]?.trim().toLowerCase();
  if (media && ((body.mode === "json" && !/(?:\+|\/)json$/.test(media)) ||
      (body.mode === "form" && media !== "application/x-www-form-urlencoded") ||
      (body.mode === "multipart" && media !== "multipart/form-data"))) {
    warnings.push("The requested body type and saved media type differ. Existing HTTP headers were not changed by the body edit.");
  }
  if (body.mode !== "none" && (request.method === "GET" || request.method === "HEAD")) {
    warnings.push("Specfold does not send saved body payloads with GET or HEAD.");
  }
  return { body, changes: JSON.stringify(body) === JSON.stringify(previous) ? [] : changes, warnings };
}
