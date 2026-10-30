import type { ApiRequest, Collection } from "../model/types";
import { isCredentialName, isPersonalName } from "../agent/redaction";
import { assertBoundedWorkflowValue, resolveWorkflowReferences, workflowDocument } from "./provenance";
import { validateWorkflowValue } from "./assertions";

export interface SyntheticDraft { source: "generated"; status: "ready" | "blocked"; json?: string; warnings: string[] }
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const annotations = new Set(["title", "description", "example", "examples", "default", "deprecated", "readOnly", "writeOnly"]);
const supported = new Set(["type", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "enum", "const", "nullable", ...annotations]);
const sensitive = (key: string) => isCredentialName(key) || isPersonalName(key) || /credential|session|bearer|patient|surname|first.?name|last.?name|iban|card.?number/i.test(key);
class SyntheticIssue extends Error {}
const blocked = (message: string): never => { throw new SyntheticIssue(message); };

/** Seeded, bounded, offline generation. Examples/defaults and string enums are never copied. */
export function generateSyntheticJson(schema: unknown, seed: number): SyntheticDraft {
  const warnings = new Set<string>(); let nodes = 0, state = seed >>> 0;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  function generate(input: unknown, depth: number): unknown {
    if (++nodes > 500 || depth > 8) return blocked("The schema exceeds synthetic generation limits.");
    const s = object(input);
    if (input === false || !Object.keys(s).length || Object.keys(s).some((key) => !supported.has(key))) return blocked("This schema uses unsupported or unspecified constraints. No draft was applied.");
    if (Object.hasOwn(s, "const") || Array.isArray(s.enum)) {
      const choices = Object.hasOwn(s, "const") ? [s.const] : s.enum as unknown[];
      if (!choices.length || choices.some((value) => value !== null && typeof value !== "boolean")) return blocked("String, numeric and structured enum/constant values are not copied into synthetic drafts.");
      return choices[Math.floor(next() * choices.length)];
    }
    switch (s.type) {
      case "object": {
        const properties = object(s.properties), required = Array.isArray(s.required) ? s.required : [];
        if (Object.keys(properties).length > 32) return blocked("Too many object properties for a synthetic draft.");
        const value: Record<string, unknown> = {};
        for (const key of Object.keys(properties).sort()) {
          if (["__proto__", "constructor", "prototype"].includes(key)) return blocked("Unsafe property names are not supported.");
          if (sensitive(key)) {
            warnings.add("Sensitive properties were omitted; no credentials or personal data were generated.");
            if (required.includes(key)) return blocked("A required sensitive property needs deliberate manual input; no synthetic payload was produced.");
            continue;
          }
          value[key] = generate(properties[key], depth + 1);
        }
        return value;
      }
      case "array": {
        const minimum = typeof s.minItems === "number" ? s.minItems : 0, maximum = typeof s.maxItems === "number" ? s.maxItems : 4;
        if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 0 || minimum > 16 || maximum < minimum) return blocked("Array bounds exceed supported generation limits.");
        const size = Math.min(16, maximum, Math.max(minimum, 1));
        return Array.from({ length: size }, () => generate(s.items, depth + 1));
      }
      case "string": {
        const minimum = typeof s.minLength === "number" ? s.minLength : 1, maximum = typeof s.maxLength === "number" ? s.maxLength : Math.max(12, minimum);
        if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 0 || minimum > 256 || maximum < minimum) return blocked("String bounds exceed supported generation limits.");
        const length = Math.min(maximum, Math.max(minimum, 8));
        return Array.from({ length }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(next() * 26)]).join("");
      }
      case "number": case "integer": {
        const step = typeof s.multipleOf === "number" ? s.multipleOf : 1;
        let low = typeof s.minimum === "number" ? s.minimum : 0, high = typeof s.maximum === "number" ? s.maximum : Math.max(100, low);
        if (typeof s.exclusiveMinimum === "number") low = Math.max(low, s.exclusiveMinimum + step);
        if (typeof s.exclusiveMaximum === "number") high = Math.min(high, s.exclusiveMaximum - step);
        if (s.exclusiveMinimum === true) low += step;
        if (s.exclusiveMaximum === true) high -= step;
        if (![low, high, step].every(Number.isFinite) || Math.abs(low) > 1e6 || Math.abs(high) > 1e6 || step <= 0 || high < low) return blocked("Numeric bounds exceed supported generation limits.");
        const first = Math.ceil(low / step), last = Math.floor(high / step);
        if (last < first) return blocked("No value could be generated within these numeric bounds.");
        return Number(((first + Math.floor(next() * (last - first + 1))) * step).toPrecision(12));
      }
      case "boolean": return next() >= 0.5;
      case "null": return null;
      default: return blocked("Choose an explicit supported schema type before generating data.");
    }
  }
  try {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return blocked("Use an integer seed between 0 and 4294967295.");
    assertBoundedWorkflowValue(schema);
    const value = generate(schema, 0), checked = validateWorkflowValue(value, schema);
    if (checked.outcome !== "passed") return blocked("A draft could not satisfy every supported schema constraint. Use manual input.");
    const json = JSON.stringify(value, null, 2);
    if (json.length > 16 * 1024) return blocked("The synthetic draft exceeds 16 KB.");
    return { source: "generated", status: "ready", json, warnings: [...warnings] };
  } catch (error) {
    return { source: "generated", status: "blocked", warnings: [error instanceof SyntheticIssue ? error.message : "The schema could not be inspected safely."] };
  }
}

export function syntheticBodyDraft(request: ApiRequest, collection: Collection, seed: number): SyntheticDraft {
  const fail = (): SyntheticDraft => ({ source: "generated", status: "blocked", warnings: ["A supported JSON request-body schema is required. Multipart, token endpoints and unresolved references need manual input."] });
  try {
    if (["GET", "HEAD"].includes(request.method) || /(?:auth|oauth|jwt|token)/i.test(request.url.split(/[?#]/)[0])) return fail();
    const operation = object(request.openApi?.rawOperation), body = object(operation.requestBody), content = object(body.content);
    const media = object(content["application/json"]);
    const swagger = request.openApi?.rawParameters?.find((item) => object(item).in === "body");
    const source = media.schema ?? object(swagger).schema;
    if (source === undefined) return fail();
    const resolved = resolveWorkflowReferences(source, workflowDocument(collection));
    return resolved.unresolved ? fail() : generateSyntheticJson(resolved.value, seed);
  } catch { return fail(); }
}
