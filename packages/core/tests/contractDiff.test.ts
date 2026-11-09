import { expect, it } from "vitest";
import { contractCanonical, diffContractSchema, type ContractSeverity } from "../src/importers/contractSchemaDiff";
import { importApiDocument } from "../src/importers";
import { diffOpenApiContracts } from "../src/importers/contractDiff";
import { applySafeReimport, previewSafeReimport } from "../src/importers/reimport";
function document() {
  return { openapi: "3.0.3", info: { title: "Synthetic contract", version: "1" }, security: [] as unknown[], components: { schemas: {} as Record<string, unknown>, securitySchemes: {} as Record<string, unknown> },
    paths: { "/items/{id}": { get: { parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 0 } }, { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 0 } }],
      responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", required: ["count"], properties: { count: { type: "integer", minimum: 0 } } } } } } } } } } };
}
const collection = (value: unknown) => importApiDocument(JSON.stringify(value), { grouping: "tags" }).collection;
it("ignores formatting/description order but explains required inputs, narrowed bounds and weaker response guarantees", () => {
  const before = document(), after = structuredClone(before);
  expect(diffOpenApiContracts(collection(before), collection(after))).toEqual([]);
  after.paths["/items/{id}"].get.parameters[1].required = true;
  after.paths["/items/{id}"].get.parameters[1].schema.minimum = 5;
  after.paths["/items/{id}"].get.responses["200"].content["application/json"].schema.required = [];
  const changes = diffOpenApiContracts(collection(before), collection(after));
  expect(changes.some((item) => item.area.includes("query:limit") && item.severity === "breaking")).toBe(true);
  expect(changes.some((item) => item.message.includes("bound changed") && item.severity === "breaking")).toBe(true);
  expect(changes.some((item) => item.area.includes("response") && item.message.includes("Required object properties were removed") && item.severity === "breaking")).toBe(true);
  after.paths["/items/{id}"].get.responses["200"].description = "Only a description changed";
  expect(diffOpenApiContracts(collection(before), collection(after))).toEqual(changes);
});
it("reports literal restriction/auth changes without exposing enum values, and compares declared auth rather than user credentials", () => {
  const before = document(), after = structuredClone(before);
  Object.assign(before.paths["/items/{id}"].get.parameters[1].schema, { enum: ["PRIVATE_A", "PRIVATE_B"] });
  Object.assign(after.paths["/items/{id}"].get.parameters[1].schema, { enum: ["PRIVATE_A"] });
  after.security = [{ bearerAuth: [] }]; after.components.securitySchemes = { bearerAuth: { type: "http", scheme: "bearer" } };
  const changes = diffOpenApiContracts(collection(before), collection(after));
  expect(changes.some((item) => item.severity === "breaking" && item.area === "authentication")).toBe(true);
  expect(changes.some((item) => item.message.includes("Allowed literal values changed"))).toBe(true);
  expect(JSON.stringify(changes)).not.toContain("PRIVATE_");
  const a = collection(document()), b = collection(document());
  a.folders.forEach((folder) => folder.requests.forEach((request) => { request.auth = { type: "bearer", token: "PRIVATE_TOKEN" }; }));
  expect(diffOpenApiContracts(a, b)).toEqual([]);
});
it("reports unresolved/remote refs and unsupported schemas as unknown, never fetching them", () => {
  const before = document(), after = structuredClone(before);
  Object.assign(after.paths["/items/{id}"].get.responses["200"].content["application/json"].schema, { oneOf: [{ type: "string" }, { type: "number" }] });
  expect(diffOpenApiContracts(collection(before), collection(after)).some((item) => item.severity === "unknown")).toBe(true);
  Object.assign(after.paths["/items/{id}"].get.responses["200"].content["application/json"].schema, { $ref: "https://external.invalid/DO_NOT_FETCH" });
  const changes = diffOpenApiContracts(collection(before), collection(after));
  expect(changes.some((item) => item.severity === "unknown")).toBe(true); expect(JSON.stringify(changes)).not.toContain("DO_NOT_FETCH");
});
it("keeps safe import non-destructive, while classifying operations missing from the incoming spec", () => {
  const before = collection(document()), after = collection({ openapi: "3.0.3", info: { title: "New", version: "2" }, paths: { "/new": { get: { responses: { "200": { description: "OK" } } } } } });
  const diff = previewSafeReimport(before, after, { semantic: true });
  expect(diff.contractChanges?.some((item) => item.severity === "breaking" && item.message.includes("absent"))).toBe(true);
  expect(diff.contractChanges?.some((item) => item.severity === "additive" && item.message.includes("new operation"))).toBe(true);
  const count = before.folders.reduce((total, folder) => total + folder.requests.length, before.requests.length);
  applySafeReimport(before, after);
  expect(before.folders.reduce((total, folder) => total + folder.requests.length, before.requests.length)).toBeGreaterThanOrEqual(count);
});
it("resolves supported local schema refs and blocks excessive structures", () => {
  const before = document(), after = structuredClone(before);
  before.components.schemas.Count = { type: "integer", minimum: 0 }; after.components.schemas.Count = { type: "integer", minimum: 3 };
  Object.assign(before.paths["/items/{id}"].get.parameters[1], { schema: { $ref: "#/components/schemas/Count" } });
  Object.assign(after.paths["/items/{id}"].get.parameters[1], { schema: { $ref: "#/components/schemas/Count" } });
  expect(diffOpenApiContracts(collection(before), collection(after)).some((item) => item.severity === "breaking")).toBe(true);
  const merged = collection(before); applySafeReimport(merged, collection(after));
  expect(merged.openApi?.contractSourceUncertain).toBe(true);
  expect(diffOpenApiContracts(merged, collection(after)).some((item) => item.severity === "unknown" && item.message.includes("fresh baseline"))).toBe(true);
  const huge = collection(document()); huge.description = "x".repeat(1024 * 1024 + 1);
  expect(diffOpenApiContracts(huge, collection(document()))[0].severity).toBe("unknown");
});

it("preserves annotation-like property names and literal keys in canonical comparisons", () => {
  const before = document(), after = structuredClone(before);
  before.components.schemas.Item = { type: "object", properties: { description: { type: "string" } } };
  after.components.schemas.Item = { type: "object", properties: { description: { type: "integer" } } };
  expect(contractCanonical(before.components)).not.toBe(contractCanonical(after.components));
  const merged = collection(before); applySafeReimport(merged, collection(after));
  expect(merged.openApi?.contractSourceUncertain).toBe(true);
  const changes: ContractSeverity[] = [];
  diffContractSchema({ enum: [{ description: "old" }] }, { enum: [{ description: "new" }] }, false,
    (_area, severity) => changes.push(severity), "request body");
  expect(changes).toContain("breaking");
  expect(contractCanonical({ title: "data", description: "value" })).toContain("description");
});
it("ignores schema annotations without ignoring properties with the same names", () => {
  const changes: ContractSeverity[] = [];
  diffContractSchema({ type: "string", description: "old" }, { type: "string", description: "new" }, false,
    (_area, severity) => changes.push(severity), "request body");
  expect(changes).toEqual([]);
});
it.each([
  [undefined, { type: "integer" }, "breaking"],
  [true, { type: "integer" }, "breaking"],
  [false, { type: "integer" }, "additive"],
  [{ type: "integer", minimum: 0 }, { type: "integer", minimum: 5 }, "breaking"],
  [{ type: "integer", minimum: 0 }, { type: "integer", minimum: 0 }, "additive"],
  [true, { pattern: "^[a-z]+$" }, "unknown"],
  [true, {}, "additive"]
])("compares a new optional input with the previous additional-property policy %j", (previous, property, expected) => {
  const before = { type: "object", ...(previous !== undefined ? { additionalProperties: previous } : {}) };
  const after = { ...before, properties: { count: property } };
  const changes: ContractSeverity[] = [];
  diffContractSchema(before, after, false, (_area, severity) => changes.push(severity), "request body");
  expect(changes).toContain(expected);
  if (expected !== "additive") expect(changes).not.toContain("additive");
});
