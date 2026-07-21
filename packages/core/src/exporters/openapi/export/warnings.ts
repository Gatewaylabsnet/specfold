import type { ApiRequest, Collection, ResponseExample } from "../../../model/types";
import { flattenRequests } from "../../../model/traversal";
import { VARIABLE_ONLY } from "./shared";
import type { ExportWarning, OpenApiExportOptions } from "./types";

export function collectRequestSecretWarnings(
  request: ApiRequest,
  options: OpenApiExportOptions,
  warnings: ExportWarning[]
): void {
  const flag = (where: string, key: string) => {
    warnings.push({
      kind: "secret",
      message: `Request "${request.name}" has a literal value in ${where} "${key}" that looks like a secret. Use a {{variable}} so it is not written into the exported file.`
    });
  };

  if (options.includeParameterExamples) {
    for (const item of [...request.headers, ...request.queryParams, ...request.pathParams]) {
      if (item.enabled && looksSecret(item.key, item.value)) {
        flag("parameter", item.key);
      }
    }
  }

  if (options.includeRequestExamples && request.body.raw && bodyLooksSecret(request.body.raw)) {
    warnings.push({
      kind: "secret",
      message: `Request "${request.name}" has a request body example that looks like it contains a secret (token/password/key). Consider disabling example values or replacing secrets with {{variables}}.`
    });
  }
  if (options.includeRequestExamples && request.body.mode === "multipart") {
    for (const field of request.body.multipart ?? []) {
      if (field.type === "text" && field.enabled && looksSecret(field.key, field.value)) {
        flag("multipart field", field.key);
      }
    }
  }
  if (options.includeRequestExamples && request.body.mode === "form") {
    for (const field of request.body.form ?? []) {
      if (field.enabled && looksSecret(field.key, field.value)) {
        flag("form field", field.key);
      }
    }
  }
  if (options.includeResponseExamples) {
    for (const example of request.responseExamples) {
      collectResponseExampleSecretWarnings(request, example, warnings);
    }
  }
}

/**
 * Native Collection JSON writes every editable value, unlike an OpenAPI
 * export where examples can be omitted. Keep its warning surface explicit so
 * a user never mistakes it for a secret-safe sharing format.
 */
export function collectCollectionSecretWarnings(collection: Collection): ExportWarning[] {
  const warnings: ExportWarning[] = [];
  const includeAllValues: OpenApiExportOptions = {
    format: "json",
    useFolderNamesAsTags: true,
    includeRequestExamples: true,
    includeResponseExamples: true,
    includeBearerJwtSecurityScheme: true,
    includeAllComponents: true,
    includeParameterExamples: true
  };
  for (const { request } of flattenRequests(collection)) {
    collectRequestSecretWarnings(request, includeAllValues, warnings);
    collectAuthSecretWarnings(request, warnings);
  }
  return warnings;
}

function collectAuthSecretWarnings(request: ApiRequest, warnings: ExportWarning[]): void {
  const flag = (detail: string) => warnings.push({
    kind: "secret",
    message: `Request "${request.name}" has a literal ${detail}. Use a {{variable}} before sharing this Collection JSON file.`
  });
  if (request.auth.type === "bearer" && looksSecret("bearer token", request.auth.token)) {
    flag("bearer token");
  }
  if (request.auth.type === "basic" && looksSecret("password", request.auth.password)) {
    flag("basic-auth password");
  }
  if (request.auth.type === "apiKey" && looksSecret(request.auth.key, request.auth.value)) {
    flag(`API key "${request.auth.key || "ApiKey"}"`);
  }
}

function collectResponseExampleSecretWarnings(
  request: ApiRequest,
  example: ResponseExample,
  warnings: ExportWarning[]
): void {
  for (const header of example.headers) {
    if (header.enabled && looksSecret(header.key, header.value)) {
      warnings.push({
        kind: "secret",
        message: `Response example "${example.name}" on request "${request.name}" has a literal value in header "${header.key}" that looks like a secret.`
      });
    }
  }
  if (example.body && bodyLooksSecret(example.body)) {
    warnings.push({
      kind: "secret",
      message: `Response example "${example.name}" on request "${request.name}" looks like it contains a secret (token/password/key).`
    });
  }
}

export function looksSecret(key: string, value: string): boolean {
  if (!value || VARIABLE_ONLY.test(value)) {
    return false;
  }
  const keyName = key.toLowerCase();
  const nameSuggestsSecret = /authorization|token|secret|password|passwd|api[-_]?key|cookie|bearer/.test(
    keyName
  );
  return nameSuggestsSecret || valueLooksSecret(value);
}

export function bodyLooksSecret(raw: string): boolean {
  if (/"\s*(password|passwd|secret|client_secret|token|access_token|api[-_]?key)\s*"\s*:\s*"[^"]+"/i.test(raw)) {
    // A concrete string value assigned to a secret-ish key (not a {{variable}}).
    return !/"\s*(password|passwd|secret|client_secret|token|access_token|api[-_]?key)\s*"\s*:\s*"\s*\{\{/i.test(
      raw
    );
  }
  return valueLooksSecret(raw);
}

export function valueLooksSecret(value: string): boolean {
  const trimmed = value.trim();
  // JWT shape: header.payload.signature
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) {
    return true;
  }
  // Long high-entropy-ish opaque token.
  if (/^[A-Za-z0-9_\-+/=]{24,}$/.test(trimmed) && !trimmed.includes(" ")) {
    return true;
  }
  return false;
}

