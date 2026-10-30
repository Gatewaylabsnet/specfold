import { expect, it } from "vitest";
import { createCollection, createEmptyWorkspace, createEnvironment, createRequest } from "@openapi-collection-studio/core";
import { blankWorkflow, workflowStart } from "./context";

function fixture() {
  const workspace = createEmptyWorkspace(); const first = createCollection("First"), selected = createCollection("Selected API");
  first.baseUrl = "https://first.invalid"; selected.baseUrl = "https://selected.invalid";
  const request = createRequest({ name: "Read", method: "GET", url: "/items" }); request.auth = { type: "bearer", token: "{{currentToken}}" };
  selected.requests = [request]; workspace.collections = [first, selected]; const environment = createEnvironment("UAT");
  workspace.environments.push(environment); workspace.activeEnvironmentId = environment.id;
  return { workspace, selected, request, environment, context: { collectionId: selected.id, requestId: request.id } };
}
it("starts with the selected API/environment and its auth reference rather than the first collection", () => {
  const f = fixture(), start = workflowStart(f.workspace, f.context);
  expect(start.profile.collectionId).toBe(f.selected.id); expect(start.profile.environmentId).toBe(f.environment.id);
  expect(start.profile.auth).toEqual({ kind: "bearer", tokenVariable: "currentToken" });
  expect(start.credentials).toEqual({});
});
it("keeps a literal credential out of profile metadata and leaves it in a private save draft", () => {
  const f = fixture(); f.request.auth = { type: "basic", username: "SYNTHETIC_USERNAME", password: "SYNTHETIC_PASSWORD" };
  const start = workflowStart(f.workspace, f.context);
  expect(JSON.stringify(start.profile).includes("SYNTHETIC")).toBe(false);
  expect(Object.values(start.credentials).length).toBe(2);
  expect(f.request.auth.type).toBe("basic");
});
it("retains a compatible saved setup, but does not override newly selected bearer authentication with old none", () => {
  const f = fixture(); const seeded = workflowStart(f.workspace, f.context).profile;
  f.workspace.connectionProfiles = [{ ...seeded, id: "saved", name: "Saved checks" }];
  expect(workflowStart(f.workspace, f.context).profile.id).toBe("saved");
  f.workspace.connectionProfiles[0].auth = { kind: "none" };
  expect(workflowStart(f.workspace, f.context).profile.auth.kind).toBe("bearer");
});
it("offers a genuinely new setup without changing the active environment or saved data", () => {
  const f = fixture(), before = structuredClone(f.workspace), start = blankWorkflow(f.workspace);
  expect(start.profile.collectionId).toBe(""); expect(start.profile.source.kind).toBe("file"); expect(start.profile.auth.kind).toBe("none");
  expect(start.profile.environmentId).toBe(f.environment.id); expect(f.workspace).toEqual(before);
});
it("reuses Bearer header references, but requires an explicit choice for unsupported header schemes and expressions", () => {
  const f = fixture(); f.request.auth = { type: "none" };
  f.request.headers.push({ id: "auth", key: "Authorization", value: "Bearer {{headerToken}}", enabled: true });
  expect(workflowStart(f.workspace, f.context).profile.auth).toEqual({ kind: "bearer", tokenVariable: "headerToken" });
  f.request.headers[0].value = "Custom SYNTHETIC_VALUE";
  expect(workflowStart(f.workspace, f.context).requiresAuthChoice).toBe(true);
  f.request.auth = { type: "bearer", token: "prefix-{{expression}}" };
  const start = workflowStart(f.workspace, f.context);
  expect(start.requiresAuthChoice).toBe(true); expect(Object.values(start.credentials).length).toBe(0);
});
