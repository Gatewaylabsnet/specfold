import { isCredentialName, isPersonalName } from "../agent/redaction";
import { assertBoundedWorkflowValue } from "./provenance";
import type { WorkflowAssertion } from "./types";

interface RuleBase { id: string; requestId: string; path: string }
export type BusinessRule = RuleBase & (
  | { kind: "exists" }
  | { kind: "type"; type: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null" }
  | { kind: "range"; minimum: number; maximum: number }
  | { kind: "equals"; value: number | boolean | null }
);
const invalid = (): never => { throw new Error("INVALID_BUSINESS_RULES"); };
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e12;
function segments(path: unknown): string[] {
  if (typeof path !== "string" || path.length > 256 || (path !== "" && !path.startsWith("/"))) return invalid();
  const parts = path === "" ? [] : path.slice(1).split("/");
  if (parts.length > 8 || parts.some((key) => !/^(?:[A-Za-z_][\w-]{0,63}|0|[1-9]\d{0,3})$/.test(key) || ["__proto__", "constructor", "prototype"].includes(key) || isCredentialName(key) || isPersonalName(key) || /credential|session|bearer|patient|surname|first.?name|last.?name|iban|card.?number/i.test(key))) return invalid();
  return parts;
}
/** Declarative bounded rules only. No string constants, scripts, regex or variable evaluation. */
export function validateBusinessRules(input: unknown): BusinessRule[] {
  assertBoundedWorkflowValue(input);
  if (!Array.isArray(input) || input.length > 16) return invalid();
  const rules = input.map((rule) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule) || !identifier(rule.id) || !identifier(rule.requestId)) return invalid();
    segments(rule.path);
    const keys = ["id", "requestId", "path", "kind"];
    if (rule.kind === "type") {
      keys.push("type"); if (!["string", "number", "integer", "boolean", "object", "array", "null"].includes(rule.type)) return invalid();
    } else if (rule.kind === "range") {
      keys.push("minimum", "maximum"); if (!number(rule.minimum) || !number(rule.maximum) || rule.minimum > rule.maximum) return invalid();
    } else if (rule.kind === "equals") {
      keys.push("value"); if (rule.value !== null && typeof rule.value !== "boolean" && !number(rule.value)) return invalid();
    } else if (rule.kind !== "exists") return invalid();
    if (Object.keys(rule).some((key) => !keys.includes(key))) return invalid();
    return structuredClone(rule) as BusinessRule;
  });
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length) return invalid();
  return rules;
}

export function evaluateBusinessRules(input: BusinessRule[], response: { body: string; truncated?: boolean; error?: string }): WorkflowAssertion[] {
  const rules = validateBusinessRules(input);
  if (!rules.length) return [];
  const result = (rule: BusinessRule, outcome: WorkflowAssertion["outcome"], message: string): WorkflowAssertion => ({ name: "rule", ruleId: rule.id, outcome, message });
  let body: unknown;
  try {
    if (response.error || response.truncated || typeof response.body !== "string" || response.body.length > 512 * 1024) throw new Error();
    body = JSON.parse(response.body); assertBoundedWorkflowValue(body);
  } catch { return rules.map((rule) => result(rule, "blocked", "Rule evaluation requires a complete, bounded JSON response.")); }
  return rules.map((rule) => {
    let value = body, found = true;
    for (const key of segments(rule.path)) {
      if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) { found = false; break; }
      value = (value as Record<string, unknown>)[key];
    }
    const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const passed = rule.kind === "exists" ? found : found && (rule.kind === "type" ? rule.type === "integer" ? Number.isSafeInteger(value) : type === rule.type
      : rule.kind === "range" ? typeof value === "number" && value >= rule.minimum && value <= rule.maximum : value === rule.value);
    return result(rule, passed ? "passed" : "failed", passed ? "The reviewed business rule passed." : "The reviewed business rule failed. Values and field paths are omitted.");
  });
}
