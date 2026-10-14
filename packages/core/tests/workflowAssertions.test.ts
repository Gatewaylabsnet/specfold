import { describe, expect, it, vi } from "vitest";
import { evaluateWorkflowResponse, validateWorkflowValue } from "../src/workflow/assertions";
import type { WorkflowTestRow } from "../src/workflow/types";

const row = (schema?: unknown): WorkflowTestRow => ({ requestId: "synthetic", name: "Read sample", method: "GET",
  route: "/sample", effect: "read", selected: true, status: "ready", provenance: [], expectedStatuses: [200, 201], responseSchema: schema });
const evaluate = (schema: unknown, value: unknown) => validateWorkflowValue(value, schema);
const response = (schema?: unknown, body = "{}", extra = {}) => evaluateWorkflowResponse(row(schema), { status: 200, body, ...extra });

describe("workflow response assertions", () => {
  it("keeps status mismatches separate from a valid response schema", () => {
    const assertions = response({ type: "object" }, "{}", { status: 404 });
    expect(assertions.map((item) => item.outcome)).toEqual(["failed", "passed"]);
    expect(response(undefined, "not JSON").map((item) => item.outcome)).toEqual(["passed", "skipped"]);
    expect(evaluateWorkflowResponse({ ...row(), expectedStatuses: [] }, { status: 200, body: "{}" })[0].outcome).toBe("blocked");
  });
  it("never echoes transport errors or invalid JSON contents", () => {
    const secret = "SYNTHETIC_PRIVATE_VALUE";
    expect(response({}, secret)[1].outcome).toBe("failed");
    const error = response({}, secret, { status: 0, error: secret });
    expect(error.map((item) => item.outcome)).toEqual(["failed", "skipped"]);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(JSON.stringify(response({ type: "number" }, JSON.stringify(secret)))).not.toContain(secret);
  });
  it("blocks truncated or oversized bodies instead of passing partial JSON", () => {
    expect(response({ type: "object" }, "{}", { truncated: true })[1].outcome).toBe("blocked");
    expect(response({}, " ".repeat(1_000_001))[1].outcome).toBe("blocked");
  });
  it("selects exact status, then class, then default, then the legacy schema", () => {
    const test = { ...row({ const: "legacy" }), responseSchemas: { "201": { const: "exact" }, "2XX": { const: "class" }, default: { const: "default" } } };
    for (const [status, body] of [[201, "exact"], [200, "class"], [400, "default"]] as const) {
      expect(evaluateWorkflowResponse(test, { status, body: JSON.stringify(body) })[1].outcome).toBe("passed");
    }
    expect(evaluateWorkflowResponse(test, { status: 201, body: '"class"' })[1].outcome).toBe("failed");
    expect(evaluateWorkflowResponse({ ...test, responseSchemas: {} }, { status: 200, body: '"legacy"' })[1].outcome).toBe("passed");
    expect(evaluateWorkflowResponse({ ...test, responseSchemas: Object.create({ "200": {} }) }, { status: 200, body: "{}" })[1].outcome).toBe("blocked");
  });
});

describe("bounded OpenAPI schema assertions", () => {
  it("checks object required fields, declared properties and typed additional properties", () => {
    const schema = { type: "object", required: ["name"], properties: { name: { type: "string" } }, additionalProperties: { type: "integer" } };
    expect(evaluate(schema, { name: "sample", count: 2 }).outcome).toBe("passed");
    expect(evaluate(schema, {}).outcome).toBe("failed");
    expect(evaluate(schema, { name: "sample", count: "private" }).outcome).toBe("failed");
    expect(evaluate({ ...schema, additionalProperties: false }, { name: "sample", extra: 1 }).outcome).toBe("failed");
    expect(evaluate({ type: "object", minProperties: 1, maxProperties: 1 }, {}).outcome).toBe("failed");
    expect(evaluate({ type: "object", maxProperties: 1 }, { a: 1, b: 2 }).outcome).toBe("failed");
  });
  it("checks nullable values, union types, enum and const without leaking allowed values", () => {
    expect(evaluate({ type: "string", nullable: true }, null).outcome).toBe("passed");
    expect(evaluate({ type: ["string", "null"] }, null).outcome).toBe("passed");
    expect(evaluate({ type: "string" }, null).outcome).toBe("failed");
    expect(evaluate({ enum: [{ a: 1, b: 2 }] }, { b: 2, a: 1 }).outcome).toBe("passed");
    const result = evaluate({ const: "SYNTHETIC_EXPECTED_SECRET" }, "SYNTHETIC_ACTUAL_SECRET");
    expect(result.outcome).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC");
    expect(evaluate(true, [1, true, null]).outcome).toBe("passed");
    expect(evaluate(false, null).outcome).toBe("failed");
  });
  it("checks array lengths, nested items and structural uniqueness", () => {
    const schema = { type: "array", minItems: 1, maxItems: 2, items: { type: "integer" }, uniqueItems: true };
    expect(evaluate(schema, [1, 2]).outcome).toBe("passed");
    for (const invalid of [[], [1, 2, 3], [1, "2"], [1, 1]]) expect(evaluate(schema, invalid).outcome).toBe("failed");
    expect(evaluate({ uniqueItems: true }, [{ a: 1, b: 2 }, { b: 2, a: 1 }]).outcome).toBe("failed");
  });
  it("counts Unicode code points and checks precise decimal increments and bounds", () => {
    expect(evaluate({ type: "string", minLength: 1, maxLength: 1 }, "😀").outcome).toBe("passed");
    expect(evaluate({ minLength: 2 }, "😀").outcome).toBe("failed");
    expect(evaluate({ type: "number", minimum: 0, maximum: 1, multipleOf: 0.1 }, 0.3).outcome).toBe("passed");
    expect(evaluate({ multipleOf: 0.1 }, 0.30000000000000004).outcome).toBe("failed");
    expect(evaluate({ type: "integer" }, 1.5).outcome).toBe("failed");
    for (const schema of [{ minimum: 1 }, { exclusiveMinimum: 0 }, { minimum: 0, exclusiveMinimum: true }]) expect(evaluate(schema, 0).outcome).toBe("failed");
    for (const schema of [{ maximum: 1 }, { exclusiveMaximum: 2 }, { maximum: 2, exclusiveMaximum: true }]) expect(evaluate(schema, 2).outcome).toBe("failed");
    expect(evaluate({}, Number.MAX_SAFE_INTEGER + 1).outcome).toBe("blocked");
  });
  it.each([
    { $ref: "#/components/schemas/Hidden" }, { oneOf: [{ type: "string" }] }, { pattern: "(a+)+$" },
    { format: "email" }, { type: "file" }, { type: ["string", "string"] }, { minLength: -1 },
    { properties: [] }, { required: [1] }, { exclusiveMinimum: true }, { multipleOf: 0 }, { enum: [] },
    { items: [{ type: "string" }] }, { unknownConstraint: true }, null
  ])("blocks unsupported or malformed constraints rather than silently passing: %j", (schema) => {
    expect(evaluate(schema, {}).outcome).toBe("blocked");
  });
  it("preflights unsupported nested schemas even when the optional field is absent", () => {
    expect(evaluate({ type: "object", properties: { unused: { oneOf: [{ type: "string" }] } } }, {}).outcome).toBe("blocked");
    expect(evaluate({ type: "object", properties: { unused: { $ref: "https://example.invalid/private" } } }, {}).outcome).toBe("blocked");
    expect(evaluate({ type: "string", description: "annotation", example: "sample", "x-note": "metadata" }, "value").outcome).toBe("passed");
  });
  it("rejects unsafe prototypes, getters, dangerous property names and cycles without invoking accessors", () => {
    const getter = vi.fn(() => "string");
    const schema = Object.defineProperty({}, "type", { enumerable: true, get: getter });
    expect(evaluate(schema, "sample").outcome).toBe("blocked");
    expect(getter).not.toHaveBeenCalled();
    expect(evaluate(Object.create({ type: "string" }), "sample").outcome).toBe("blocked");
    expect(evaluate(JSON.parse('{"properties":{"__proto__":{"type":"string"}}}'), {}).outcome).toBe("blocked");
    expect(evaluate({}, JSON.parse('{"__proto__":{"polluted":true}}')).outcome).toBe("blocked");
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(evaluate({}, cyclic).outcome).toBe("blocked");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("bounds schema size, input depth, input size and expensive uniqueness comparisons", () => {
    const properties = Object.fromEntries(Array.from({ length: 2_001 }, (_, index) => [`field${index}`, {}]));
    expect(evaluate({ properties }, {}).outcome).toBe("blocked");
    let nested: unknown = null;
    for (let index = 0; index < 30; index++) nested = { next: nested };
    expect(evaluate({}, nested).outcome).toBe("blocked");
    expect(evaluate({}, Array(20_001).fill(0)).outcome).toBe("blocked");
    expect(evaluate({ uniqueItems: true }, Array.from({ length: 320 }, (_, index) => index)).outcome).toBe("blocked");
  });
});
