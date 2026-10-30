import { expect, it } from "vitest";
import { evaluateBusinessRules, validateBusinessRules, type BusinessRule } from "../src/workflow/businessRules";
import { buildWorkflowTestPlan, createCollection, createEmptyWorkspace, createRequest } from "../src/index";
const base = { id: "rule-1", requestId: "request-1", path: "/summary/count" };
it("checks exists, primitive type, numeric ranges and non-string equality without echoing response data", () => {
  const rules: BusinessRule[] = [{ ...base, kind: "exists" }, { ...base, id: "rule-2", kind: "type", type: "integer" }, { ...base, id: "rule-3", kind: "range", minimum: 1, maximum: 5 }, { ...base, id: "rule-4", path: "/enabled", kind: "equals", value: true }];
  const results = evaluateBusinessRules(rules, { body: '{"summary":{"count":3},"enabled":true,"private":"DO_NOT_ECHO"}' });
  expect(results.every((item) => item.outcome === "passed")).toBe(true);
  expect(JSON.stringify(results)).not.toMatch(/DO_NOT_ECHO|summary|count|enabled/);
  expect(evaluateBusinessRules(rules, { body: '{"summary":{"count":9},"enabled":false}' }).map((item) => item.outcome)).toEqual(["passed", "passed", "failed", "failed"]);
});
it("distinguishes absent/null/array values and blocks incomplete or unsupported JSON", () => {
  expect(evaluateBusinessRules([{ ...base, path: "/items/0", kind: "exists" }], { body: '{"items":[null]}' })[0].outcome).toBe("passed");
  expect(evaluateBusinessRules([{ ...base, path: "/absent", kind: "exists" }], { body: "{}" })[0].outcome).toBe("failed");
  for (const response of [{ body: "not-json" }, { body: "{}", truncated: true }, { body: "{}", error: "DO_NOT_ECHO" }, { body: "x".repeat(512 * 1024 + 1) }]) expect(evaluateBusinessRules([{ ...base, kind: "exists" }], response)[0].outcome).toBe("blocked");
});
it("rejects credential/PII/prototype paths, strings, unknown operators, excess depth and duplicate rules", () => {
  for (const path of ["/access_token", "/email", "/__proto__", "/constructor", "/a/../../x", "$.script()", "/" + Array(9).fill("field").join("/")]) expect(() => validateBusinessRules([{ ...base, path, kind: "exists" }])).toThrow();
  for (const rule of [{ ...base, kind: "equals", value: "SECRET" }, { ...base, kind: "regex", pattern: "private" }, { ...base, kind: "range", minimum: 10, maximum: 1 }, { ...base, kind: "exists", script: "eval()" }]) expect(() => validateBusinessRules([rule])).toThrow();
  const rule = { ...base, kind: "exists" }; expect(() => validateBusinessRules([rule, rule])).toThrow();
  expect(() => validateBusinessRules(Array.from({ length: 17 }, (_, i) => ({ ...rule, id: `rule-${i}` })))).toThrow();
});
it("blocks known-secret constraints without exposing definitions in a fresh plan", () => {
  const workspace = createEmptyWorkspace(), collection = createCollection("API"), request = createRequest({ name: "Read", url: "/read" });
  collection.requests = [request]; workspace.collections = [collection];
  workspace.environments[0].variables.push({ id: "secret", name: "token", value: "123", secret: true, enabled: true });
  const profile = { id: "setup", name: "Setup", collectionId: collection.id, environmentId: workspace.environments[0].id, baseUrl: "http://127.0.0.1:9", provider: "openapi" as const,
    source: { kind: "existing" as const, label: "API" }, auth: { kind: "none" as const }, rules: [{ id: "rule-constant", requestId: request.id, kind: "equals" as const, path: "/count", value: 123 }] };
  const row = buildWorkflowTestPlan(workspace, profile, { id: "fresh-plan", revision: "revision" }).rows[0];
  expect(row.status).toBe("blocked"); expect(row.rules).toBeUndefined(); expect(row.reason).toContain("credential");
});
