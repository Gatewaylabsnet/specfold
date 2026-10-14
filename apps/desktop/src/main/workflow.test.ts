import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCollection, createEmptyWorkspace, createRequest, type ConnectionProfile, type Workspace } from "@openapi-collection-studio/core";
import { DEFAULT_SETTINGS } from "../shared/contracts";
import { cancelWorkflowRun, previewWorkflowPlan, registerWorkflowIpc, resetWorkflowState, runWorkflowPlan,
  saveWorkflowProfile, workflowProfiles, workflowReport } from "./workflow";

const state = vi.hoisted(() => ({ workspace: undefined as Workspace | undefined, generation: 0, secure: true,
  encryptionNonce: 0,
  parent: undefined as unknown, settings: {} as typeof DEFAULT_SETTINGS,
  flush: vi.fn(), send: vi.fn(), event: vi.fn(), dialog: vi.fn(), save: vi.fn(), trusted: vi.fn(), handlers: new Map<string, (...args: unknown[]) => unknown>() }));
vi.mock("electron", () => ({ app: { getPath: () => "C:/synthetic-workflow" },
  BrowserWindow: { getAllWindows: () => state.parent ? [state.parent] : [] }, dialog: { showMessageBox: state.dialog },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => state.handlers.set(channel, handler) } }));
vi.mock("node:fs/promises", () => ({ readFile: async () => JSON.stringify({ ...state.workspace,
  environments: state.workspace?.environments.map((environment) => ({ ...environment,
    variables: environment.variables.map((variable) => ({ ...variable,
      value: variable.secret ? `enc:v1:synthetic-${state.encryptionNonce}-${variable.value}` : variable.value })) })) }) }));
vi.mock("./agentWorkspace", () => ({ flushAgentEditor: state.flush, agentEvent: state.event }));
vi.mock("./http", () => ({ sendHttpRequest: state.send }));
vi.mock("./security", () => ({ assertTrustedIpcSender: state.trusted }));
vi.mock("./workspaceGeneration", () => ({ workspaceGeneration: () => state.generation,
  bumpWorkspaceGeneration: () => ++state.generation,
  checkWorkspaceGeneration: (expected: number) => { if (expected !== state.generation) throw new Error("WORKSPACE_CHANGED"); } }));
vi.mock("./storage", () => ({ serializeStorageMutation: async (operation: () => Promise<unknown>) => operation(),
  loadWorkspace: async () => ({ workspace: structuredClone(state.workspace), recovered: false, secureStorageAvailable: state.secure }),
  loadSettings: async () => state.settings, saveWorkspace: async (workspace: Workspace) => {
    state.save(workspace); state.workspace = structuredClone(workspace);
  } }));

function profile(auth: ConnectionProfile["auth"] = { kind: "none" }): ConnectionProfile {
  return { id: "personal-profile", name: "Personal", provider: "apinizer", collectionId: state.workspace!.collections[0].id,
    environmentId: state.workspace!.environments[0].id, baseUrl: "https://api.example.invalid", source: { kind: "existing", label: "Saved collection" }, auth };
}
function setup(auth?: ConnectionProfile["auth"]) {
  const selected = profile(auth);
  state.workspace!.connectionProfiles = [selected];
  return selected;
}
function tokenVariables() {
  state.workspace!.environments[0].variables = ["user", "password", "client", "token"].map((name) =>
    ({ id: `var-${name}`, name, value: name === "token" ? "" : `SYNTHETIC-${name}`, enabled: true, secret: true }));
}
const tokenAuth: ConnectionProfile["auth"] = { kind: "apinizer", endpoint: "https://issuer.example.invalid/auth/custom",
  usernameVariable: "user", passwordVariable: "password", clientIdVariable: "client", tokenVariable: "token" };
const success = (body = "{}") => ({ status: 200, statusText: "OK", durationMs: 1, sizeBytes: body.length,
  headers: { "content-type": "application/json" }, body, rawBody: body });

beforeEach(() => {
  resetWorkflowState();
  vi.resetAllMocks();
  state.handlers.clear();
  state.generation = 0; state.secure = true; state.encryptionNonce = 0;
  state.settings = { ...DEFAULT_SETTINGS, agentEnabled: true, agentNetworkEnabled: true };
  state.workspace = createEmptyWorkspace();
  const collection = createCollection("Saved requests");
  collection.requests = [createRequest({ name: "Read", url: "{{baseUrl}}/read" })];
  state.workspace.collections.push(collection);
  const parent = new EventEmitter() as EventEmitter & { isDestroyed(): boolean; webContents: EventEmitter & { isDestroyed(): boolean } };
  parent.isDestroyed = () => false;
  parent.webContents = new EventEmitter() as typeof parent.webContents;
  parent.webContents.isDestroyed = () => false;
  state.parent = parent;
  state.flush.mockResolvedValue(undefined);
  state.dialog.mockResolvedValue({ response: 0 });
  state.send.mockResolvedValue(success());
  state.trusted.mockImplementation(() => undefined);
});
afterEach(() => { resetWorkflowState(); vi.useRealTimers(); });

describe("workflow desktop ownership", () => {
  it("appends an imported collection without replacing old requests and returns new generation", async () => {
    const original = structuredClone(state.workspace!.collections[0]);
    const result = await saveWorkflowProfile({ profile: { ...profile(), collectionId: "" }, expectedGeneration: 0,
      sourceText: JSON.stringify({ openapi: "3.0.3", info: { title: "New API", version: "1" }, paths: {
        "/new": { get: { responses: { "200": { description: "OK" } } } } } }) });
    expect(result.workspace.collections).toHaveLength(2);
    expect(result.workspace.collections[0]).toEqual(original);
    expect(result.workspace.connectionProfiles?.[0].collectionId).toBe(result.workspace.collections[1].id);
    expect(result.generation).toBe(1);
    expect(state.flush).toHaveBeenCalledTimes(1);
    expect(state.event).not.toHaveBeenCalled();
  });

  it("creates only approved auth variables as secrets and preserves old values on blank input", async () => {
    tokenVariables();
    const before = structuredClone(state.workspace!.collections);
    const result = await saveWorkflowProfile({ profile: profile(tokenAuth), expectedGeneration: 0,
      credentials: { user: "", password: "SYNTHETIC-new-password", client: "", token: "" } });
    expect(result.workspace.collections).toEqual(before);
    expect(result.workspace.environments[0].variables.find((item) => item.name === "user")?.value).toBe("SYNTHETIC-user");
    expect(result.workspace.environments[0].variables.find((item) => item.name === "password")?.value).toBe("SYNTHETIC-new-password");
    expect(result.workspace.environments[0].variables.every((item) => item.secret && item.enabled)).toBe(true);
    expect(JSON.stringify(result.workspace.connectionProfiles)).not.toContain("SYNTHETIC");
  });

  it("rejects unexpected credentials, unavailable encryption, stale generation and credential URLs without saving", async () => {
    await expect(saveWorkflowProfile({ profile: profile(tokenAuth), expectedGeneration: 0, credentials: { unrelated: "SYNTHETIC-secret" } })).rejects.toThrow("INVALID_WORKFLOW_CREDENTIALS");
    state.secure = false;
    await expect(saveWorkflowProfile({ profile: profile(tokenAuth), expectedGeneration: 0 })).rejects.toThrow("SECURE_STORAGE_REQUIRED");
    state.secure = true; state.generation = 2;
    await expect(saveWorkflowProfile({ profile: profile(), expectedGeneration: 0 })).rejects.toThrow("WORKSPACE_CHANGED");
    state.generation = 0;
    await expect(saveWorkflowProfile({ profile: profile(), expectedGeneration: 0, sourceText: JSON.stringify({ openapi: "3.0.3",
      info: { title: "Bad", version: "1" }, servers: [{ url: "https://user:password@example.invalid" }], paths: {} }) })).rejects.toThrow("CREDENTIAL_URL_NOT_ALLOWED");
    expect(state.save).not.toHaveBeenCalled();
  });

  it("returns metadata summaries without credentials or profile variable references", async () => {
    tokenVariables();
    const saved = setup(tokenAuth);
    saved.name = "Profile SYNTHETIC-password";
    const result = await workflowProfiles();
    expect(result[0].id).toBe(saved.id);
    expect(result[0].auth).toEqual({ kind: "apinizer" });
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC");
    expect(JSON.stringify(result)).not.toContain("passwordVariable");
  });

  it("refuses stale plans and expired plans before consent or sends", async () => {
    const saved = setup();
    const plan = await previewWorkflowPlan(saved.id);
    state.workspace!.collections[0].requests[0].name = "Changed";
    await expect(runWorkflowPlan(plan.id)).rejects.toThrow("REVISION_CONFLICT");
    expect(state.send).not.toHaveBeenCalled();
    expect(state.dialog).not.toHaveBeenCalled();
    const next = await previewWorkflowPlan(saved.id);
    vi.useFakeTimers(); vi.setSystemTime(Date.parse(next.expiresAt) + 1);
    await expect(runWorkflowPlan(next.id)).rejects.toThrow("PLAN_EXPIRED");
    expect(state.send).not.toHaveBeenCalled();
  });

  it("shows a native parented exact consent and requires separate preview for every run", async () => {
    const saved = setup();
    const request = state.workspace!.collections[0].requests[0];
    request.method = "POST";
    const plan = await previewWorkflowPlan(saved.id, [request.id]);
    const report = await runWorkflowPlan(plan.id);
    expect(state.dialog).toHaveBeenCalledTimes(1);
    expect(state.dialog.mock.calls[0][0]).toBe(state.parent);
    expect(state.dialog.mock.calls[0][1].detail).toContain("MAY CHANGE DATA: POST https://api.example.invalid/read");
    expect(state.send.mock.calls[0][2]).toMatchObject({ maxResponseBytes: 512 * 1024, timeoutMs: 30_000, allowInsecureTls: false, redirect: "error" });
    expect(workflowReport(plan.id).id).toBe(report.id);
    await expect(runWorkflowPlan(plan.id)).rejects.toThrow("WORKFLOW_PLAN_NOT_FOUND");
  });

  it("persists only the issuer token delta and advances the expected revision for later sends", async () => {
    tokenVariables(); const saved = setup(tokenAuth);
    const plan = await previewWorkflowPlan(saved.id);
    const before = structuredClone(state.workspace!.collections);
    state.send.mockResolvedValueOnce(success('{"access_token":"SYNTHETIC-captured"}')).mockResolvedValueOnce(success());
    const report = await runWorkflowPlan(plan.id);
    expect(report.authentication?.status).toBe("passed");
    expect(state.send).toHaveBeenCalledTimes(2);
    expect(state.workspace!.collections).toEqual(before);
    expect(state.workspace!.environments[0].variables.find((item) => item.name === "token")?.value).toBe("SYNTHETIC-captured");
    expect(state.event).toHaveBeenCalledWith(expect.objectContaining({ kind: "token-captured", previous: expect.objectContaining({ value: "" }), value: "SYNTHETIC-captured", generation: 1 }));
    expect(state.dialog.mock.calls[0][1].detail).toContain(tokenAuth.endpoint);
  });

  it("allows identical token autosaves with fresh ciphertext and updatedAt before later sends", async () => {
    tokenVariables(); const saved = setup(tokenAuth);
    const plan = await previewWorkflowPlan(saved.id);
    state.event.mockImplementation((event) => {
      if (event.kind === "token-captured") {
        state.encryptionNonce++;
        state.workspace!.updatedAt = "2030-01-01T00:00:00Z";
      }
    });
    state.send.mockResolvedValueOnce(success('{"access_token":"SYNTHETIC-captured"}')).mockResolvedValueOnce(success());
    const report = await runWorkflowPlan(plan.id);
    expect(report.status).toBe("completed");
    expect(report.totals.passed).toBe(1);
    expect(state.send).toHaveBeenCalledTimes(2);
  });

  it.each(["request", "environment", "name"])("still blocks a genuine %s edit after token capture", async (kind) => {
    tokenVariables(); const saved = setup(tokenAuth);
    const plan = await previewWorkflowPlan(saved.id);
    state.event.mockImplementation((event) => {
      if (event.kind !== "token-captured") return;
      if (kind === "request") state.workspace!.collections[0].requests[0].url = "{{baseUrl}}/changed";
      if (kind === "environment") state.workspace!.environments[0].variables[0].value = "SYNTHETIC-changed";
      if (kind === "name") state.workspace!.name = "Changed workspace";
    });
    state.send.mockResolvedValueOnce(success('{"access_token":"SYNTHETIC-captured"}'));
    const report = await runWorkflowPlan(plan.id);
    expect(report.status).toBe("blocked");
    expect(state.send).toHaveBeenCalledTimes(1);
  });

  it("agent settings gate runs while ordinary UI runs remain allowed", async () => {
    const saved = setup(); state.settings.agentNetworkEnabled = false;
    const agentPlan = await previewWorkflowPlan(saved.id);
    expect((await runWorkflowPlan(agentPlan.id, undefined, true)).status).toBe("blocked");
    expect(state.send).not.toHaveBeenCalled();
    const uiPlan = await previewWorkflowPlan(saved.id);
    expect((await runWorkflowPlan(uiPlan.id)).status).toBe("completed");
    expect(state.send).toHaveBeenCalledTimes(1);
  });

  it("cancels on window destruction and retains a canceled report without late sends", async () => {
    const saved = setup();
    const second = createRequest({ name: "Second", url: "{{baseUrl}}/second" });
    state.workspace!.collections[0].requests.push(second);
    const plan = await previewWorkflowPlan(saved.id);
    state.send.mockImplementationOnce(async (_payload, _owner, limits) => {
      (state.parent as EventEmitter).emit("closed");
      expect(limits.signal.aborted).toBe(true);
      return success();
    });
    const report = await runWorkflowPlan(plan.id);
    expect(report.status).toBe("canceled");
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(workflowReport(report.id).status).toBe("canceled");
  });

  it("does not cancel UI runs when only agent permissions are revoked", async () => {
    const saved = setup(); const plan = await previewWorkflowPlan(saved.id);
    state.send.mockImplementationOnce(async (_payload, _owner, limits) => {
      cancelWorkflowRun(true); expect(limits.signal.aborted).toBe(false); return success();
    });
    expect((await runWorkflowPlan(plan.id)).status).toBe("completed");
  });

  it("retains only ten reports and clears reports/plans on reset", async () => {
    const saved = setup(); const reportIds: string[] = [];
    for (let index = 0; index < 11; index++) {
      const plan = await previewWorkflowPlan(saved.id);
      reportIds.push((await runWorkflowPlan(plan.id)).id);
    }
    expect(() => workflowReport(reportIds[0])).toThrow("WORKFLOW_REPORT_NOT_FOUND");
    expect(workflowReport(reportIds[10]).status).toBe("completed");
    resetWorkflowState();
    expect(() => workflowReport(reportIds[10])).toThrow("WORKFLOW_REPORT_NOT_FOUND");
  });

  it("bounds pending plans to 32 and reclaims expired entries", async () => {
    const saved = setup();
    for (let index = 0; index < 32; index++) await previewWorkflowPlan(saved.id);
    await expect(previewWorkflowPlan(saved.id)).rejects.toThrow("WORKFLOW_PLAN_LIMIT");
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 16 * 60_000);
    expect((await previewWorkflowPlan(saved.id)).profileId).toBe(saved.id);
  });

  it("checks trusted main-frame ownership on every workflow IPC channel", async () => {
    registerWorkflowIpc();
    state.trusted.mockImplementation(() => { throw new Error("untrusted"); });
    for (const channel of ["workflow:saveProfile", "workflow:preview", "workflow:run", "workflow:cancel", "workflow:report"]) {
      await expect(state.handlers.get(channel)!({ sender: {} }, "anything")).rejects.toThrow("untrusted");
    }
    expect(state.trusted).toHaveBeenCalledTimes(5);
    expect(state.save).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled();
  });
});
