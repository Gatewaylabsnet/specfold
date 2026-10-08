import { asRecord, collectSecuritySchemes, HTTP_METHODS, resolveLocalRef } from "../importers/shared";
import { isCredentialName, isPersonalName, redactAgentValue } from "./redaction";

/** Non-blocking diagnostics shared by the desktop and agent import previews. */
export function agentOpenApiWarnings(document: Record<string, unknown>): string[] {
  const warnings = new Set<string>();
  const schemes = collectSecuritySchemes(document);
  const checkSecurity = (value: unknown, location: string) => {
    if (!Array.isArray(value)) return;
    for (const requirement of value) for (const [name, scopes] of Object.entries(asRecord(requirement))) {
      const scheme = asRecord(schemes[name]);
      if (scheme.type === "http" && String(scheme.scheme).toLowerCase() === "bearer" &&
          Array.isArray(scopes) && scopes.length) {
        warnings.add(`${location}: bearer authentication cannot have OAuth scopes; use an empty scope array ([]).`);
      }
    }
  };
  const matches = (schema: Record<string, unknown>, example: unknown): boolean => {
    if (example === null) return schema.nullable === true || schema.type === "null";
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    return types.some((type) => type === undefined ||
      (type === "object" && typeof example === "object" && !Array.isArray(example)) ||
      (type === "array" && Array.isArray(example)) ||
      (type === "integer" && typeof example === "number" && Number.isInteger(example)) ||
      (type === "number" && typeof example === "number") ||
      (type === "boolean" && typeof example === "boolean") ||
      (type === "string" && typeof example === "string"));
  };
  const checkExample = (schemaInput: unknown, example: unknown, location: string, depth = 0) => {
    if (depth > 30) return;
    const schema = asRecord(resolveLocalRef(document, schemaInput));
    if (!matches(schema, example)) warnings.add(`${location}: example type does not match its schema type.`);
    if (JSON.stringify(example) !== JSON.stringify(redactAgentValue(example))) {
      warnings.add(`${location}: example contains credential-like or personal data; agent imports redact these values.`);
    }
    if (Array.isArray(example)) {
      for (const item of example) checkExample(schema.items, item, `${location}/items`, depth + 1);
    } else if (example && typeof example === "object") {
      for (const [key, item] of Object.entries(example)) {
        if (isCredentialName(key) || isPersonalName(key)) {
          warnings.add(`${location}: example contains sensitive fields; do not use production credentials or personal data.`);
        }
        checkExample(asRecord(schema.properties)[key], item, `${location}/property`, depth + 1);
      }
    }
  };
  const seen = new Set<object>();
  const walk = (input: unknown, location: string, depth = 0) => {
    if (!input || typeof input !== "object" || depth > 50 || seen.has(input)) return;
    seen.add(input);
    if (Array.isArray(input)) { input.forEach((item) => walk(item, location, depth + 1)); return; }
    const node = asRecord(input);
    if ("example" in node) checkExample(node.schema ?? node, node.example, location);
    for (const item of Object.values(asRecord(node.examples))) {
      const example = asRecord(resolveLocalRef(document, item));
      if ("value" in example) checkExample(node.schema, example.value, location);
    }
    for (const [key, value] of Object.entries(node)) if (key !== "$ref") walk(value, `${location}/${key}`, depth + 1);
  };
  checkSecurity(document.security, "Document");
  for (const [path, pathInput] of Object.entries(asRecord(document.paths))) {
    const item = asRecord(pathInput);
    for (const method of HTTP_METHODS) {
      const operation = asRecord(item[method]);
      checkSecurity(operation.security, `${method.toUpperCase()} ${path}`);
    }
  }
  walk(document, "OpenAPI");
  return redactAgentValue([...warnings]).slice(0, 100);
}
