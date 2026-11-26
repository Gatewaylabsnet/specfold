import { describe, expect, it } from "vitest";
import {
  applyAgentProposal, createApinizerJwtRequest, createCollection, createEmptyWorkspace, createKeyValue,
  createRequest, flattenRequests, importApiDocument, previewAgentMutation,
  type AgentRequestUpdate
} from "../src";

const oldBody = { requestHeader: { owner: "user runtime" }, accountId: "{{accountId}}", query: { day: "today" } };
const names = ["/export-control", "/ec-dgs-list", "/ec-transaction-list"];
const source = (requiredHeader: boolean) => JSON.stringify({
  openapi: "3.0.3", info: { title: "Synthetic MKK", version: "1" },
  components: { schemas: { Payload: {
    type: "object", properties: {
      accountId: { type: "string" }, query: { type: "object" }, ...(requiredHeader ? { requestHeader: { type: "object" } } : {})
    }, required: requiredHeader ? ["accountId", "requestHeader"] : ["accountId"]
  } } },
  paths: Object.fromEntries(names.map((name) => [name, { post: {
    requestBody: { content: { "application/json": {
      schema: { $ref: "#/components/schemas/Payload" },
      example: { accountId: "source example", ...(requiredHeader ? { requestHeader: {} } : {}) }
    } } }, responses: { "200": { description: "OK" } }
  } }]))
});

function fixture() {
  const workspace = createEmptyWorkspace();
  const collection = importApiDocument(source(true), { grouping: "tags" }).collection;
  workspace.collections.push(collection, createCollection("Other"));
  const requests = flattenRequests(collection).map(({ request }) => request);
  for (const request of requests) {
    request.body.raw = JSON.stringify(oldBody);
    request.auth = { type: "bearer", token: "{{apinizerAuthAccessToken}}" };
    request.headers.push(createKeyValue("RequestHeader", "this is an unrelated HTTP header"));
    request.headers.push(createKeyValue("X-Trace", "keep my trace"));
  }
  workspace.environments[0].variables.push(
    { id: "var-token", name: "apinizerAuthAccessToken", enabled: true, secret: true, value: "enc:v1:c3ludGhldGlj" },
    { id: "var-account", name: "accountId", enabled: true, value: "demo" }
  );
  const jwt = createApinizerJwtRequest();
  collection.requests.push(jwt);
  const action = (updates: AgentRequestUpdate["updates"]): AgentRequestUpdate => ({
    kind: "update-request", collectionId: collection.id, expectedRevision: "a".repeat(64), updates
  });
  return { workspace, collection, requests, jwt, action };
}

describe("request update proposals", () => {
  it("removes a JSON property, changes Content-Type and disables only the selected HTTP header", () => {
    const { workspace, requests, jwt, action } = fixture();
    const baseline = structuredClone(workspace);
    const [one] = requests;
    const trace = one.headers.find(({ key }) => key === "X-Trace")!;
    const updates: AgentRequestUpdate["updates"] = requests.map(({ id }) => ({
      requestId: id, body: { op: "patch-json", patch: [{ op: "remove", path: "/requestHeader" }] }
    }));
    updates[0].headers = [
      { op: "set-value", target: { name: "CONTENT-type" }, value: "text/plain" },
      { op: "set-enabled", target: { id: trace.id }, enabled: false }
    ];
    const proposal = previewAgentMutation(workspace, action(updates));
    const next = applyAgentProposal(workspace, proposal);
    const saved = flattenRequests(next.collections[0]).map(({ request }) => request);
    expect(workspace).toEqual(baseline);
    expect(saved.find(({ id }) => id === jwt.id)).toEqual(jwt);
    expect(next.collections[1]).toEqual(baseline.collections[1]);
    expect(next.environments).toEqual(baseline.environments);
    for (const request of requests) {
      const updated = saved.find(({ id }) => id === request.id)!;
      expect(JSON.parse(updated.body.raw!)).toEqual({ accountId: oldBody.accountId, query: oldBody.query });
      expect({ ...updated, headers: request.headers, body: { ...updated.body, raw: request.body.raw } }).toEqual(request);
      expect(updated.headers.find(({ key }) => key === "RequestHeader")).toEqual(request.headers.find(({ key }) => key === "RequestHeader"));
    }
    const first = saved.find(({ id }) => id === one.id)!;
    expect(first.headers.map(({ id }) => id)).toEqual(one.headers.map(({ id }) => id));
    expect(first.headers.find(({ key }) => key === "Content-Type")?.value).toBe("text/plain");
    expect(first.headers.find(({ id }) => id === trace.id)).toEqual({ ...trace, enabled: false });
    expect(proposal.requestUpdate?.requests[0].warnings.join(" ")).toMatch(/Content-Type/);
    expect(proposal.requestUpdate?.requests[0].changes.map((change) => change.scope).join(" ")).toMatch(/HTTP header Content-Type/);
  });

  it("distinguishes omitted headers, an empty value, and a removed row; identifiers remain deterministic", () => {
    const { workspace, requests, action } = fixture();
    const request = requests[0];
    const trace = request.headers.find(({ key }) => key === "X-Trace")!;
    const edits: AgentRequestUpdate["updates"] = [{ requestId: request.id, headers: [
      { op: "set-value", target: { id: trace.id }, value: "" },
      { op: "remove", target: { name: "requestheader" } },
      { op: "add", name: "X-New", value: "test", enabled: false }
    ] }];
    const first = previewAgentMutation(workspace, action(edits));
    const second = previewAgentMutation(workspace, action(edits));
    const saved = flattenRequests(first.collection).find(({ request: entry }) => entry.id === request.id)!.request;
    expect(first.collection).toEqual(second.collection);
    expect(saved.headers.find(({ id }) => id === trace.id)).toEqual({ ...trace, value: "" });
    expect(saved.headers.some(({ key }) => key === "RequestHeader")).toBe(false);
    expect(saved.headers.at(-1)).toMatchObject({ key: "X-New", value: "test", enabled: false });
    expect(saved.body).toEqual(request.body);
  });

  it("fails closed on ambiguous/missing targets, unsupported inputs, and a partial batch error", () => {
    const { workspace, requests, action } = fixture();
    const [one, two] = requests;
    two.headers.push(createKeyValue("x-trace", "duplicate"));
    const before = structuredClone(workspace);
    expect(() => previewAgentMutation(workspace, action([
      { requestId: one.id, headers: [{ op: "add", name: "X-Test", value: "modified" }] },
      { requestId: two.id, headers: [{ op: "remove", target: { name: "X-Trace" } }] }
    ]))).toThrow("REQUEST_UPDATE_HEADER_AMBIGUOUS");
    expect(() => previewAgentMutation(workspace, action([
      { requestId: one.id, headers: [{ op: "remove", target: { id: "missing-header" } }] }
    ]))).toThrow("REQUEST_UPDATE_HEADER_NOT_FOUND");
    expect(() => previewAgentMutation(workspace, action([
      { requestId: "missing-request", body: { op: "clear" } }
    ]))).toThrow("REQUEST_NOT_FOUND");
    expect(() => previewAgentMutation(workspace, action([
      { requestId: one.id, headers: [{ op: "add", name: "X-Test", value: "text\ninvalid" }] }
    ]))).toThrow("REQUEST_UPDATE_INVALID");
    expect(workspace).toEqual(before);
  });

  it("requires existing auth references and warns about manual Authorization and configured API key collisions", () => {
    const { workspace, collection, requests, action } = fixture();
    const requestId = requests[0].id;
    const headers = (name: string, value: string) => action([{ requestId, headers: [{ op: "add", name, value }] }]);
    expect(() => previewAgentMutation(workspace, headers("Authorization", "Bearer SECRET_VALUE")))
      .toThrow("REQUEST_UPDATE_CREDENTIAL_LITERAL");
    expect(() => previewAgentMutation(workspace, headers("Cookie", "{{undefined}}")))
      .toThrow("REQUEST_UPDATE_CREDENTIAL_VARIABLE");
    expect(() => previewAgentMutation(workspace, headers("Cookie", "{{accountId}}")))
      .toThrow("REQUEST_UPDATE_CREDENTIAL_VARIABLE");
    const allowed = previewAgentMutation(workspace, headers("Authorization", "Bearer {{apinizerAuthAccessToken}}"));
    expect(allowed.requestUpdate?.requests[0].warnings.join(" ")).toMatch(/conflicts with/);
    expect(JSON.stringify(allowed.requestUpdate)).not.toContain("enc:v1:");
    collection.openApi!.securitySchemes = { custom: { type: "apiKey", in: "header", name: "X-Custom" } };
    expect(() => previewAgentMutation(workspace, headers("x-custom", "SECRET_VALUE"))).toThrow("REQUEST_UPDATE_CREDENTIAL_LITERAL");
    const separate = createRequest({ name: "key auth", method: "POST", url: "/key-auth" });
    separate.auth = { type: "apiKey", in: "header", key: "X-Native", value: "{{apinizerAuthAccessToken}}" };
    collection.requests.push(separate);
    const custom = previewAgentMutation(workspace, action([{ requestId: separate.id,
      headers: [{ op: "add", name: "X-Native", value: "{{apinizerAuthAccessToken}}" }]
    }]));
    expect(custom.requestUpdate?.requests[0].warnings.join(" ")).toMatch(/conflicts with/);
    expect(flattenRequests(custom.collection).find(({ request }) => request.id === separate.id)!.request.auth).toEqual(separate.auth);
  });

  it("combines independent body edits with the schema update and keeps unrelated source operations untouched", () => {
    const { workspace, requests, action } = fixture();
    const [first, second, third] = requests;
    const input = {
      ...action([{ requestId: first.id, body: { op: "patch-json", patch: [{ op: "remove", path: "/requestHeader" }] } }]),
      schemaUpdate: { requestIds: [first.id, second.id], text: source(false) }
    };
    const proposal = previewAgentMutation(workspace, input);
    expect(proposal.schemaUpdate).toMatchObject({ affectedRequestIds: [third.id], requiresAcknowledgement: true, changed: true });
    expect(proposal.requestUpdate).toMatchObject({ changed: true });
    const incoming = flattenRequests(proposal.collection).map(({ request }) => request);
    const [updatedFirst, updatedSecond, keptThird] = [first, second, third].map(({ id }) => incoming.find((request) => request.id === id)!);
    expect(updatedFirst.openApi?.schemaRefreshed).toBe(true);
    expect(JSON.parse(updatedFirst.body.raw!)).not.toHaveProperty("requestHeader");
    expect(updatedSecond.openApi?.schemaRefreshed).toBe(true);
    expect(updatedSecond.body.raw).toBe(second.body.raw);
    expect(keptThird).toEqual(third);
  });
});
