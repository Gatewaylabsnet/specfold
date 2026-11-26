import type { ApiRequest, Collection, KeyValue, Workspace } from "../model/types";
import { contractObject as object } from "../importers/contractSchemaDiff";
import { isCredentialName, isCredentialReference, redactAgentValue, REDACTED } from "./redaction";

export type HeaderTarget = { id: string } | { name: string };
export type HeaderEdit =
  | { op: "add"; name: string; value: string; enabled?: boolean }
  | { op: "set-value"; target: HeaderTarget; value: string }
  | { op: "set-enabled"; target: HeaderTarget; enabled: boolean }
  | { op: "remove"; target: HeaderTarget };

const namePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const nonPublicHeaderName = /(?:^|-)auth(?:entication)?(?:-|$)|(?:^|-)key$|^x-(?:secret|signature|signed|csrf|xsrf)(?:-|$)|credential|session[-_]?id|private[-_]?key|encryption[-_]?key|signing[-_]?key/i;

export const configuredAuthHeader = (request: ApiRequest, inheritedBearer: boolean): string | undefined => {
  if (request.auth.type === "bearer" || request.auth.type === "basic" ||
      (inheritedBearer && request.auth.type === "none")) return "authorization";
  if (request.auth.type === "apiKey" && request.auth.in === "header") return request.auth.key.trim().toLowerCase();
};

export function requestHeaderGuards(request: ApiRequest, collection: Collection, workspace: Workspace, inheritedBearer: boolean) {
  const generated = configuredAuthHeader(request, inheritedBearer);
  const configured = new Set(generated ? [generated] : []);
  for (const definitions of [collection.openApi?.securitySchemes, object(collection.openApi?.components).securitySchemes]) {
    for (const value of Object.values(object(definitions))) {
      const scheme = object(value);
      if (scheme.type === "apiKey" && scheme.in === "header" && typeof scheme.name === "string") {
        configured.add(scheme.name.trim().toLowerCase());
      }
    }
  }
  const variables = new Set<string>();
  const unsafe = new Set<string>();
  for (const environment of workspace.environments) for (const variable of environment.variables) {
    if (!variable.enabled) continue;
    variables.add(variable.name);
    if (!variable.secret && !variable.value.startsWith("enc:v1:")) unsafe.add(variable.name);
  }
  return {
    generated,
    isSensitive: (key: string) => isCredentialName(key) || nonPublicHeaderName.test(key) || configured.has(key.toLowerCase()),
    variables,
    credentialVariables: new Set([...variables].filter((name) => !unsafe.has(name)))
  };
}
type Guards = ReturnType<typeof requestHeaderGuards>;

function validateValue(name: string, value: string, guards: Guards): void {
  if (typeof value !== "string" || value.length > 8192 || Array.from(value).some((character) => {
    const code = character.codePointAt(0)!;
    return (code < 32 && code !== 9) || code === 127;
  })) {
    throw new Error("REQUEST_UPDATE_INVALID");
  }
  if (!value) return; // A blank value is not a credential and is different from removing the row.
  const sensitive = guards.isSensitive(name);
  if (sensitive || isCredentialReference(value)) {
    if (!isCredentialReference(value)) throw new Error("REQUEST_UPDATE_CREDENTIAL_LITERAL");
    const variable = /\{\{([^{}]+)\}\}/.exec(value)?.[1];
    if (!variable || !(sensitive ? guards.credentialVariables : guards.variables).has(variable)) {
      throw new Error("REQUEST_UPDATE_CREDENTIAL_VARIABLE");
    }
  }
}

function displayValue(name: string, value: string, guards: Guards): string {
  if (!value) return "(empty)";
  if (guards.isSensitive(name) && !isCredentialReference(value)) return REDACTED;
  // Keep ordinary Content-Type and safe short values readable; don't disclose
  // arbitrary input values such as identifiers or API keys with a nonstandard header name.
  if (isCredentialReference(value)) return redactAgentValue(value);
  if (name.toLowerCase() === "content-type") {
    const media = value.split(";", 1)[0].trim();
    if (/^(?:application|audio|font|image|message|model|multipart|text|video)\/[a-z0-9.+_-]+$/i.test(media)) {
      return redactAgentValue(media).slice(0, 160) + (value.includes(";") ? " (parameters omitted)" : "");
    }
  }
  return "(value omitted)";
}

function locate(headers: KeyValue[], target: HeaderTarget) {
  if (!target || (Object.hasOwn(target, "id") === Object.hasOwn(target, "name"))) throw new Error("REQUEST_UPDATE_INVALID");
  if ("id" in target ? typeof target.id !== "string" || !target.id : typeof target.name !== "string" || !target.name) {
    throw new Error("REQUEST_UPDATE_INVALID");
  }
  const matches = headers.flatMap((header, index) => {
    const match = "id" in target ? header.id === target.id
      : header.key.toLowerCase() === target.name?.toLowerCase();
    return match ? [index] : [];
  });
  if (!matches.length) throw new Error("REQUEST_UPDATE_HEADER_NOT_FOUND");
  if (matches.length > 1) throw new Error("REQUEST_UPDATE_HEADER_AMBIGUOUS");
  return matches[0];
}

export function applyRequestHeaderEdits(request: ApiRequest, edits: HeaderEdit[], guards: Guards) {
  if (!Array.isArray(edits) || edits.length === 0 || edits.length > 64) throw new Error("REQUEST_UPDATE_INVALID");
  const headers = request.headers.map((header) => ({ ...header }));
  const occupiedIds = new Set(headers.map((header) => header.id));
  const changes: Array<{ scope: string; message: string }> = [];
  let serial = 0;
  for (const edit of edits) {
    if (edit.op === "add") {
      if (typeof edit.name !== "string" || !namePattern.test(edit.name) || (edit.enabled !== undefined && typeof edit.enabled !== "boolean")) {
        throw new Error("REQUEST_UPDATE_INVALID");
      }
      validateValue(edit.name, edit.value, guards);
      let id: string;
      do { id = `agent-header-${++serial}`; } while (occupiedIds.has(id));
      occupiedIds.add(id);
      headers.push({ id, key: edit.name, value: edit.value, enabled: edit.enabled ?? true });
      changes.push({ scope: `HTTP header ${edit.name}`, message: `Added ${edit.enabled === false ? "disabled" : "enabled"} row: ${displayValue(edit.name, edit.value, guards)}.` });
    } else {
      const at = locate(headers, edit.target), header = headers[at];
      const scope = `HTTP header ${header.key} (row ${header.id})`;
      if (edit.op === "remove") {
        headers.splice(at, 1);
        changes.push({ scope, message: "Removed saved header row." });
      } else if (edit.op === "set-enabled") {
        if (typeof edit.enabled !== "boolean") throw new Error("REQUEST_UPDATE_INVALID");
        if (header.enabled === edit.enabled) continue;
        header.enabled = edit.enabled;
        changes.push({ scope, message: edit.enabled ? "Enabled saved header row." : "Disabled saved header row." });
      } else if (edit.op === "set-value") {
        validateValue(header.key, edit.value, guards);
        if (header.value === edit.value) continue;
        const from = displayValue(header.key, header.value, guards);
        const to = displayValue(header.key, edit.value, guards);
        header.value = edit.value;
        changes.push({ scope, message: !edit.value ? "Cleared header value; kept the row." : `Replaced saved header value: ${from} → ${to}.` });
      } else throw new Error("REQUEST_UPDATE_INVALID");
    }
  }
  return { headers, changes };
}

export function requestTransportWarnings(request: ApiRequest, guards: Guards): string[] {
  const enabled = request.headers.filter((header) => header.enabled);
  const warnings: string[] = [];
  if (guards.generated && enabled.some(({ key }) => key.toLowerCase() === guards.generated)) {
    warnings.push("A manual HTTP header conflicts with the header produced by request authentication. Both settings were kept.");
  }
  const contentTypes = enabled.filter(({ key }) => key.toLowerCase() === "content-type").map(({ value }) => value);
  const mediaType = (value: string) => value.trim().toLowerCase().split(";", 1)[0].trim();
  const savedType = request.body.contentType && mediaType(request.body.contentType);
  if (contentTypes.length > 1) warnings.push("Multiple enabled Content-Type headers exist. No duplicate was removed.");
  if (request.body.mode === "multipart" && contentTypes.length) {
    warnings.push("The HTTP sender ignores manually saved Content-Type for multipart so it can generate the boundary.");
  } else if (request.body.mode !== "none" && contentTypes.some((value) => {
    const type = mediaType(value);
    if (type.includes("{{")) return false;
    if (savedType && !savedType.includes("{{") && type !== savedType) return true;
    if (request.body.mode === "json") return type !== "application/json" && !type.endsWith("+json");
    if (request.body.mode === "form") return type !== "application/x-www-form-urlencoded";
    return false;
  })) warnings.push("An enabled HTTP Content-Type differs from the saved body type. Neither value was changed automatically.");
  return warnings;
}
