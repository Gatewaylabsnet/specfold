import { describe, expect, it } from "vitest";
import { createCollection, createEmptyWorkspace, createFolder, createRequest } from "@openapi-collection-studio/core";
import { prepareTokenBinding, responseTokenFields, tokenBindingTargets, type TokenBindingIntent } from "./responseTokenBinding";

function fixture() {
  const workspace = createEmptyWorkspace();
  const collection = createCollection("Example API");
  const folder = createFolder("Orders"), child = createFolder("Items");
  const token = createRequest({ name: "Issuer", method: "POST", url: "/auth/jwt" });
  const read = createRequest({ name: "List orders", method: "GET", url: "/orders?private=omit" });
  const nested = createRequest({ name: "Read item", method: "GET", url: "/items" });
  const outside = createRequest({ name: "Health", method: "GET", url: "/health" });
  collection.requests = [token, outside]; folder.requests = [read]; child.requests = [nested]; folder.folders = [child]; collection.folders = [folder];
  workspace.collections.push(collection);
  const intent: TokenBindingIntent = { collectionId: collection.id, environmentId: workspace.environments[0].id,
    sourceRequestId: token.id, folderId: folder.id, path: "data.access_token", variableName: "ordersAccessToken", requestIds: [read.id, nested.id] };
  return { workspace, collection, folder, child, token, read, nested, outside, intent, body: JSON.stringify({ data: { access_token: "SYNTHETIC_CAPTURE_VALUE" } }) };
}
describe("reviewed response token use", () => {
  it("presents JSON paths without credential values, including nested arrays", () => {
    const fields = responseTokenFields('{"access_token":"SYNTHETIC_CAPTURE_VALUE","data":[{"jwt":"SYNTHETIC_OTHER"}],"expires_in":30}');
    expect(fields).toEqual(["access_token", "data.0.jwt"]);
    expect(fields.every((field) => !field.includes("SYNTHETIC"))).toBe(true);
    expect(responseTokenFields("bad json")).toEqual([]);
  });
  it("does not mutate before approval, then binds only selected folder descendants as encrypted secrets", () => {
    const f = fixture(), before = structuredClone(f.workspace);
    f.read.headers.push({ id: "custom", key: "Authorization", value: "SYNTHETIC_OLD", enabled: true });
    const baseline = structuredClone(f.workspace);
    const review = prepareTokenBinding(f.workspace, f.body, f.intent);
    expect(f.workspace).toEqual(baseline);
    expect(review.rows.map((row) => row.id)).toEqual([f.read.id, f.nested.id]);
    expect(review.rows[0].route).toBe("/orders");
    expect(JSON.stringify(review).includes("SYNTHETIC_CAPTURE_VALUE")).toBe(false);
    const next = review.apply(f.workspace), target = next.collections[0];
    expect(target.folders[0].requests[0].auth).toEqual({ type: "bearer", token: "{{ordersAccessToken}}" });
    expect(target.folders[0].folders[0].requests[0].auth.type).toBe("bearer");
    expect(target.folders[0].requests[0].headers.some((item) => item.key === "Authorization")).toBe(false);
    expect(target.requests).toEqual(before.collections[0].requests);
    const stored = next.environments[0].variables.find((item) => item.name === f.intent.variableName)!;
    expect(stored.secret && stored.enabled && stored.value === JSON.parse(f.body).data.access_token).toBe(true);
  });
  it("rejects stale approval even if a mutation did not change the timestamp", () => {
    const f = fixture(), review = prepareTokenBinding(f.workspace, f.body, f.intent);
    const changed = structuredClone(f.workspace); changed.collections[0].baseUrl = "https://changed.invalid";
    expect(review.matches(changed)).toBe(false);
    expect(() => review.apply(changed)).toThrow("workspace changed");
  });
  it("cannot bind excluded token endpoints, foreign requests or an empty selection", () => {
    const f = fixture();
    for (const requestIds of [[f.token.id], [f.outside.id], [], [f.read.id, f.read.id]]) {
      expect(() => prepareTokenBinding(f.workspace, f.body, { ...f.intent, requestIds })).toThrow("Select the requests");
    }
  });
  it("keeps existing Basic/API-key and literal Authorization opt-in, never preselects the issuer", () => {
    const f = fixture(); f.read.auth = { type: "basic", username: "u", password: "p" };
    f.nested.headers.push({ id: "auth", key: "Authorization", value: "Bearer SYNTHETIC", enabled: true });
    const rows = tokenBindingTargets(f.workspace, { ...f.intent, folderId: undefined });
    expect(rows.find((row) => row.id === f.token.id)?.excluded).toBe(true);
    expect(rows.filter((row) => [f.read.id, f.nested.id].includes(row.id)).every((row) => !row.recommended)).toBe(true);
  });
  it("removes only the selected request's previous typed API-key field when changing auth", () => {
    const f = fixture(); f.read.auth = { type: "apiKey", key: "api_key", in: "query", value: "SYNTHETIC_OLD" };
    f.read.queryParams = [{ id: "key", key: "api_key", value: "SYNTHETIC_OLD", enabled: true },
      { id: "filter", key: "filter", value: "open", enabled: true }];
    const next = prepareTokenBinding(f.workspace, f.body, { ...f.intent, requestIds: [f.read.id] }).apply(f.workspace);
    expect(next.collections[0].folders[0].requests[0].queryParams.map((field) => field.key)).toEqual(["filter"]);
    expect(f.read.queryParams.length).toBe(2);
  });
  it("blocks overwriting a shared variable outside the reviewed scope or in a saved test setup", () => {
    const f = fixture(); f.workspace.environments[0].variables.push({ id: "shared", name: f.intent.variableName, value: "SYNTHETIC_OLD", enabled: true, secret: true });
    f.outside.auth = { type: "bearer", token: `{{${f.intent.variableName}}}` };
    expect(() => prepareTokenBinding(f.workspace, f.body, f.intent)).toThrow("shared outside");
    f.outside.auth = { type: "none" };
    f.workspace.connectionProfiles = [{ id: "setup", name: "Other setup", provider: "openapi", collectionId: f.collection.id,
      environmentId: f.intent.environmentId, baseUrl: "https://example.invalid", source: { kind: "existing", label: "API" }, auth: { kind: "bearer", tokenVariable: f.intent.variableName } }];
    expect(() => prepareTokenBinding(f.workspace, f.body, f.intent)).toThrow("shared outside");
  });
  it("rejects invalid/control-character tokens and never changes the original intent after preview", () => {
    const f = fixture();
    for (const value of [null, 42, "", "bad\r\nheader"]) expect(() => prepareTokenBinding(f.workspace, JSON.stringify({ data: { access_token: value } }), f.intent)).toThrow("token string");
    const review = prepareTokenBinding(f.workspace, f.body, f.intent);
    f.intent.variableName = "changedName"; f.intent.requestIds = [f.outside.id];
    expect(review.apply(f.workspace).environments[0].variables.some((item) => item.name === "ordersAccessToken")).toBe(true);
  });
});
