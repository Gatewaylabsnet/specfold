import { describe, expect, it } from "vitest";
import { createCollection, createEmptyWorkspace, createKeyValue, createRequest } from "../src/model/factory";
import { flattenRequests } from "../src/model/traversal";
import { importApiDocument } from "../src/importers";
import { buildWorkflowTestPlan } from "../src/workflow/planning";
import { workflowRequest } from "../src/workflow/request";
import type { ConnectionProfile } from "../src/workflow/types";

const opts = { id: "synthetic-plan", revision: "synthetic-revision", createdAt: "2026-10-13T12:00:00.000Z" };
const success = { "200": { description: "Success", content: { "application/json": { schema: { type: "object" } } } } };
const body = (schema: object, example?: unknown) => ({ required: true,
  content: { "application/json": { schema, ...(example === undefined ? {} : { example }) } } });

function fixture(paths: object, components: object = {}) {
  const workspace = createEmptyWorkspace();
  const collection = importApiDocument(JSON.stringify({ openapi: "3.0.3", info: { title: "Synthetic workflow", version: "1" },
    servers: [{ url: "https://original.test/service" }], paths, components }), { grouping: "tags" }).collection;
  workspace.collections.push(collection);
  const profile: ConnectionProfile = { id: "profile", name: "Synthetic", provider: "openapi", collectionId: collection.id,
    environmentId: workspace.environments[0].id, baseUrl: "https://approved.test/api", source: { kind: "existing", label: "Synthetic collection" }, auth: { kind: "none" } };
  const requests = flattenRequests(collection).map((item) => item.request);
  return { workspace, collection, profile, requests };
}

describe("workflow plan provenance", () => {
  it("selects ready read operations and requires explicit selection for mutating operations", () => {
    const f = fixture({ "/items": { get: { responses: success }, post: { requestBody: body({ type: "object", properties: { count: { type: "integer" } }, required: ["count"] }, { count: 7 }), responses: success } } });
    const before = JSON.stringify(f.workspace);
    const initial = buildWorkflowTestPlan(f.workspace, f.profile, opts);
    expect(initial.rows.map((row) => [row.method, row.status, row.selected, row.effect])).toEqual([
      ["GET", "ready", true, "read"], ["POST", "ready", false, "may-change-data"]
    ]);
    expect(initial.rows[1].provenance).toEqual([{ location: "body", source: "example", valid: true }]);
    expect(initial.rows[1].reason).toContain("Explicitly select");
    expect(initial.rows[0].route).toBe("https://approved.test/api/items");
    const selected = buildWorkflowTestPlan(f.workspace, f.profile, { ...opts, selectedRequestIds: [f.requests[1].id] });
    expect(selected.rows.map((row) => row.selected)).toEqual([false, true]);
    expect(JSON.stringify(f.workspace)).toBe(before);
    expect(initial.expiresAt).toBe("2026-10-13T12:15:00.000Z");
  });

  it("distinguishes defaults from generated placeholders and never selects generated input", () => {
    const f = fixture({
      "/default": { post: { requestBody: body({ type: "object", properties: { count: { type: "integer", default: 3 } } }), responses: success } },
      "/generated": { post: { requestBody: body({ type: "object", properties: { count: { type: "integer" } } }), responses: success } }
    });
    const plan = buildWorkflowTestPlan(f.workspace, f.profile, { ...opts, selectedRequestIds: f.requests.map((r) => r.id) });
    expect(plan.rows[0]).toMatchObject({ status: "ready", selected: true, provenance: [{ source: "default", valid: true }] });
    expect(plan.rows[1]).toMatchObject({ status: "skipped", selected: false, provenance: [{ source: "generated", valid: false }] });
  });

  it("rejects changed, malformed, schema-invalid, sensitive and already-masked examples", () => {
    const f = fixture({ "/check": { post: { requestBody: body({ type: "object", properties: { amount: { type: "integer" } }, required: ["amount"] }, { amount: 7 }), responses: success } } });
    f.requests[0].body.raw = '{"amount":8}';
    expect(buildWorkflowTestPlan(f.workspace, f.profile, opts).rows[0].reason).toContain("differs");
    f.requests[0].body.raw = '{broken';
    expect(buildWorkflowTestPlan(f.workspace, f.profile, opts).rows[0].reason).toContain("malformed");
    const invalid = fixture({ "/invalid": { post: { requestBody: body({ type: "integer" }, "not-an-integer"), responses: success } } });
    invalid.requests[0].body.raw = JSON.stringify("not-an-integer");
    expect(buildWorkflowTestPlan(invalid.workspace, invalid.profile, opts).rows[0].status).toBe("skipped");
    for (const sample of [{ email: "synthetic@example.test" }, { field: "[REDACTED]" }]) {
      const privateCase = fixture({ "/private": { post: { requestBody: body({ type: "object" }, sample), responses: success } } });
      const row = buildWorkflowTestPlan(privateCase.workspace, privateCase.profile, opts).rows[0];
      expect(row).toMatchObject({ status: "skipped", selected: false });
      expect(row.reason).toContain("sensitive");
      expect(JSON.stringify(row.provenance)).not.toContain("synthetic@example.test");
    }
  });

  it("retains new path-level parameter provenance and blocks absent or unresolved required values", () => {
    const f = fixture({ "/items/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", example: 7 } }], get: { responses: success }
    } });
    expect(f.requests[0].openApi?.rawParameters).toHaveLength(1);
    expect(buildWorkflowTestPlan(f.workspace, f.profile, opts).rows[0]).toMatchObject({ status: "ready", selected: true,
      route: "https://approved.test/api/items/7", provenance: [{ location: "path", field: "id", source: "example", valid: true }] });
    f.requests[0].pathParams[0].enabled = false;
    expect(buildWorkflowTestPlan(f.workspace, f.profile, opts).rows[0].status).not.toBe("ready");
    f.requests[0].pathParams[0].enabled = true;
    f.requests[0].pathParams[0].value = "{{unconfigured}}";
    expect(buildWorkflowTestPlan(f.workspace, f.profile, opts).rows[0]).toMatchObject({ status: "blocked", selected: false });
  });

  it("does not accept a required documented JSON body changed to an empty form", () => {
    const f = fixture({ "/required": { post: { requestBody: body({ type: "integer" }, 7), responses: success } } });
    f.requests[0].body = { mode: "form", form: [], required: true };
    const row = buildWorkflowTestPlan(f.workspace, f.profile, { ...opts, selectedRequestIds: [f.requests[0].id] }).rows[0];
    expect(row).toMatchObject({ status: "skipped", selected: false });
    expect(row.provenance).toContainEqual(expect.objectContaining({ location: "body", source: "missing", valid: false }));
    expect(row.reason).toContain("form body");
  });

  it("does not treat an empty required form or a required GET body as input-free", () => {
    const f = fixture({ "/required": { post: { responses: success }, get: { requestBody: body({ type: "integer" }, 7), responses: success } } });
    const post = f.requests.find((request) => request.method === "POST")!;
    post.body = { mode: "form", form: [], required: true };
    const rows = buildWorkflowTestPlan(f.workspace, f.profile, { ...opts, selectedRequestIds: f.requests.map((request) => request.id) }).rows;
    expect(rows.every((row) => row.status === "skipped" && !row.selected)).toBe(true);
  });

  it("does not treat a legacy manual body as a documented example, or infer old path-level provenance", () => {
    const workspace = createEmptyWorkspace(), collection = createCollection("Legacy");
    const request = createRequest({ name: "Manual", method: "POST", url: "{{baseUrl}}/manual" });
    request.body = { mode: "json", raw: '{"count":7}' };
    collection.requests.push(request); workspace.collections.push(collection);
    const base = fixture({});
    const profile = { ...base.profile, collectionId: collection.id, environmentId: workspace.environments[0].id };
    expect(buildWorkflowTestPlan(workspace, profile, opts).rows[0]).toMatchObject({ status: "skipped", provenance: [{ source: "missing" }] });
    const f = fixture({ "/items/{id}": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", example: 7 } }], get: { responses: success } } });
    delete f.requests[0].openApi!.rawParameters;
    expect(buildWorkflowTestPlan(f.workspace, f.profile, opts).rows[0].provenance[0].source).toBe("missing");
  });

  it("blocks multipart and unsupported references without fetching anything", () => {
    const f = fixture({ "/upload": { post: { requestBody: body({ type: "object" }, {}), responses: success } } });
    f.requests[0].body = { mode: "multipart", multipart: [{ id: "file", key: "upload", type: "file", value: "", enabled: true }] };
    expect(buildWorkflowTestPlan(f.workspace, f.profile, opts).rows[0].reason).toContain("Multipart");
    f.requests[0].body = { mode: "json", raw: "{}" };
    f.requests[0].openApi!.rawOperation = { requestBody: { $ref: "https://external.test/schema" }, responses: success };
    expect(buildWorkflowTestPlan(f.workspace, f.profile, opts).rows[0].status).not.toBe("ready");
  });
});

describe("workflow profile and assertion boundaries", () => {
  it("uses actual saved routing, profile environment/base URL, and ignores folder routing", () => {
    const f = fixture({ "/original": { get: { responses: success } } });
    f.collection.folders[0].baseUrl = "https://foreign.test/ignored";
    f.requests[0].url = "https://approved.test/edited";
    const row = buildWorkflowTestPlan(f.workspace, f.profile, opts).rows[0];
    expect(row.route).toBe("https://approved.test/edited");
    expect(row.status).toBe("ready");
    f.requests[0].url += "?ordinary=sensitive-query-value";
    const inlineQuery = buildWorkflowTestPlan(f.workspace, f.profile, opts).rows[0];
    expect(inlineQuery).toMatchObject({ route: "https://approved.test/edited", status: "skipped", selected: false });
    expect(inlineQuery.reason).toContain("Inline URL query");
    expect(JSON.stringify(inlineQuery)).not.toContain("sensitive-query-value");
    f.requests[0].url = "https://foreign.test/edited";
    expect(buildWorkflowTestPlan(f.workspace, f.profile, opts).rows[0]).toMatchObject({ status: "blocked", selected: false });
  });

  it("masks encoded personal path values and retains execution keys and enums for short credentials", () => {
    const f = fixture({ "/data": { get: { responses: { "204": { description: "Done" } } } } });
    f.profile.auth = { kind: "bearer", tokenVariable: "customReference" };
    f.workspace.environments[0].variables.push({ id: "credential", name: "customReference", value: "a", enabled: true, secret: false });
    const row = buildWorkflowTestPlan(f.workspace, f.profile, { ...opts, id: "a-plan", revision: "a-revision" });
    expect(row.id).toBe("a-plan");
    expect(row.revision).toBe("a-revision");
    expect(row.profileId).toBe(f.profile.id);
    expect(row.collectionId).toBe(f.collection.id);
    expect(row.rows[0]).toMatchObject({ requestId: f.requests[0].id, method: "GET", status: "ready", selected: true, effect: "read", provenance: [{ source: "none", valid: true }] });
    expect(row.rows[0].route).toContain("[REDACTED]");
    f.workspace.environments[0].variables.pop();
    f.profile.auth = { kind: "none" };
    f.requests[0].url = "https://approved.test/people/synthetic%40example.test";
    expect(buildWorkflowTestPlan(f.workspace, f.profile, opts).rows[0].route).toBe("https://approved.test/people/[REDACTED]");
  });

  it("shares auth clone cleanup without requiring obsolete credentials or changing saved requests", () => {
    const f = fixture({ "/items": { get: { responses: success } } });
    f.requests[0].auth = { type: "apiKey", key: "Old-Key", value: "{{old}}", in: "header" };
    f.requests[0].headers.push(createKeyValue("Authorization", "Bearer {{old}}"), createKeyValue("Old-Key", "{{old}}"));
    f.profile.auth = { kind: "bearer", tokenVariable: "currentCredential" };
    f.workspace.environments[0].variables.push({ id: "credential", name: "currentCredential", value: "SYNTHETIC_CURRENT", enabled: true, secret: true });
    const before = JSON.stringify(f.requests[0]);
    const clone = workflowRequest(f.requests[0], f.profile);
    expect(clone.headers).toEqual([]);
    expect(clone.auth).toEqual({ type: "bearer", token: "{{currentCredential}}" });
    expect(buildWorkflowTestPlan(f.workspace, f.profile, opts).rows[0].status).toBe("ready");
    expect(JSON.stringify(f.requests[0])).toBe(before);
  });

  it("preflights Apinizer credentials while allowing an empty existing capture variable", () => {
    const f = fixture({ "/items": { get: { responses: success } } });
    f.profile.provider = "apinizer";
    f.profile.auth = { kind: "apinizer", endpoint: "https://approved.test/auth/jwt", usernameVariable: "login",
      passwordVariable: "credential", clientIdVariable: "client", tokenVariable: "captured" };
    for (const name of ["login", "credential", "client", "captured"]) f.workspace.environments[0].variables.push({
      id: name, name, value: name === "captured" ? "" : `SYNTHETIC_${name}`, enabled: true, secret: true
    });
    const plan = buildWorkflowTestPlan(f.workspace, f.profile, opts);
    expect(plan.rows[0].status).toBe("ready");
    expect(plan.authentication).toContain("https://approved.test/auth/jwt");
    f.workspace.environments[0].variables.find((item) => item.name === "credential")!.value = "";
    expect(buildWorkflowTestPlan(f.workspace, f.profile, opts).rows[0].status).toBe("blocked");
  });

  it("resolves response schemas by status while excluding example values from evidence", () => {
    const f = fixture({ "/items": { get: { responses: {
      "200": { description: "One", content: { "application/json": { schema: { $ref: "#/components/schemas/Item" } } } },
      "201": { description: "Two", content: { "application/json": { schema: { type: "array", items: { type: "integer" } } } } }
    } } } }, { schemas: { Item: { type: "object", properties: { value: { type: "string", example: "PRIVATE_EXAMPLE_VALUE" } } } } });
    const row = buildWorkflowTestPlan(f.workspace, f.profile, opts).rows[0];
    expect(row.expectedStatuses).toEqual([200, 201]);
    expect(row.responseSchemas).toEqual({ "200": { type: "object", properties: { value: { type: "string" } } }, "201": { type: "array", items: { type: "integer" } } });
    expect(row.responseSchema).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain("PRIVATE_EXAMPLE_VALUE");
  });

  it("blocks secret-bearing schema constraints instead of altering assertion meaning", () => {
    const f = fixture({ "/items": { get: { responses: { "200": { content: { "application/json": { schema: { type: "string", const: "SYNTHETIC_PRIVATE" } } } } } } } });
    f.workspace.environments[0].variables.push({ id: "secret", name: "secret", value: "SYNTHETIC_PRIVATE", enabled: true, secret: true });
    const row = buildWorkflowTestPlan(f.workspace, f.profile, opts).rows[0];
    expect(row.status).toBe("blocked");
    expect(row.responseSchemas).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain("SYNTHETIC_PRIVATE");
  });

  it("supports Swagger required path and form examples without validating parameter metadata as schema", () => {
    const workspace = createEmptyWorkspace();
    const collection = importApiDocument(JSON.stringify({ swagger: "2.0", info: { title: "Swagger", version: "1" }, host: "example.test", paths: {
      "/items/{id}": { parameters: [{ name: "id", in: "path", required: true, type: "integer", example: 7 }], post: {
        consumes: ["application/x-www-form-urlencoded"], parameters: [{ name: "count", in: "formData", required: true, type: "integer", example: 3 }], responses: { "204": { description: "Done" } }
      } }
    } }), { grouping: "tags" }).collection;
    workspace.collections.push(collection);
    const profile = { ...fixture({}).profile, collectionId: collection.id, environmentId: workspace.environments[0].id };
    const request = flattenRequests(collection)[0].request;
    const row = buildWorkflowTestPlan(workspace, profile, { ...opts, selectedRequestIds: [request.id] }).rows[0];
    expect(row).toMatchObject({ status: "ready", selected: true, expectedStatuses: [204] });
    expect(row.provenance).toEqual([{ location: "path", field: "id", source: "example", valid: true }, { location: "body", field: "count", source: "example", valid: true }]);
  });
});
