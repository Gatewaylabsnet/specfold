import type { ApiRequest, Collection } from "../model/types";
import { isCredentialName, isPersonalName, redactAgentValue, REDACTED } from "../agent/redaction";
import { validateWorkflowValue } from "./assertions";
import type { TestInputEvidence } from "./types";

type RecordValue = Record<string, unknown>;
const MAX_NODES = 20_000;
const MAX_DEPTH = 30;
const MAX_TEXT = 1024 * 1024;
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value)
  ? value as RecordValue : {};
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** Limits untrusted specification/example traversal before comparison or resolution. */
export function assertBoundedWorkflowValue(value: unknown): void {
  let nodes = 0, characters = 0;
  const seen = new Set<object>();
  const walk = (item: unknown, depth: number) => {
    if (typeof item === "string") characters += item.length;
    if (++nodes > MAX_NODES || depth > MAX_DEPTH || characters > MAX_TEXT) {
      throw new Error("WORKFLOW_INPUT_TOO_LARGE");
    }
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("WORKFLOW_INVALID_INPUT");
    if (["function", "symbol", "bigint"].includes(typeof item)) throw new Error("WORKFLOW_INVALID_INPUT");
    if (!item || typeof item !== "object") return;
    if (seen.has(item)) throw new Error("WORKFLOW_INVALID_INPUT");
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error("WORKFLOW_INVALID_INPUT");
    seen.add(item);
    if (Object.getOwnPropertySymbols(item).length) throw new Error("WORKFLOW_INVALID_INPUT");
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      if (Array.isArray(item) && key === "length") continue;
      if (forbidden.has(key) || !("value" in descriptor) || !descriptor.enumerable) throw new Error("WORKFLOW_INVALID_INPUT");
      characters += key.length;
      walk(descriptor.value, depth + 1);
    }
    seen.delete(item);
  };
  walk(value, 0);
}

/** Resolve only bounded local references; unresolved/cyclic references remain explicit. */
export function resolveWorkflowReferences(input: unknown, document: unknown): { value: unknown; unresolved: boolean } {
  assertBoundedWorkflowValue(input);
  assertBoundedWorkflowValue(document);
  let nodes = 0, unresolved = false;
  const visit = (value: unknown, depth: number, refs: Set<string>): unknown => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw new Error("WORKFLOW_INPUT_TOO_LARGE");
    if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1, refs));
    if (!value || typeof value !== "object") return value;
    const source = record(value);
    if (typeof source.$ref === "string") {
      const ref = source.$ref;
      const extra = Object.keys(source).filter((key) => !["$ref", "description", "summary"].includes(key));
      let target: unknown = document;
      if (!ref.startsWith("#/") || refs.has(ref) || extra.length) { unresolved = true; return { ...source }; }
      for (const segment of ref.slice(2).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))) {
        if (forbidden.has(segment) || !target || typeof target !== "object" || !own(target, segment)) {
          unresolved = true; return { ...source };
        }
        target = (target as RecordValue)[segment];
      }
      return visit(target, depth + 1, new Set([...refs, ref]));
    }
    return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, visit(item, depth + 1, refs)]));
  };
  return { value: visit(input, 0, new Set()), unresolved };
}

export function workflowDocument(collection: Collection): RecordValue {
  const components = collection.openApi?.components ?? {};
  return { components, ...(collection.openApi?.sourceFormat === "swagger2" ? components : {}) };
}

const equal = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => equal(item, right[index]));
  if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
    const a = Object.keys(left), b = Object.keys(right);
    return a.length === b.length && a.every((key) => own(right, key) && equal(record(left)[key], record(right)[key]));
  }
  return false;
};
export const workflowValuesEqual = equal;

interface Sample { source: TestInputEvidence["source"]; value?: unknown }
function explicitSample(node: RecordValue): Sample | undefined {
  if (own(node, "example")) return { source: "example", value: node.example };
  for (const example of Object.values(record(node.examples))) {
    if (own(record(example), "value")) return { source: "example", value: record(example).value };
  }
  if (own(node, "default")) return { source: "default", value: node.default };
  return undefined;
}

function schemaSample(input: unknown, depth = 0): Sample {
  if (depth > MAX_DEPTH) throw new Error("WORKFLOW_INPUT_TOO_LARGE");
  const schema = record(input), direct = explicitSample(schema);
  if (direct) return direct;
  const properties = record(schema.properties);
  if (schema.type === "object" || Object.keys(properties).length) {
    const children = Object.entries(properties).map(([key, property]) => [key, schemaSample(property, depth + 1)] as const);
    return { source: children.length && children.every(([, child]) => ["example", "default"].includes(child.source))
      ? children.some(([, child]) => child.source === "example") ? "example" : "default" : "generated",
      value: Object.fromEntries(children.map(([key, child]) => [key, child.value])) };
  }
  if (schema.type === "array") {
    const child = schemaSample(schema.items, depth + 1);
    return { source: child.source, value: [child.value] };
  }
  if (schema.type === "boolean") return { source: "generated", value: true };
  if (schema.type === "number" || schema.type === "integer") return { source: "generated", value: 0 };
  if (schema.type === "string") return { source: "generated", value: schema.format === "date" ? "2026-01-01"
    : schema.format === "date-time" ? "2026-01-01T00:00:00.000Z" : "string" };
  return { source: "generated", value: {} };
}

function sensitive(value: unknown, field?: string): boolean {
  if (field && (isCredentialName(field) || isPersonalName(field))) return true;
  const text = JSON.stringify(value);
  return Boolean(text?.includes(REDACTED)) || !equal(value, redactAgentValue(value));
}

function evidence(location: TestInputEvidence["location"], field: string | undefined, sample: Sample,
  actual: unknown, schema: unknown, required: boolean): TestInputEvidence {
  const result: TestInputEvidence = { location, ...(field ? { field } : {}), source: sample.source, valid: false };
  if (sample.source === "none" && !required) return { ...result, valid: true };
  if (sample.source === "missing" || sample.source === "generated") return { ...result, reason: "No documented example or default is available for this input." };
  if (sensitive(sample.value, field) || sensitive(actual, field)) return { ...result, reason: "The input contains masked or sensitive example data." };
  if (!equal(actual, sample.value)) return { ...result, reason: "The saved input differs from its documented example or default." };
  const checked = validateWorkflowValue(actual, schema ?? {});
  if (checked.outcome !== "passed") return { ...result, reason: checked.outcome === "blocked"
    ? "The input schema cannot be safely validated." : "The documented input does not match its schema." };
  return { ...result, valid: true };
}

function mediaFrom(contentInput: unknown): RecordValue {
  const content = record(contentInput);
  return record(content["application/json"] ?? content["application/*+json"] ?? content["text/json"]
    ?? Object.values(content).find((value) => value && typeof value === "object"));
}

export interface WorkflowInputAnalysis {
  provenance: TestInputEvidence[];
  expectedStatuses: number[];
  responseSchema?: unknown;
  responseSchemas?: Record<string, unknown>;
  warnings: string[];
}

function parameterSchema(parameter: RecordValue): unknown {
  if (own(parameter, "schema")) return parameter.schema;
  // Swagger puts schema keywords directly on its parameter object.
  return Object.fromEntries(Object.entries(parameter).filter(([key]) => !["name", "in", "required", "description", "allowEmptyValue", "collectionFormat"].includes(key)));
}

function withoutSchemaExamples(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const output: RecordValue = {};
  for (const [key, value] of Object.entries(input)) {
    if (["example", "examples", "default", "description", "title", "externalDocs", "xml", "$comment"].includes(key)) continue;
    if (["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"].includes(key)) {
      output[key] = Object.fromEntries(Object.entries(record(value)).map(([name, schema]) => [name, withoutSchemaExamples(schema)]));
    } else if (["items", "additionalProperties", "contains", "not", "if", "then", "else", "propertyNames"].includes(key)) output[key] = withoutSchemaExamples(value);
    else if (["allOf", "anyOf", "oneOf", "prefixItems"].includes(key) && Array.isArray(value)) output[key] = value.map(withoutSchemaExamples);
    else output[key] = value;
  }
  return output;
}

/** Compare saved inputs against source evidence; never generate or modify a send payload. */
export function analyzeWorkflowInputs(request: ApiRequest, collection: Collection,
  ignoredAuth: { headers: string[]; query: string[] } = { headers: [], query: [] }): WorkflowInputAnalysis {
  assertBoundedWorkflowValue(request);
  const document = workflowDocument(collection);
  const resolved = resolveWorkflowReferences(request.openApi?.rawOperation ?? {}, document);
  const operation = record(resolved.value);
  const parameterResolution = resolveWorkflowReferences(request.openApi?.rawParameters ?? operation.parameters ?? [], document);
  const parameters = (Array.isArray(parameterResolution.value) ? parameterResolution.value.map(record) : []).filter((parameter) =>
    !(parameter.in === "header" && typeof parameter.name === "string" && ignoredAuth.headers.includes(parameter.name.toLowerCase())) &&
    !(parameter.in === "query" && typeof parameter.name === "string" && ignoredAuth.query.includes(parameter.name)));
  const provenance: TestInputEvidence[] = [];
  const warnings: string[] = [];
  if (resolved.unresolved || parameterResolution.unresolved) provenance.push({ location: "body", source: "missing", valid: false, reason: "The specification contains an unresolved or unsupported reference." });
  for (const [location, fields] of [["path", request.pathParams], ["query", request.queryParams], ["header", request.headers]] as const) {
    for (const field of fields.filter((item) => item.enabled && item.key)) {
      if (location === "header" && /^(content-type|accept)$/i.test(field.key)) continue;
      const parameter = parameters.find((item) => item.in === location && item.name === field.key);
      const required = location === "path" || parameter?.required === true;
      const schema = parameter ? parameterSchema(parameter) : {};
      const sample = parameter ? explicitSample(parameter) ?? explicitSample(record(schema)) : undefined;
      if (!sample) {
        provenance.push(evidence(location, field.key, { source: !required && !field.value ? "none" : "missing" }, field.value, schema, required));
        continue;
      }
      const expectedText = sample.value === null || sample.value === undefined ? ""
        : typeof sample.value === "object" ? JSON.stringify(sample.value) : String(sample.value);
      provenance.push(evidence(location, field.key, sample, field.value === expectedText ? sample.value : field.value, schema, required));
    }
    for (const parameter of parameters.filter((item) => item.in === location && (item.required === true || location === "path"))) {
      if (!fields.some((field) => field.enabled && field.key === parameter.name)) provenance.push({ location,
        field: typeof parameter.name === "string" ? parameter.name : undefined, source: "missing", valid: false, reason: "A required input is absent or disabled." });
    }
  }
  const bodyUsed = request.method !== "GET" && request.method !== "HEAD";
  const requestBody = record(operation.requestBody);
  const swaggerBody = parameters.find((parameter) => parameter.in === "body");
  const media = mediaFrom(requestBody.content);
  const requiredBody = requestBody.required === true || swaggerBody?.required === true || request.body.required === true;
  if (!bodyUsed && requiredBody) {
    provenance.push({ location: "body", source: "missing", valid: false, reason: "This HTTP method cannot send the required request body in the guided workflow." });
  } else if (bodyUsed && request.body.mode === "multipart") {
    provenance.push({ location: "body", source: "missing", valid: false, reason: "Multipart and file inputs require manual testing." });
  } else if (bodyUsed && request.body.mode === "form") {
    if (Object.keys(requestBody.content ?? {}).length || swaggerBody) {
      provenance.push({ location: "body", source: "missing", valid: false, reason: "The saved form body cannot be verified against this documented request body. Use manual testing." });
    } else if (requiredBody && !(request.body.form ?? []).some((field) => field.enabled && field.key)) {
      provenance.push({ location: "body", source: "missing", valid: false, reason: "A required request body is absent." });
    }
    for (const field of (request.body.form ?? []).filter((item) => item.enabled && item.key)) {
      const parameter = parameters.find((item) => item.in === "formData" && item.name === field.key);
      const sample = parameter ? explicitSample(parameter) ?? explicitSample(record(parameter.schema)) : undefined;
      const expectedText = sample?.value === null || sample?.value === undefined ? "" : String(sample.value);
      provenance.push(evidence("body", field.key, sample ?? { source: "missing" },
        sample && field.value === expectedText ? sample.value : field.value, parameter ? parameterSchema(parameter) : {}, parameter?.required === true));
    }
    for (const parameter of parameters.filter((item) => item.in === "formData" && item.required === true)) {
      if (!(request.body.form ?? []).some((field) => field.enabled && field.key === parameter.name)) provenance.push({ location: "body",
        field: typeof parameter.name === "string" ? parameter.name : undefined, source: "missing", valid: false, reason: "A required form input is absent or disabled." });
    }
  } else if (bodyUsed && request.body.mode !== "none" && request.body.raw) {
    const schema = media.schema ?? swaggerBody?.schema ?? request.body.schema ?? {};
    const sample = Object.keys(media).length ? explicitSample(media) ?? schemaSample(schema)
      : swaggerBody ? schemaSample(schema) : { source: "missing" as const };
    let actual: unknown = request.body.raw;
    if (request.body.mode === "json" || request.body.contentType?.includes("json")) {
      try { actual = JSON.parse(request.body.raw); assertBoundedWorkflowValue(actual); }
      catch { provenance.push({ location: "body", source: sample.source, valid: false, reason: "The saved JSON body is malformed or exceeds workflow limits." }); }
    }
    provenance.push(evidence("body", undefined, sample, actual, schema, requiredBody));
  } else if (bodyUsed && requiredBody) {
    provenance.push({ location: "body", source: "missing", valid: false, reason: "A required request body is absent." });
  }
  if (!provenance.length) provenance.push({ location: "body", source: "none", valid: true });
  const responses = record(operation.responses);
  const statuses = Object.keys(responses).filter((status) => /^2\d\d$/.test(status)).map(Number).sort((a, b) => a - b);
  const hasSuccessClass = Object.keys(responses).some((key) => key.toUpperCase() === "2XX");
  const expectedStatuses = statuses.length && !hasSuccessClass ? statuses : Array.from({ length: 100 }, (_, index) => 200 + index);
  const responseSchemas: Record<string, unknown> = {};
  for (const status of Object.keys(responses).filter((key) => /^2\d\d$/.test(key) || key.toUpperCase() === "2XX" || key === "default")) {
    const response = record(responses[status]);
    const schema = mediaFrom(response.content).schema ?? response.schema;
    if (schema !== undefined) responseSchemas[status === "default" ? "default" : status.toUpperCase()] = withoutSchemaExamples(schema);
  }
  const schemas = statuses.map((status) => responseSchemas[String(status)]);
  let responseSchema: unknown;
  if (!hasSuccessClass && schemas.length && schemas.every((schema) => schema !== undefined && equal(schema, schemas[0]))) responseSchema = schemas[0];
  return { provenance, expectedStatuses, ...(responseSchema !== undefined ? { responseSchema } : {}),
    ...(Object.keys(responseSchemas).length ? { responseSchemas } : {}), warnings };
}
