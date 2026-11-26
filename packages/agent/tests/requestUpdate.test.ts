import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  createCollection, createEmptyWorkspace, createId, createKeyValue, createRequest, flattenRequests,
  importApiDocument, type AgentMutation, type Workspace
} from "@openapi-collection-studio/core";
import { AgentRepository } from "../src/repository";
import { AgentService } from "../src/service";
import { atomicWriteFile } from "../src/atomicFile";
import type { AgentPreview } from "../src/desktopContracts";

const routes = ["/export-control", "/ec-dgs-list", "/ec-transaction-list"];
const text = (old: boolean) => JSON.stringify({
  openapi: "3.0.3", info: { title: "Synthetic MKK test", version: "1" }, components: { schemas: {
    Mkk: {
      type: "object",
      required: old ? ["id", "requestHeader"] : ["id"],
      properties: { id: { type: "string" }, ...(old ? { requestHeader: { type: "object" } } : {}) }
    }
  } },
  paths: Object.fromEntries(routes.map((route) => [route, { post: {
    summary: route, requestBody: { content: { "application/json": {
      schema: { $ref: "#/components/schemas/Mkk" },
      example: old ? { id: "x", requestHeader: {} } : { id: "x" }
    } } }, responses: { "200": { description: "OK" } }
  } }]))
});
type Action = Extract<AgentMutation, { kind: "update-request" }>;
let root: string, workspace: Workspace, service: AgentService;
const path = () => join(root, "workspace.json");
const stateDir = () => join(root, ".agent");
const requests = () => flattenRequests(workspace.collections[0]).map(({ request }) => request).filter(({ openApi }) => openApi);
const edits = (): Action["updates"] => requests().map((request, index) => ({
  requestId: request.id,
  body: { op: "patch-json", patch: [{ op: "remove", path: "/requestHeader" }] },
  ...(index === 0 ? { headers: [
    { op: "set-value" as const, target: { name: "content-TYPE" }, value: "application/vnd.synthetic+json" },
    { op: "set-enabled" as const, target: { id: request.headers[1].id }, enabled: false }
  ] } : {})
}));
const action = async (): Promise<Action> => ({
  kind: "update-request", collectionId: workspace.collections[0].id,
  expectedRevision: (await service.repository.snapshot()).revision, updates: edits()
});

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "specfold-request-edits-")));
  workspace = createEmptyWorkspace();
  const collection = importApiDocument(text(true), { grouping: "tags" }).collection;
  workspace.collections = [collection, createCollection("Unrelated")];
  const jwt = createRequest({ name: "Apinizer JWT Token", method: "POST", url: "https://mkk.invalid/auth/jwt" });
  jwt.body = { mode: "form", form: [createKeyValue("password", "{{apiPassword}}")] };
  collection.requests.push(jwt);
  for (const request of requests()) {
    request.body.raw = '{"id":"{{customerId}}","query":{"page":0},"requestHeader":{"source":"client"}}';
    request.headers = [createKeyValue("Content-Type", "application/json"), createKeyValue("X-Trace", "true"),
      { ...createKeyValue("X-Request-Info", "original"), enabled: false }];
    request.auth = { type: "bearer", token: "{{apinizerAuthAccessToken}}" };
  }
  workspace.environments[0].variables.push({ id: createId("var"), name: "apinizerAuthAccessToken",
    value: "enc:v1:ZW5jcnlwdGVk", secret: true, enabled: true });
  await writeFile(path(), JSON.stringify(workspace));
  service = new AgentService(new AgentRepository(root), true);
});

afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe("approval-gated request editing", () => {
  it("persists one combined MKK update and leaves saved auth, environment, routes, and unrelated data in place", async () => {
    const before = await readFile(path(), "utf8");
    const fetch = vi.spyOn(globalThis, "fetch");
    const input = { ...await action(), schemaUpdate: { text: text(false), requestIds: requests().slice(0, 1).map(({ id }) => id) } };
    const summary = await service.preview(input);
    expect(summary.networkRequests).toBe(0);
    expect(summary.requestUpdate?.requests).toHaveLength(3);
    expect(summary.schemaUpdate?.affectedRequestIds).toHaveLength(2);
    expect(await service.showDiff(summary.planId)).toMatchObject({ requestUpdate: summary.requestUpdate, schemaUpdate: summary.schemaUpdate });
    expect(await readFile(path(), "utf8")).toBe(before);
    await expect(service.apply(summary.planId, input.expectedRevision)).rejects.toThrow("REQUEST_UPDATE_DESKTOP_REVIEW_REQUIRED");
    await expect(service.approve(summary.planId, input.expectedRevision)).rejects.toThrow("REQUEST_UPDATE_DESKTOP_REVIEW_REQUIRED");
    await expect(service.approveAndApply(summary.planId, input.expectedRevision)).rejects.toThrow("SCHEMA_IMPACT_APPROVAL_REQUIRED");
    expect(await readFile(path(), "utf8")).toBe(before);
    const accepted = await service.approveAndApply(summary.planId, input.expectedRevision, summary.schemaUpdate?.affectedRequestIds);
    const restarted = new AgentService(new AgentRepository(root), true);
    expect(accepted.alreadyApplied).toBe(false);
    const saved = (await restarted.repository.snapshot()).workspace;
    expect(saved.environments).toEqual(workspace.environments);
    expect(saved.collections[1]).toEqual(workspace.collections[1]);
    const jwt = (value: Workspace) => value.collections[0].requests.find(({ name }) => name === "Apinizer JWT Token");
    expect(jwt(saved)).toEqual(jwt(workspace));
    const savedRequests = flattenRequests(saved.collections[0]).filter(({ request }) => request.openApi).map(({ request }) => request);
    for (const [index, request] of savedRequests.entries()) {
      expect(request).toMatchObject({
        id: requests()[index].id, method: requests()[index].method, url: requests()[index].url,
        auth: requests()[index].auth, responseExamples: requests()[index].responseExamples
      });
      expect(JSON.parse(request.body.raw!)).toEqual({ id: "{{customerId}}", query: { page: 0 } });
    }
    expect(savedRequests[0].headers).toEqual([
      { ...requests()[0].headers[0], value: "application/vnd.synthetic+json" },
      { ...requests()[0].headers[1], enabled: false }, requests()[0].headers[2]
    ]);
    expect(await restarted.approveAndApply(summary.planId, input.expectedRevision, summary.schemaUpdate?.affectedRequestIds))
      .toMatchObject({ alreadyApplied: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not change a saved schema or a supplied byte in an independent body/header plan", async () => {
    const input = await action();
    const plan = await service.preview(input);
    await service.approveAndApply(plan.planId, plan.expectedRevision);
    const saved = (await service.repository.snapshot()).workspace;
    expect(saved.collections[0].openApi).toEqual(workspace.collections[0].openApi);
    expect(flattenRequests(saved.collections[0]).filter(({ request }) => request.openApi).map(({ request }) => ({
      schema: request.body.schema, metadata: request.openApi
    }))).toEqual(requests().map((request) => ({ schema: request.body.schema, metadata: request.openApi })));
  });

  it("rejects stale epochs and invalid batches and rolls back receipt-write failures byte-for-byte", async () => {
    let written = false;
    service = new AgentService(new AgentRepository(root, async (file, bytes) => {
      if (file.endsWith(".receipt.json")) throw new Error("simulated receipt failure");
      await atomicWriteFile(file, bytes);
      if (file === path()) written = true;
    }), true);
    const before = await readFile(path(), "utf8");
    const input = await action();
    await expect(service.preview({ ...input, updates: [...input.updates.slice(0, 1), { ...input.updates[1], requestId: "missing" }] }))
      .rejects.toThrow("REQUEST_NOT_FOUND");
    expect(await readFile(path(), "utf8")).toBe(before);
    const plan = await service.preview(input);
    await expect(service.approveAndApply(plan.planId, plan.expectedRevision)).rejects.toThrow("simulated receipt failure");
    expect(written).toBe(true);
    expect(await readFile(path(), "utf8")).toBe(before);
    await writeFile(path(), before + " ");
    await expect(service.approveAndApply(plan.planId, plan.expectedRevision)).rejects.toThrow("REVISION_CONFLICT");
    await expect(service.preview(input)).rejects.toThrow("REVISION_CONFLICT");
    expect(await readFile(path(), "utf8")).toBe(before + " ");
  });

  it("rejects transient literal body/header credentials before writing plan state", async () => {
    const input = await action();
    const requestId = requests()[0].id;
    const marker = "SYNTHETIC_SECRET_DO_NOT_STORE";
    await expect(service.preview({ ...input, updates: [{ requestId, headers: [
      { op: "add", name: "Authorization", value: marker },
      { op: "remove", target: { name: "authorization" } }
    ] }] })).rejects.toThrow("REQUEST_UPDATE_CREDENTIAL_LITERAL");
    await expect(service.preview({ ...input, updates: [{ requestId, body: { op: "patch-json", patch: [
      { op: "add", path: "/credential", value: { password: marker } },
      { op: "remove", path: "/credential" }
    ] } }] })).rejects.toThrow("REQUEST_UPDATE_CREDENTIAL_LITERAL");
    const fakeProviderToken = "AKIA" + "0".repeat(16);
    await expect(service.preview({ ...input, updates: [{ requestId, headers: [
      { op: "add", name: "X-Correlation-Tag", value: fakeProviderToken }
    ] }] })).rejects.toThrow("REQUEST_UPDATE_CREDENTIAL_LITERAL");
    expect(await readdir(stateDir()).catch(() => [])).toEqual([]);
    expect(await readFile(path(), "utf8")).not.toContain(marker);
  });

  it("registers real single and batch MCP tools with zero request executions and no offline apply", async () => {
    const client = new Client({ name: "request-update-fixture", version: "1" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [
      fileURLToPath(new URL("../dist/index.js", import.meta.url)), "mcp", "--allow-apply", "--data-dir", root
    ], stderr: "pipe" });
    const call = async <T,>(name: string, params: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: params });
      return { error: result.isError, value: JSON.parse((result.content as { text: string }[])[0].text) as T };
    };
    try {
      await client.connect(transport);
      const { collectionId, expectedRevision, updates } = await action();
      const before = await readFile(path(), "utf8");
      const single = await call<AgentPreview>("preview_request_update", { collectionId, expectedRevision, ...updates[0] });
      const batch = await call<AgentPreview>("preview_request_updates", { collectionId, expectedRevision, updates });
      expect(single.error).not.toBe(true);
      expect(batch.error).not.toBe(true);
      expect(single.value.requestUpdate?.requests).toHaveLength(1);
      expect(batch.value.requestUpdate?.requests).toHaveLength(3);
      const malformed = await call<{ code: string }>("preview_request_update", {
        collectionId, expectedRevision, requestId: updates[0].requestId,
        body: { op: "clear", SYNTHETIC_KEY_MUST_NOT_ECHO: "SYNTHETIC_VALUE_MUST_NOT_ECHO" }
      });
      expect(malformed.value.code).toBe("INVALID_PLAN");
      expect(JSON.stringify(malformed)).not.toContain("SYNTHETIC_");
      for (const result of [single.value, batch.value]) {
        expect(result.networkRequests).toBe(0);
        expect((await call<{ code: string }>("apply_plan", { planId: result.planId, expectedRevision })).value.code)
          .toBe("REQUEST_UPDATE_DESKTOP_REVIEW_REQUIRED");
      }
      expect(await readFile(path(), "utf8")).toBe(before);
    } finally { await client.close(); }
  }, 20_000);
});
