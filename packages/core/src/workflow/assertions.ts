import type { WorkflowAssertion, WorkflowTestRow } from "./types";

export interface WorkflowValueValidation {
  outcome: "passed" | "failed" | "blocked";
  message: string;
}
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Schema = boolean | { [key: string]: Json };
const MAX_BODY = 1_000_000, MAX_DEPTH = 24, MAX_SCHEMA_NODES = 2_000, MAX_VALUE_NODES = 20_000;
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);
const types = new Set(["null", "boolean", "object", "array", "number", "integer", "string"]);
const annotations = new Set(["title", "description", "default", "example", "examples", "deprecated", "readOnly", "writeOnly", "xml", "externalDocs", "$comment"]);
const integerBounds = new Set(["minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"]);
const numberBounds = new Set(["minimum", "maximum", "multipleOf"]);
const keywords = new Set(["type", "nullable", "properties", "required", "additionalProperties", "items", "enum", "const", "uniqueItems", "exclusiveMinimum", "exclusiveMaximum", ...integerBounds, ...numberBounds]);
class Issue extends Error {
  constructor(readonly outcome: "failed" | "blocked", message: string) { super(message); }
}
const block = (message: string): never => { throw new Issue("blocked", message); };
const fail = (path: string, expectation: string): never => { throw new Issue("failed", `${path} ${expectation}.`); };
const object = (value: Json): value is { [key: string]: Json } => value !== null && typeof value === "object" && !Array.isArray(value);
const childPath = (path: string, key: string) => path.length > 160 ? "$[nested]" : `${path}${/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) ? `.${key}` : "[property]"}`;

/** Copy only bounded, ordinary JSON data. Getters and prototype-bearing objects are never evaluated. */
function safeJson(input: unknown, limit: number): Json {
  let remaining = limit, characters = MAX_BODY;
  const copy = (value: unknown, depth: number): Json => {
    if (--remaining < 0 || depth > MAX_DEPTH) return block("Validation exceeded its safe structural limit.");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))
      ? value : block("Validation requires finite numbers within safe integer precision.");
    if (typeof value === "string") {
      characters -= value.length;
      return characters >= 0 ? value : block("Validation exceeded its safe text limit.");
    }
    if (typeof value !== "object") return block("Validation requires ordinary JSON data.");
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== (array ? Array.prototype : Object.prototype)) return block("Validation rejected an unsafe object prototype.");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length) return block("Validation requires ordinary JSON properties.");
    const keys = Object.keys(descriptors);
    if (keys.length > remaining + 1) return block("Validation exceeded its safe structural limit.");
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length > remaining || keys.length !== length + 1) return block("Validation requires a bounded JSON array.");
      const result: Json[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor)) return block("Validation rejected an unsafe array property.");
        result.push(copy(descriptor.value, depth + 1));
      }
      return result;
    }
    const result: { [key: string]: Json } = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (unsafeKeys.has(key) || !("value" in descriptor) || !descriptor.enumerable) return block("Validation rejected an unsafe object property.");
      characters -= key.length;
      if (characters < 0) return block("Validation exceeded its safe text limit.");
      result[key] = copy(descriptor.value, depth + 1);
    }
    return result;
  };
  return copy(input, 0);
}

function preflight(schema: Json, path = "$schema"): asserts schema is Schema {
  if (typeof schema === "boolean") return;
  if (!object(schema)) return block(`Schema at ${path} must be an object or boolean.`);
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$ref") return block(`Schema at ${path} contains an unresolved reference.`);
    if (annotations.has(key) || key.startsWith("x-")) continue;
    if (!keywords.has(key)) return block(`Schema at ${path} contains an unsupported constraint.`);
    if (key === "type") {
      const names = Array.isArray(value) ? value : [value];
      if (!names.length || names.some((name) => typeof name !== "string" || !types.has(name)) || new Set(names).size !== names.length) return block(`Schema at ${path} has an unsupported type.`);
    } else if (key === "nullable" || key === "uniqueItems") {
      if (typeof value !== "boolean") return block(`Schema at ${path} has a malformed boolean constraint.`);
    } else if (integerBounds.has(key)) {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return block(`Schema at ${path} has a malformed size constraint.`);
    } else if (numberBounds.has(key)) {
      if (typeof value !== "number" || (key === "multipleOf" && value <= 0)) return block(`Schema at ${path} has a malformed numeric constraint.`);
    } else if (key === "exclusiveMinimum" || key === "exclusiveMaximum") {
      if (typeof value !== "number" && typeof value !== "boolean") return block(`Schema at ${path} has a malformed numeric constraint.`);
      const bound = key === "exclusiveMinimum" ? "minimum" : "maximum";
      if (value === true && typeof schema[bound] !== "number") return block(`Schema at ${path} requires a bound for exclusivity.`);
    } else if (key === "required") {
      if (!Array.isArray(value) || value.some((name) => typeof name !== "string" || unsafeKeys.has(name)) || new Set(value).size !== value.length) return block(`Schema at ${path} has malformed required properties.`);
    } else if (key === "properties") {
      if (!object(value)) return block(`Schema at ${path} has malformed properties.`);
      for (const [name, child] of Object.entries(value)) preflight(child, childPath(path, name));
    } else if (key === "items" || key === "additionalProperties") preflight(value, `${path}.${key}`);
    else if (key === "enum" && (!Array.isArray(value) || !value.length || value.length > 128)) return block(`Schema at ${path} has an unsupported enumeration.`);
  }
}

function validate(value: Json, root: Schema): void {
  let comparisons = 50_000, visits = MAX_VALUE_NODES * 2;
  const equal = (left: Json, right: Json): boolean => {
    if (--comparisons < 0) return block("Validation exceeded its safe comparison limit.");
    if (left === right) return true;
    if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => equal(item, right[index]));
    if (object(left) && object(right)) {
      const keys = Object.keys(left);
      return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]));
    }
    return false;
  };
  const matchesType = (item: Json, type: Json): boolean => type === "null" ? item === null
    : type === "array" ? Array.isArray(item) : type === "object" ? object(item)
      : type === "integer" ? typeof item === "number" && Number.isInteger(item) : typeof item === type;
  const visit = (item: Json, schema: Schema, path: string): void => {
    if (--visits < 0) return block("Validation exceeded its safe evaluation limit.");
    if (schema === true) return;
    if (schema === false) return fail(path, "is forbidden by the schema");
    if (schema.type !== undefined) {
      const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!(item === null && schema.nullable === true) && !allowed.some((type) => matchesType(item, type))) return fail(path, "does not match the declared type");
    }
    if (Array.isArray(schema.enum) && !schema.enum.some((choice) => equal(item, choice))) return fail(path, "does not match an allowed value");
    if (Object.hasOwn(schema, "const") && !equal(item, schema.const)) return fail(path, "does not match the declared constant");
    if (typeof item === "string") {
      let length = 0;
      for (const _character of item) length++;
      if (typeof schema.minLength === "number" && length < schema.minLength) return fail(path, "is shorter than the declared minimum length");
      if (typeof schema.maxLength === "number" && length > schema.maxLength) return fail(path, "exceeds the declared maximum length");
    }
    if (typeof item === "number") {
      if (typeof schema.minimum === "number" && item < schema.minimum) return fail(path, "is below the declared minimum");
      if (typeof schema.maximum === "number" && item > schema.maximum) return fail(path, "exceeds the declared maximum");
      const minimum = schema.exclusiveMinimum === true ? schema.minimum : schema.exclusiveMinimum;
      const maximum = schema.exclusiveMaximum === true ? schema.maximum : schema.exclusiveMaximum;
      if (typeof minimum === "number" && item <= minimum) return fail(path, "does not satisfy the exclusive minimum");
      if (typeof maximum === "number" && item >= maximum) return fail(path, "does not satisfy the exclusive maximum");
      if (typeof schema.multipleOf === "number" && !isMultiple(item, schema.multipleOf)) return fail(path, "does not satisfy the declared numeric increment");
    }
    if (Array.isArray(item)) {
      if (typeof schema.minItems === "number" && item.length < schema.minItems) return fail(path, "contains fewer items than required");
      if (typeof schema.maxItems === "number" && item.length > schema.maxItems) return fail(path, "contains too many items");
      if (schema.uniqueItems === true) for (let index = 0; index < item.length; index++) {
        for (let previous = 0; previous < index; previous++) if (equal(item[index], item[previous])) return fail(path, "contains duplicate items");
      }
      if (schema.items !== undefined) item.forEach((entry, index) => visit(entry, schema.items as Schema, `${path}[${index}]`));
    } else if (object(item)) {
      const keys = Object.keys(item);
      if (typeof schema.minProperties === "number" && keys.length < schema.minProperties) return fail(path, "contains fewer properties than required");
      if (typeof schema.maxProperties === "number" && keys.length > schema.maxProperties) return fail(path, "contains too many properties");
      if (Array.isArray(schema.required)) for (const name of schema.required as string[]) {
        if (!Object.hasOwn(item, name)) return fail(childPath(path, name), "is required");
      }
      const properties = object(schema.properties ?? null) ? schema.properties as { [key: string]: Json } : {};
      for (const key of keys) {
        if (Object.hasOwn(properties, key)) visit(item[key], properties[key] as Schema, childPath(path, key));
        else if (schema.additionalProperties === false) return fail(path, "contains an undeclared property");
        else if (schema.additionalProperties !== undefined && schema.additionalProperties !== true) visit(item[key], schema.additionalProperties as Schema, childPath(path, key));
      }
    }
  };
  visit(value, root, "$");
}

/** Decimal arithmetic avoids binary floating-point false failures for values such as 0.3 / 0.1. */
function isMultiple(value: number, step: number): boolean {
  const decimal = (number: number): [bigint, number] => {
    const [mantissa, exponent = "0"] = String(number).split("e");
    const fraction = mantissa.split(".")[1]?.length ?? 0;
    return [BigInt(mantissa.replace(".", "")), Number(exponent) - fraction];
  };
  const [valueInteger, valueExponent] = decimal(value), [stepInteger, stepExponent] = decimal(step);
  const difference = valueExponent - stepExponent;
  return difference >= 0 ? (valueInteger * 10n ** BigInt(difference)) % stepInteger === 0n
    : valueInteger % (stepInteger * 10n ** BigInt(-difference)) === 0n;
}

/** Supported constraints are checked exhaustively; unknown constraints never count as a pass. */
export function validateWorkflowValue(value: unknown, schema: unknown): WorkflowValueValidation {
  try {
    const safeSchema = safeJson(schema, MAX_SCHEMA_NODES);
    preflight(safeSchema);
    validate(safeJson(value, MAX_VALUE_NODES), safeSchema);
    return { outcome: "passed", message: "Value satisfies the supported schema." };
  } catch (error) {
    return error instanceof Issue ? { outcome: error.outcome, message: error.message }
      : { outcome: "blocked", message: "Validation could not safely inspect the supplied data." };
  }
}

export function evaluateWorkflowResponse(row: WorkflowTestRow,
  response: { status: number; body: string; truncated?: boolean; error?: string }): WorkflowAssertion[] {
  const assertion = (name: WorkflowAssertion["name"], outcome: WorkflowAssertion["outcome"], message: string): WorkflowAssertion => ({ name, outcome, message });
  if (response.error || !Number.isInteger(response.status) || response.status < 100 || response.status > 599) return [
    assertion("status", "failed", "A usable HTTP response was not received."),
    assertion("schema", "skipped", "Schema validation requires a usable HTTP response.")
  ];
  const statuses = row.expectedStatuses;
  const status = !Array.isArray(statuses) || !statuses.length || statuses.length > 500 || statuses.some((code) => !Number.isInteger(code) || code < 100 || code > 599)
    ? assertion("status", "blocked", "Expected HTTP statuses are missing or invalid.")
    : assertion("status", statuses.includes(response.status) ? "passed" : "failed", statuses.includes(response.status) ? "HTTP status matches the test plan." : "HTTP status does not match the test plan.");
  let schema = row.responseSchema;
  try {
    if (row.responseSchemas !== undefined) {
      const schemas = safeJson(row.responseSchemas, MAX_SCHEMA_NODES);
      if (object(schemas)) {
        const key = [String(response.status), `${Math.floor(response.status / 100)}XX`, "default"].find((candidate) => Object.hasOwn(schemas, candidate));
        if (key !== undefined) schema = schemas[key];
      } else block("Response schemas must be a safe status-to-schema object.");
    }
  } catch (error) {
    return [status, assertion("schema", "blocked", error instanceof Issue ? error.message : "Response schema selection could not be inspected safely.")];
  }
  if (schema === undefined) return [status, assertion("schema", "skipped", "No response schema was declared; only the HTTP status was checked.")];
  if (response.truncated) return [status, assertion("schema", "blocked", "The response body was truncated; schema validation is incomplete.")];
  if (typeof response.body !== "string" || response.body.length > MAX_BODY) return [status, assertion("schema", "blocked", "The response exceeds the safe JSON validation limit.")];
  let value: unknown;
  try { value = JSON.parse(response.body); }
  catch { return [status, assertion("schema", "failed", "The response body is not valid JSON.")]; }
  return [status, { name: "schema", ...validateWorkflowValue(value, schema) }];
}
