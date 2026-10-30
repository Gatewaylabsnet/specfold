import { expect, it } from "vitest";
import { createCollection, createRequest } from "../src/model/factory";
import { generateSyntheticJson, syntheticBodyDraft } from "../src/workflow/syntheticData";
import { analyzeWorkflowInputs } from "../src/workflow/provenance";
import { validateWorkflowValue } from "../src/workflow/assertions";

it("creates reproducible bounded nested drafts satisfying supported constraints without copying examples", () => {
  const schema = { type: "object", properties: { count: { type: "integer", minimum: 4, maximum: 10, multipleOf: 2 }, tags: { type: "array", minItems: 2, items: { type: "string", minLength: 3, maxLength: 7 } }, enabled: { type: "boolean" } }, required: ["count"], example: { count: 5, private: "DO_NOT_COPY" } };
  const draft = generateSyntheticJson(schema, 123);
  expect(draft.status).toBe("ready"); expect(draft).toEqual(generateSyntheticJson(schema, 123));
  expect(draft.json).not.toContain("DO_NOT_COPY"); expect(validateWorkflowValue(JSON.parse(draft.json!), schema).outcome).toBe("passed");
  expect(draft.json).not.toEqual(generateSyntheticJson(schema, 124).json);
});
it("omits optional personal/credential fields and blocks required ones and copied string enums", () => {
  const properties = { label: { type: "string" }, access_token: { type: "string" }, email: { type: "string" } };
  expect(generateSyntheticJson({ type: "object", properties }, 1).json).not.toMatch(/access_token|email/);
  expect(generateSyntheticJson({ type: "object", properties, required: ["access_token"] }, 1).status).toBe("blocked");
  expect(generateSyntheticJson({ type: "string", enum: ["DO_NOT_COPY"] }, 1).json).toBeUndefined();
  expect(generateSyntheticJson({ type: "integer", enum: [123456] }, 1).json).toBeUndefined();
});
it("blocks unsupported constraints, unsafe structures, excessive bounds and invalid seeds without echoing input", () => {
  for (const schema of [{ type: "string", pattern: "PRIVATE_PATTERN" }, { type: "array", minItems: 10000 }, { type: "string", minLength: 9999 }, { $ref: "https://external.invalid/schema" }, JSON.parse('{"type":"object","properties":{"__proto__":{}}}')]) expect(generateSyntheticJson(schema, 1).status).toBe("blocked");
  const cyclic: Record<string, unknown> = {}; cyclic.items = cyclic;
  expect(generateSyntheticJson(cyclic, 1).status).toBe("blocked");
  expect(generateSyntheticJson({ type: "string" }, NaN).status).toBe("blocked");
  expect(JSON.stringify(generateSyntheticJson({ type: "string", pattern: "PRIVATE_PATTERN" }, 1))).not.toContain("PRIVATE_PATTERN");
});
it("resolves local body schemas but never makes a generated manual body into documented provenance", () => {
  const collection = createCollection("Synthetic API"), request = createRequest({ name: "Create item", method: "POST", url: "/items" });
  collection.openApi = { components: { schemas: { Item: { type: "object", properties: { count: { type: "integer" } }, required: ["count"] } } } };
  request.openApi = { rawOperation: { requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Item" } } } } } };
  const draft = syntheticBodyDraft(request, collection, 1); expect(draft.status).toBe("ready");
  request.body = { mode: "json", raw: draft.json, contentType: "application/json" };
  expect(analyzeWorkflowInputs(request, collection).provenance.some((item) => !item.valid)).toBe(true);
  expect(syntheticBodyDraft({ ...request, url: "/auth/jwt" }, collection, 1).status).toBe("blocked");
});
