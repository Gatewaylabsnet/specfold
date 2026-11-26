import { describe, expect, it } from "vitest";
import { exportCollectionToOpenApiDocument, flattenRequests, importApiDocument, planOpenApiSchemaUpdate } from "../src";

function imported(body?: object, schemas?: object) {
  return importApiDocument(JSON.stringify({
    openapi: "3.0.3",
    info: { title: "Schema export fixture", version: "1" },
    components: { schemas },
    paths: { "/orders": { post: { requestBody: body, responses: { "200": { description: "OK" } } } } }
  }), { grouping: "tags" }).collection;
}
const opts = {
  format: "json" as const, useFolderNamesAsTags: false, includeRequestExamples: true,
  includeResponseExamples: false, includeBearerJwtSecurityScheme: false, includeAllComponents: false
};
const body = (schema: object, example: object) => ({
  required: true, content: { "application/json": { schema, example } }
});

describe("schema refresh exports", () => {
  it("includes transitive source schemas without copying runtime examples, even in synthesized mode", () => {
    const existing = imported(body({ type: "object" }, { previous: true }));
    const [{ request }] = flattenRequests(existing);
    request.body.raw = '{"runtimeOnly":true}';
    const incoming = imported(body({ $ref: "#/components/schemas/Outer" }, { updated: 1 }), {
      Outer: { $ref: "#/components/schemas/Inner" },
      Inner: { type: "object", properties: { updated: { type: "integer" } }, required: ["updated"] },
      Unused: { type: "string" }
    });
    const { collection } = planOpenApiSchemaUpdate(existing, incoming, { requestIds: [request.id] });
    for (const preferSourceOperation of [false, true]) {
      const output = exportCollectionToOpenApiDocument(collection, { ...opts, preferSourceOperation });
      expect(output.components).toEqual({ schemas: {
        Outer: { $ref: "#/components/schemas/Inner" },
        Inner: { type: "object", properties: { updated: { type: "integer" } }, required: ["updated"] }
      } });
      expect(JSON.stringify(output.paths)).toContain('"example":{"updated":1}');
      expect(JSON.stringify(output.paths)).not.toContain("runtimeOnly");
    }
    const noExample = exportCollectionToOpenApiDocument(collection, { ...opts, includeRequestExamples: false });
    expect(JSON.stringify(noExample.paths)).not.toContain('"example"');
  });

  it("does not reinsert a removed source requestBody from the retained request payload", () => {
    const existing = imported(body({ type: "object" }, { previous: true }));
    const [{ request }] = flattenRequests(existing);
    const updated = planOpenApiSchemaUpdate(existing, imported(), { requestIds: [request.id] }).collection;
    expect(flattenRequests(updated)[0].request.body.raw).toBe(request.body.raw);
    expect(JSON.stringify(exportCollectionToOpenApiDocument(updated, opts).paths)).not.toContain('"requestBody"');
  });

  it("refreshes the body schema through unchanged requestBody aliases", () => {
    const withAliases = (required: string[]) => importApiDocument(JSON.stringify({
      openapi: "3.0.3", info: { title: "Alias fixture", version: "1" },
      components: {
        requestBodies: { Alias: { $ref: "#/components/requestBodies/Actual" },
          Actual: body({ $ref: "#/components/schemas/Model" }, { id: 1 }) },
        schemas: { Model: { type: "object", properties: { id: { type: "integer" } }, required } }
      },
      paths: { "/orders": { post: { requestBody: { $ref: "#/components/requestBodies/Alias" },
        responses: { "200": { description: "OK" } } } } }
    }), { grouping: "tags" }).collection;
    const existing = withAliases([]);
    const [{ request }] = flattenRequests(existing);
    const { collection } = planOpenApiSchemaUpdate(existing, withAliases(["id"]), { requestIds: [request.id] });
    expect(flattenRequests(collection)[0].request.body).toMatchObject({
      mode: request.body.mode, required: true, schema: { $ref: "#/components/schemas/Model" }
    });
    expect(exportCollectionToOpenApiDocument(collection, opts).components).toMatchObject({
      requestBodies: { Alias: { $ref: "#/components/requestBodies/Actual" } },
      schemas: { Model: { required: ["id"] } }
    });
  });
});
