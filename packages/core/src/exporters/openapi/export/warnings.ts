import type { ApiRequest } from "../../../model/types";
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

