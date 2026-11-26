import { describe, expect, it } from "vitest";
import { importOpenApiText } from "../src/importers/openapi/importOpenApi";
import { planOpenApiSchemaUpdate } from "../src/importers/schemaUpdate";
import { flattenRequests } from "../src/model/traversal";
import type { Collection } from "../src/model/types";

const response = { responses: { "200": { description: "OK" } } };
const body = (schema: unknown, example?: unknown) => ({ ...response, requestBody: {
  required: true, content: { "application/json": { schema, example } }
} });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const entries = (collection: Collection) => flattenRequests(collection).map(({ request }) => request);

function spec(paths: Record<string, unknown>, components: Record<string, unknown> = {}) {
  return importOpenApiText(JSON.stringify({
    openapi: "3.0.3", info: { title: "Synthetic schema refresh", version: "1" }, paths, components
  }), { grouping: "firstPathSegment" }).collection;
}

describe("schema-only OpenAPI refresh", () => {
  it("updates a cyclic and indirect component graph, acknowledges exact affected requests, and does not rewrite saved data", () => {
    const initial = {
      Envelope: { type: "object", properties: { payload: ref("Payload") } },
      Payload: { type: "object", required: ["requestHeader"], properties: {
        requestHeader: { type: "string" }, parent: ref("Envelope")
      } },
      Retained: { type: "string" }
    };
    const children = { ...initial, Payload: { type: "object", required: ["customerId"], properties: {
      customerId: { type: "integer" }, parent: ref("Envelope"), extra: ref("Extra")
    } }, Extra: { type: "string" } };
    const target = spec({
      "/one": { post: body(ref("Envelope"), { payload: { requestHeader: "source example" } }) },
      "/two": { get: { responses: { "200": { description: "OK", content: {
        "application/json": { schema: ref("Envelope") }
      } } } } }
    }, { schemas: initial, securitySchemes: { old: { type: "http", scheme: "bearer" } } });
    const incoming = spec({ "/one": { post: body(ref("Envelope"), { payload: { customerId: 1 } }) } },
      { schemas: children, securitySchemes: { added: { type: "http", scheme: "basic" } } });
    const [one, two] = entries(target);
    one.body.raw = '{"payload":{"requestHeader":"saved input"}}';
    one.auth = { type: "bearer", token: "{{accessToken}}" };
    one.method = "PUT";
    one.url = "{{myRoute}}";
    one.responseExamples = [{ id: "saved", name: "Saved", status: 200, headers: [], body: "saved response" }];
    const original = structuredClone(target);
    const selection = { requestIds: [one.id] };
    const preview = planOpenApiSchemaUpdate(target, incoming, selection);
    expect(target).toEqual(original);
    expect(preview.summary.affectedRequestIds).toEqual([two.id]);
    expect(preview.summary.requiresAcknowledgement).toBe(true);
    expect(planOpenApiSchemaUpdate(target, incoming, {
      ...selection, approvedAffectedRequestIds: [one.id]
    }).summary.requiresAcknowledgement).toBe(true);
    const { collection, summary } = planOpenApiSchemaUpdate(target, incoming, {
      ...selection, approvedAffectedRequestIds: [two.id]
    });
    expect(summary.requiresAcknowledgement).toBe(false);
    expect(summary.changed).toBe(true);
    expect(summary.changes.map(({ message }) => message)).toEqual(expect.arrayContaining([
      "Removed field: requestHeader.", "No longer required: requestHeader.",
      "Added field: customerId.", "Now required: customerId.", "Schema definition added."
    ]));
    const [refreshed, untouched] = entries(collection);
    expect(refreshed.openApi?.rawOperation).toEqual(entries(incoming)[0].openApi?.rawOperation);
    expect(refreshed.openApi?.schemaRefreshed).toBe(true);
    expect({ ...refreshed, openApi: one.openApi }).toEqual(one);
    expect(untouched).toEqual(two);
    expect(collection.openApi?.components?.schemas).toEqual(children);
    expect(collection.openApi?.components?.securitySchemes).toEqual(target.openApi?.components?.securitySchemes);
    expect(planOpenApiSchemaUpdate(collection, incoming, selection).summary.changed).toBe(false);
  });

  it("removes source body metadata without deleting the saved body, and reports conflicting operation security", () => {
    const target = spec({ "/one": { post: { ...body({ type: "object" }), security: [{ bearer: [] }] } } },
      { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } });
    const source = spec({ "/one": { post: { ...response, security: [{ changedAuth: [] }] } } },
      { securitySchemes: { changedAuth: { type: "http", scheme: "basic" } } });
    const [original] = entries(target);
    const result = planOpenApiSchemaUpdate(target, source, { requestIds: [original.id] });
    const [updated] = entries(result.collection);
    expect(updated.body.raw).toBe(original.body.raw);
    expect(updated.body.mode).toBe(original.body.mode);
    expect(updated.body.schema).toBeUndefined();
    expect(updated.body.required).toBeUndefined();
    expect(updated.openApi?.rawOperation).toEqual({ ...response, security: [{ bearer: [] }] });
    expect(result.summary.warnings.join(" ")).toMatch(/Authentication in the source may differ/);
  });

  it("rejects missing and ambiguous operation matches", () => {
    const target = spec({ "/one": { post: body({ type: "string" }) } });
    const incoming = spec({ "/one": { post: body({ type: "integer" }) } });
    const [current] = entries(target);
    const selection = { requestIds: [current.id] };
    const [source] = entries(incoming);
    expect(() => planOpenApiSchemaUpdate(target, spec({ "/two": { get: response } }), selection)).toThrow(/no matching/);
    incoming.requests.push({ ...source, id: "duplicate" });
    expect(() => planOpenApiSchemaUpdate(target, incoming, selection)).toThrow(/same stable identity/);
  });

  it("rejects unresolved references before returning a candidate without changing the existing collection", () => {
    const target = spec({ "/one": { post: body({ type: "string" }) } });
    const original = structuredClone(target);
    const source = spec({ "/one": { post: body(ref("Missing")) } });
    expect(() => planOpenApiSchemaUpdate(target, source, { requestIds: [entries(target)[0].id] })).toThrow(/could not be resolved/);
    expect(target).toEqual(original);
  });

  it("rejects a change that would break a nested pointer in a retained unused schema", () => {
    const paths = { "/one": { post: body(ref("One")) } };
    const target = spec(paths, { schemas: { One: { type: "object", properties: { old: { type: "string" } } },
      Unused: ref("One/properties/old") } });
    const source = spec(paths, { schemas: { One: { type: "object" } } });
    expect(() => planOpenApiSchemaUpdate(target, source, { requestIds: [entries(target)[0].id] })).toThrow(/could not be resolved/);
  });

  it("handles literal ref-shaped source examples without following them, and refuses changed auxiliary definitions", () => {
    const target = spec({ "/one": { post: body({ type: "object" }) } });
    const source = spec({ "/one": { post: body({ type: "object" }, { value: { $ref: "example-literal" } }) } });
    const options = { requestIds: [entries(target)[0].id] };
    expect(planOpenApiSchemaUpdate(target, source, options).summary.changed).toBe(true);
    const external = spec({ "/one": { post: { ...response, requestBody: { $ref: "#/components/requestBodies/Aux" } } } },
      { requestBodies: { Aux: { content: { "application/json": { schema: { type: "string" } } } } } });
    expect(() => planOpenApiSchemaUpdate(target, external, options)).toThrow(/non-schema component/);
  });
});
