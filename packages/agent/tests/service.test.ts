import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCollection, createEmptyWorkspace, createId, createRequest, flattenRequests, type Workspace
} from "@openapi-collection-studio/core";
import { AgentRepository } from "../src/repository";
import { AgentService } from "../src/service";
import { acquireWorkspaceLease } from "../src/workspaceLock";
import { atomicWriteFile } from "../../../apps/desktop/src/main/storageService";
import { runCli } from "../src/cli";
import { safeAgentError } from "../src/errors";

const fixture = await readFile(new URL("../fixtures/tarimkredi.synthetic.openapi.yaml", import.meta.url), "utf8");
let root: string, workspace: Workspace, service: AgentService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "specfold-agent-"));
  workspace = createEmptyWorkspace();
  workspace.environments[0].variables.push({ id: createId("var"), name: "apinizerAuthAccessToken",
    value: "enc:v1:ZW5jcnlwdGVkLXNlY3JldA==", enabled: true, secret: true });
  await writeFile(join(root, "workspace.json"), JSON.stringify(workspace));
  service = new AgentService(new AgentRepository(root), true);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

const preview = () => service.preview({ kind: "import-openapi", text: fixture, apinizer: true });
const approvedImport = async () => {
  const plan = await preview();
  await service.approve(plan.planId, plan.expectedRevision);
  return { plan, result: await service.apply(plan.planId, plan.expectedRevision) };
};

describe("two-phase local agent", () => {
  it("imports 16 synthetic POST methods, root JWT and bearer refs without network execution", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const before = await readFile(join(root, "workspace.json"), "utf8");
    const plan = await preview();
    expect(await readFile(join(root, "workspace.json"), "utf8")).toBe(before);
    expect(plan.diff.added).toHaveLength(17);
    expect(plan.warnings.join(" ")).toContain("scope");
    expect(plan.warnings.join(" ")).toContain("type");
    expect(plan.warnings.join(" ")).toContain("personal");
    await service.approve(plan.planId, plan.expectedRevision);
    const result = await service.apply(plan.planId, plan.expectedRevision);
    const saved = await service.repository.snapshot();
    expect(saved.workspace.schemaVersion).toBe(1);
    const collection = saved.workspace.collections[0];
    expect(collection.baseUrl).toBe("https://api.tarimorman.gov.tr/tarimkredi");
    const requests = flattenRequests(collection).map(({ request }) => request);
    expect(requests).toHaveLength(17);
    const jwt = requests.find((request) => request.name === "Apinizer JWT Token")!;
    expect(jwt.url).toBe("https://api.tarimorman.gov.tr/auth/jwt");
    expect(jwt.auth.type).toBe("none");
    expect(jwt.body.form?.map(({ key, value }) => [key, value])).toEqual([
      ["grant_type", "password"], ["username", "{{username}}"], ["password", "{{password}}"], ["client_id", "{{clientId}}"]
    ]);
    const methods = requests.filter((request) => request !== jwt);
    expect(methods).toHaveLength(16);
    expect(methods.every((request) => request.method === "POST" && request.auth.type === "bearer" &&
      request.auth.token === "{{apinizerAuthAccessToken}}")).toBe(true);
    expect(saved.workspace.environments).toEqual(workspace.environments);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.safetyBackup).toBeTruthy();
    expect(await readFile(join(root, "backups", result.safetyBackup!), "utf8")).toBe(before);
  });

  it("returns an idempotent receipt and a fresh repeated import creates no duplicates", async () => {
    const { plan, result } = await approvedImport();
    const repeated = await service.apply(plan.planId, plan.expectedRevision);
    expect(repeated.alreadyApplied).toBe(true);
    expect(repeated.collectionId).toBe(result.collectionId);
    expect((await new AgentService(new AgentRepository(root), true).apply(plan.planId, plan.expectedRevision)).alreadyApplied).toBe(true);
    const again = await preview();
    expect(again.diff.added).toEqual([]);
    await service.approve(again.planId, again.expectedRevision);
    await service.apply(again.planId, again.expectedRevision);
    const saved = await service.repository.snapshot();
    expect(saved.workspace.collections).toHaveLength(1);
    expect(flattenRequests(saved.workspace.collections[0])).toHaveLength(17);
  });

  it("rejects missing human approval and disabled writes", async () => {
    const plan = await preview();
    await expect(service.apply(plan.planId, plan.expectedRevision)).rejects.toThrow("APPROVAL_REQUIRED");
    await expect(new AgentService(service.repository).apply(plan.planId, plan.expectedRevision)).rejects.toThrow("WRITES_DISABLED");
    await expect(runCli(service, "approve", { plan: plan.planId, revision: plan.expectedRevision })).rejects.toThrow("APPROVAL_REQUIRED");
  });

  it("rejects writes while desktop lease is held, but can read saved collections", async () => {
    const plan = await preview();
    await service.approve(plan.planId, plan.expectedRevision);
    const before = await readFile(join(root, "workspace.json"), "utf8");
    const release = acquireWorkspaceLease(root, "desktop");
    try {
      expect((await service.listCollections()).collections).toEqual([]);
      await expect(service.apply(plan.planId, plan.expectedRevision)).rejects.toThrow("WORKSPACE_BUSY");
      expect(await readFile(join(root, "workspace.json"), "utf8")).toBe(before);
    } finally { release(); }
    await service.apply(plan.planId, plan.expectedRevision);
  });

  it("serializes concurrent writers by rejecting the competing transaction", async () => {
    const plan = await preview();
    await service.approve(plan.planId, plan.expectedRevision);
    const attempts = await Promise.allSettled([
      service.apply(plan.planId, plan.expectedRevision), service.apply(plan.planId, plan.expectedRevision)
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.message).toBe("WORKSPACE_BUSY");
    expect((await service.repository.snapshot()).workspace.collections).toHaveLength(1);
  });

  it("rejects a stale revision or mismatched apply revision without modifying data", async () => {
    const plan = await preview();
    await service.approve(plan.planId, plan.expectedRevision);
    await expect(service.apply(plan.planId, "0".repeat(64))).rejects.toThrow("REVISION_CONFLICT");
    workspace.name = "User changed this";
    const changed = JSON.stringify(workspace);
    await writeFile(join(root, "workspace.json"), changed);
    await expect(service.apply(plan.planId, plan.expectedRevision)).rejects.toThrow("REVISION_CONFLICT");
    await expect(service.showDiff(plan.planId)).rejects.toThrow("REVISION_CONFLICT");
    expect(await readFile(join(root, "workspace.json"), "utf8")).toBe(changed);
  });

  it("never recovers or overwrites corrupt, malformed, or unsupported workspaces", async () => {
    for (const raw of ["{broken", '{"schemaVersion":2}', JSON.stringify({ ...workspace, collections: [{ id: "bad" }] })]) {
      await writeFile(join(root, "workspace.json"), raw);
      await expect(preview()).rejects.toThrow("INVALID_WORKSPACE");
      expect(await readFile(join(root, "workspace.json"), "utf8")).toBe(raw);
    }
    const badEncoding = Buffer.from([0xff, 0xfe, 0x7b]);
    await writeFile(join(root, "workspace.json"), badEncoding);
    await expect(preview()).rejects.toThrow("INVALID_WORKSPACE");
    expect(await readFile(join(root, "workspace.json"))).toEqual(badEncoding);
  });

  it("rolls back the workspace if recording the receipt fails", async () => {
    const before = await readFile(join(root, "workspace.json"), "utf8");
    const repository = new AgentRepository(root, async (path, content) => {
      if (path.endsWith(".receipt.json")) throw new Error("simulated failure");
      await atomicWriteFile(path, content);
    });
    const failing = new AgentService(repository, true);
    const plan = await failing.preview({ kind: "import-openapi", text: fixture, apinizer: true });
    await failing.approve(plan.planId, plan.expectedRevision);
    await expect(failing.apply(plan.planId, plan.expectedRevision)).rejects.toThrow("simulated failure");
    expect(await readFile(join(root, "workspace.json"), "utf8")).toBe(before);
    expect((await readdir(join(root, "backups"))).some((name) => name.startsWith("agent-safety-"))).toBe(true);
  });

  it("rejects tampered plans and path traversal", async () => {
    const plan = await preview();
    const path = join(root, ".agent", `${plan.planId}.plan.json`);
    const document = JSON.parse(await readFile(path, "utf8"));
    document.action.apinizer = false;
    await writeFile(path, JSON.stringify(document));
    await expect(service.apply(plan.planId, plan.expectedRevision)).rejects.toThrow("INVALID_PLAN");
    await expect(service.showDiff("../workspace")).rejects.toThrow("INVALID_PLAN");
  });

  it("redacts secrets, resolved Authorization, credentials and personal data from replies/plans", async () => {
    const collection = createCollection("Private");
    collection.baseUrl = "https://example.test/api";
    const request = createRequest({ name: "Private request", url: "https://example.test?password=opaque-password" });
    request.auth = { type: "bearer", token: "opaque-token" };
    request.headers.push({ id: createId("kv"), key: "Authorization", value: "Bearer opaque-token", enabled: true });
    request.body = { mode: "json", raw: JSON.stringify({ password: "opaque-password", tckn: "11111111111", email: "person@example.test" }) };
    request.responseExamples = [{ id: createId("res"), name: "Private response", status: 200, headers: [],
      body: JSON.stringify({ access_token: "opaque-token", tckn: "11111111111" }) }];
    collection.requests.push(request); workspace.collections.push(collection);
    workspace.environments[0].variables.push({ id: createId("var"), name: "password", value: "opaque-password", enabled: true, secret: true });
    await writeFile(join(root, "workspace.json"), JSON.stringify(workspace));
    const replies = JSON.stringify([await service.listCollections(), await service.inspectRequest(collection.id, request.id),
      await service.preview({ kind: "bind-bearer", collectionId: collection.id, variableName: "apinizerAuthAccessToken" })]);
    for (const secret of ["opaque-password", "opaque-token", "11111111111", "person@example.test", "enc:v1:"]) expect(replies).not.toContain(secret);
    expect(replies).toContain("apinizerAuthAccessToken");
    const plan = await service.preview({ kind: "import-openapi", text: fixture, apinizer: true });
    const exportedPlan = await readFile(join(root, ".agent", `${plan.planId}.plan.json`), "utf8");
    expect(exportedPlan).not.toContain("11111111111");
    expect(safeAgentError(new Error("parse error with opaque-password"))).toEqual({ code: "OPERATION_FAILED", message: expect.any(String) });
    await expect(service.sendRequest(collection.id, request.id)).rejects.toThrow("NETWORK_DISABLED");
  });

  it("binds only references without changing encrypted environment values", async () => {
    const { result } = await approvedImport();
    const plan = await service.preview({ kind: "bind-bearer", collectionId: result.collectionId, variableName: "otherToken" });
    await service.approve(plan.planId, plan.expectedRevision);
    await service.apply(plan.planId, plan.expectedRevision);
    const snapshot = await service.repository.snapshot();
    expect(snapshot.workspace.environments).toEqual(workspace.environments);
    const validation = await service.validateCollection(result.collectionId);
    expect(validation.issues.join(" ")).toContain("otherToken");
    const jwt = flattenRequests(snapshot.workspace.collections[0]).find(({ request }) => request.name === "Apinizer JWT Token")!;
    expect(jwt.request.auth.type).toBe("none");
  });

  it("refuses a plaintext-secret safety backup instead of copying credentials", async () => {
    workspace.environments[0].variables[0].value = "PLAINTEXT_MUST_NOT_COPY";
    await writeFile(join(root, "workspace.json"), JSON.stringify(workspace));
    const plan = await preview(); await service.approve(plan.planId, plan.expectedRevision);
    await expect(service.apply(plan.planId, plan.expectedRevision)).rejects.toThrow("UNPROTECTED_SECRET");
    expect(await readdir(root)).not.toContain("backups");
    workspace.environments[0].variables[0].value = "enc:v1:ZW5jcnlwdGVkLXNlY3JldA==";
    const references = createCollection("Safe references");
    const request = createRequest({ name: "Header reference" });
    request.headers.push({ id: createId("kv"), key: "Authorization", value: "Bearer {{apinizerAuthAccessToken}}", enabled: true });
    references.requests.push(request); workspace.collections.push(references);
    await writeFile(join(root, "workspace.json"), JSON.stringify(workspace));
    expect((await service.inspectRequest(references.id, request.id)).request.headers[0].value).toBe("Bearer {{apinizerAuthAccessToken}}");
    const safe = await preview(); await service.approve(safe.planId, safe.expectedRevision);
    await service.apply(safe.planId, safe.expectedRevision);
  });

  it("rejects oversize imports and arbitrary approval-file forgery", async () => {
    await expect(service.preview({ kind: "import-openapi", text: "x".repeat(4 * 1024 * 1024 + 1) })).rejects.toThrow("INVALID_PLAN");
    const plan = await preview();
    await writeFile(join(root, ".agent", `${plan.planId}.approval.json`), JSON.stringify({ planId: plan.planId, expectedRevision: plan.expectedRevision, signature: "fake" }));
    await expect(service.apply(plan.planId, plan.expectedRevision)).rejects.toThrow("APPROVAL_REQUIRED");
  });
});
