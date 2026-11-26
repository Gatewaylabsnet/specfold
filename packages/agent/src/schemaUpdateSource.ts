import {
  assertBoundedWorkflowValue, isCredentialName, isPersonalName, parseApiText, redactAgentValue, REDACTED
} from "@openapi-collection-studio/core";
import { AgentError } from "./errors";

const maps = new Set([
  "properties", "patternProperties", "dependentSchemas", "definitions", "$defs", "$vocabulary",
  "paths", "webhooks", "callbacks", "responses", "headers", "content", "encoding",
  "schemas", "parameters", "requestBodies", "securitySchemes", "links", "mapping", "variables"
]);
const annotations = new Set(["description", "summary", "title", "externalValue"]);

/**
 * A signed plan contains sanitized source, not the original text. Scrub actual
 * examples and annotations but reject anything requiring a structural edit:
 * generic request redaction can remove perfectly valid schema property names.
 */
export function safeSchemaUpdateText(text: string, secrets: string[]): string {
  if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new AgentError("INPUT_TOO_LARGE");
  let document: Record<string, unknown>;
  try {
    document = parseApiText(text).document;
    assertBoundedWorkflowValue(document);
  } catch { throw new AgentError("INVALID_OPENAPI"); }
  if (Object.hasOwn(document, "jsonSchemaDialect") &&
      document.jsonSchemaDialect !== "https://spec.openapis.org/oas/3.1/dialect/base") {
    throw new AgentError("SCHEMA_UPDATE_REF_UNSUPPORTED");
  }
  const safeKey = (key: string) => {
    if (redactAgentValue(key, secrets) !== key) throw new AgentError("SCHEMA_SOURCE_REDACTION_REQUIRED");
  };
  const isSensitive = (key: string) => Boolean(key) && (isCredentialName(key) || isPersonalName(key));
  const example = (value: unknown, sensitive: boolean): unknown => {
    if (sensitive && value !== null && value !== undefined) {
      return typeof value === "string" ? redactAgentValue({ password: value }, secrets).password : REDACTED;
    }
    if (Array.isArray(value)) return value.map((entry) => example(entry, false));
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const field = typeof record.key === "string" ? record.key : typeof record.name === "string" ? record.name : "";
      return Object.fromEntries(Object.entries(record).map(([key, child]) => {
        safeKey(key);
        return [key, example(child, isSensitive(key) ||
          (key === "value" && (isSensitive(field) || record.secret === true || record.type === "apiKey")))];
      }));
    }
    return redactAgentValue(value, secrets);
  };
  const visit = (value: unknown, dictionary = false, sensitive = false, exampleMap = false, exampleObject = false): unknown => {
    if (Array.isArray(value)) return value.map((entry) => visit(entry, false, sensitive));
    if (!value || typeof value !== "object") {
      const masked = sensitive && (typeof value === "string" || typeof value === "number")
        ? redactAgentValue({ password: value }, secrets).password : redactAgentValue(value, secrets);
      if (masked !== value) throw new AgentError("SCHEMA_SOURCE_REDACTION_REQUIRED");
      return value;
    }
    const record = value as Record<string, unknown>;
    const sampleSensitive = sensitive || (!dictionary && typeof record.name === "string" && isSensitive(record.name) &&
      (typeof record.in === "string" || Object.hasOwn(record, "schema")));
    return Object.fromEntries(Object.entries(record).map(([key, child]) => {
      safeKey(key);
      if (exampleMap) return [key, visit(child, false, sensitive || isSensitive(key), false, true)];
      const childSensitive = isSensitive(key) || (!dictionary && sensitive && ["example", "examples", "default", "value"].includes(key));
      if (!dictionary && (key === "example" || (exampleObject && key === "value"))) return [key, example(child, sampleSensitive)];
      if (!dictionary && key === "examples") {
        return [key, Array.isArray(child) ? example(child, sampleSensitive) : visit(child, false, sampleSensitive, true)];
      }
      if (!dictionary && ["const", "enum", "default"].includes(key)) {
        if (JSON.stringify(example(child, key === "default" && sampleSensitive)) !== JSON.stringify(child)) {
          throw new AgentError("SCHEMA_SOURCE_REDACTION_REQUIRED");
        }
        return [key, child];
      }
      if (!dictionary && annotations.has(key) && typeof child === "string") return [key, redactAgentValue(child, secrets)];
      // Component examples use the same grammar as media examples.
      if (!dictionary && key === "components" && child && typeof child === "object" && !Array.isArray(child)) {
        return [key, Object.fromEntries(Object.entries(child).map(([category, entries]) => {
          safeKey(category);
          return [category, visit(entries, maps.has(category), false, category === "examples")];
        }))];
      }
      return [key, visit(child, !dictionary && maps.has(key), childSensitive || (!dictionary && key === "schema" && sampleSensitive))];
    }));
  };
  const result = JSON.stringify(visit(document));
  if (Buffer.byteLength(result) > 4 * 1024 * 1024) throw new AgentError("INPUT_TOO_LARGE");
  return result;
}
