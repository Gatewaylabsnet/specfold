import { describe, expect, it, vi } from "vitest";
import { createCollection, createEmptyWorkspace, createKeyValue, createRequest, type ConnectionProfile, type WorkflowTestPlan } from "@openapi-collection-studio/core";
import type { SendRequestPayload, SendRequestResult } from "../shared/contracts";
import { executeWorkflowPlan, workflowAuthenticationRequest, workflowRequest, type WorkflowRunnerDependencies } from "./workflowRunner";

const response = (body = "{}", status = 200): SendRequestResult => ({ status, statusText: "OK", durationMs: 2,
  sizeBytes: body.length, headers: { "content-type": "application/json" }, body, rawBody: body });
function fixture(auth: ConnectionProfile["auth"] = { kind: "none" }, count = 1) {
  const workspace = createEmptyWorkspace();
  const collection = createCollection("Example");
  collection.baseUrl = "https://legacy.invalid/path";
  collection.requests = Array.from({ length: count }, (_, index) => createRequest({ name: `Request ${index}`, url: `{{baseUrl}}/service-${index}` }));
  workspace.collections.push(collection);
  workspace.environments[0].variables = ["user", "password", "client", "secret", "token", "key"].map((name) =>
    ({ id: `var-${name}`, name, value: `SYNTHETIC-${name}`, enabled: true, secret: true }));
  const profile: ConnectionProfile = { id: "profile", name: "Personal gateway", provider: "apinizer", collectionId: collection.id,
    environmentId: workspace.environments[0].id, baseUrl: "https://example.invalid/api", source: { kind: "existing", label: "Local" }, auth };
  const plan: WorkflowTestPlan = { id: "plan", profileId: profile.id, profileName: profile.name, collectionId: collection.id,
    environmentId: profile.environmentId, environmentName: "Local", createdAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-01T00:15:00Z",
    revision: "revision", warnings: [], rows: collection.requests.map((request) => ({ requestId: request.id, name: request.name,
      method: request.method, route: `https://example.invalid/api/service`, effect: "read", selected: true, status: "ready", provenance: [],
      expectedStatuses: [200], responseSchema: { type: "object" } })) };
  const deps: WorkflowRunnerDependencies = { checkCurrent: vi.fn(async () => undefined), confirm: vi.fn(async () => true),
    send: vi.fn(async () => response()), captureToken: vi.fn(async () => undefined) };
  return { workspace, collection, profile, plan, deps };
}
const apinizer: ConnectionProfile["auth"] = { kind: "apinizer", endpoint: "https://issuer.invalid/custom/token", usernameVariable: "user",
  passwordVariable: "password", clientIdVariable: "client", tokenVariable: "token", clientSecretVariable: "secret" };

describe("guided workflow runner", () => {
  it("gets an issuer token first, captures before service sends and never mutates saved requests", async () => {
    const f = fixture(apinizer, 2), before = structuredClone(f.workspace), order: string[] = [];
    f.deps.captureToken = vi.fn(async () => { order.push("capture"); });
    f.deps.send = vi.fn(async (payload: SendRequestPayload) => {
      order.push(payload.request.name);
      if (payload.request.name === "Apinizer authentication") {
        expect(payload.request.url).toBe(apinizer.endpoint);
        expect(payload.request.body.form?.map((field) => [field.key, field.value])).toEqual([
          ["grant_type", "password"], ["username", "{{user}}"], ["password", "{{password}}"], ["client_id", "{{client}}"], ["client_secret", "{{secret}}"]]);
        return response('{"access_token":"SYNTHETIC-new/token"}');
      }
      expect(payload.environment?.variables.find((value) => value.name === "token")?.value).toBe("SYNTHETIC-new/token");
      expect(payload.request.auth).toEqual({ type: "bearer", token: "{{token}}" });
      expect(payload.folderPath).toEqual([]);
      expect(payload.collection?.baseUrl).toBe(f.profile.baseUrl);
      return response('{"echo":"SYNTHETIC-token SYNTHETIC-new/token SYNTHETIC-password"}');
    });
    const report = await executeWorkflowPlan(f.workspace, f.profile, f.plan, f.deps);
    expect(order).toEqual(["Apinizer authentication", "capture", "Request 0", "Request 1"]);
    expect(f.workspace).toEqual(before);
    expect(report.authentication?.status).toBe("passed");
    expect(report.totals).toEqual({ passed: 2, failed: 0, skipped: 0, blocked: 0 });
    expect(JSON.stringify(report)).not.toContain("SYNTHETIC-");
  });

  it.each([401, 500, 200])("blocks all services when issuer response is unusable (%s)", async (status) => {
    const f = fixture(apinizer, 2);
    f.deps.send = vi.fn(async () => response('{"message":"no access token"}', status));
    const report = await executeWorkflowPlan(f.workspace, f.profile, f.plan, f.deps);
    expect(f.deps.send).toHaveBeenCalledTimes(1);
    expect(f.deps.captureToken).not.toHaveBeenCalled();
    expect(report.authentication?.status).toBe("failed");
    expect(report.totals.blocked).toBe(2);
  });

  it("blocks services if encrypted token persistence fails", async () => {
    const f = fixture(apinizer);
    f.deps.send = vi.fn(async () => response('{"access_token":"SYNTHETIC-new"}'));
    f.deps.captureToken = vi.fn(async () => { throw new Error("TOKEN_NOT_SAVED"); });
    const report = await executeWorkflowPlan(f.workspace, f.profile, f.plan, f.deps);
    expect(f.deps.send).toHaveBeenCalledTimes(1);
    expect(report.status).toBe("blocked");
    expect(report.authentication?.message).toContain("stored securely");
  });

  it("does not acquire or send anything without usable configured credentials", async () => {
    const f = fixture(apinizer);
    f.workspace.environments[0].variables.find((value) => value.name === "password")!.enabled = false;
    const report = await executeWorkflowPlan(f.workspace, f.profile, f.plan, f.deps);
    expect(f.deps.confirm).not.toHaveBeenCalled();
    expect(f.deps.send).not.toHaveBeenCalled();
    expect(report.status).toBe("blocked");
  });

  it("does not send after native consent is declined or saved state changes during consent", async () => {
    for (const stale of [false, true]) {
      const f = fixture();
      f.deps.confirm = vi.fn(async () => {
        if (stale) f.deps.checkCurrent = vi.fn(async () => { throw new Error("REVISION_CONFLICT"); });
        return stale;
      });
      const report = await executeWorkflowPlan(f.workspace, f.profile, f.plan, f.deps);
      expect(f.deps.send).not.toHaveBeenCalled();
      expect(report.status).toBe("blocked");
    }
  });

  it("cancels an in-flight send without late capture, observations or following sends", async () => {
    const f = fixture(apinizer, 2), controller = new AbortController();
    f.deps.send = vi.fn(async () => { controller.abort(); return response('{"access_token":"SYNTHETIC-new"}'); });
    const report = await executeWorkflowPlan(f.workspace, f.profile, f.plan, f.deps, controller.signal);
    expect(report.status).toBe("canceled");
    expect(report.totals.blocked).toBe(2);
    expect(f.deps.captureToken).not.toHaveBeenCalled();
    expect(f.deps.send).toHaveBeenCalledTimes(1);
  });

  it("checks revision and permissions before each step and never retries a 401", async () => {
    const f = fixture({ kind: "bearer", tokenVariable: "token" }, 2);
    f.deps.send = vi.fn(async () => {
      f.deps.checkCurrent = vi.fn(async () => { throw new Error("NETWORK_DISABLED"); });
      return response("{}", 401);
    });
    const report = await executeWorkflowPlan(f.workspace, f.profile, f.plan, f.deps);
    expect(f.deps.send).toHaveBeenCalledTimes(1);
    expect(report.totals.failed).toBe(1);
    expect(report.totals.blocked).toBe(1);
  });

  it("does not send skipped/blocked rows or plans over the auth-inclusive 20-send limit", async () => {
    const f = fixture(apinizer, 20);
    const tooMany = await executeWorkflowPlan(f.workspace, f.profile, f.plan, f.deps);
    expect(tooMany.status).toBe("blocked");
    expect(f.deps.confirm).not.toHaveBeenCalled();
    expect(f.deps.send).not.toHaveBeenCalled();
    f.plan.rows.forEach((row) => { row.selected = false; });
    f.plan.rows[0].selected = true;
    f.plan.rows[0].status = "blocked";
    const none = await executeWorkflowPlan(f.workspace, f.profile, f.plan, f.deps);
    expect(none.totals.skipped).toBe(19);
    expect(none.totals.blocked).toBe(1);
    expect(f.deps.send).not.toHaveBeenCalled();
  });

  it("reports blocked definitions separately from skipped selections", async () => {
    const f = fixture({ kind: "none" }, 3);
    f.plan.rows[1].selected = false;
    f.plan.rows[1].status = "blocked";
    f.plan.rows[1].reason = "Missing required input.";
    f.plan.rows[2].selected = false;
    f.plan.rows[2].status = "skipped";
    const report = await executeWorkflowPlan(f.workspace, f.profile, f.plan, f.deps);
    expect(report.totals).toEqual({ passed: 1, failed: 0, skipped: 1, blocked: 1 });
    expect(report.results[1].reason).toBe("Missing required input.");
    expect(f.deps.send).toHaveBeenCalledTimes(1);
  });

  it("blocks saved absolute destinations outside the profile origin", async () => {
    const f = fixture();
    f.collection.requests[0].url = "https://foreign.invalid/echo";
    const report = await executeWorkflowPlan(f.workspace, f.profile, f.plan, f.deps);
    expect(f.deps.send).not.toHaveBeenCalled();
    expect(report.results[0].reason).toContain("outside");
  });

  it.each(["SYNTHETIC/KEY", "SYNTHETIC KEY+VALUE"])("masks raw and URL/form encoded custom API-key reflections: %s", async (value) => {
    const f = fixture({ kind: "apiKey", key: "customer", in: "query", valueVariable: "key" });
    f.workspace.environments[0].variables.find((item) => item.name === "key")!.value = value;
    f.deps.send = vi.fn(async () => response(JSON.stringify({ url: `/echo?customer=${encodeURIComponent(value)}`,
      form: encodeURIComponent(value).replace(/%20/g, "+"), literal: value })));
    const report = await executeWorkflowPlan(f.workspace, f.profile, f.plan, f.deps);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("SYNTHETIC");
    expect(serialized).toContain("[REDACTED]");
  });

  it("validates the full response but retains only bounded masked snippets", async () => {
    const f = fixture();
    f.deps.send = vi.fn(async () => ({ ...response(JSON.stringify({ data: "ü".repeat(100_000) })), headers: { large: "字".repeat(20_000) } }));
    const report = await executeWorkflowPlan(f.workspace, f.profile, f.plan, f.deps);
    expect(report.results[0].status).toBe("passed");
    expect(report.results[0].response?.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThan(12_000);
    expect(JSON.stringify(report)).not.toContain("rawBody");
  });

  it("does not call a truncated transport body a passing schema result", async () => {
    const f = fixture();
    f.deps.send = vi.fn(async () => ({ ...response(), truncated: true }));
    const report = await executeWorkflowPlan(f.workspace, f.profile, f.plan, f.deps);
    expect(report.results[0].status).toBe("blocked");
  });

  it("keeps the serialized aggregate below 1 MiB even with escaped display strings", async () => {
    const f = fixture({ kind: "none" }, 500);
    f.plan.rows.forEach((row, index) => {
      row.name = "\u0000".repeat(160); row.route = "\u0001".repeat(512);
      row.selected = index < 20;
    });
    f.deps.send = vi.fn(async () => response(JSON.stringify({ escaped: "\u0000".repeat(10_000) })));
    const report = await executeWorkflowPlan(f.workspace, f.profile, f.plan, f.deps);
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThanOrEqual(1024 * 1024);
    expect(report.results).toHaveLength(500);
    expect(report.totals.passed).toBe(20);
    expect(report.totals.skipped).toBe(480);
  });

  it("overrides generic auth in clones and removes obsolete auth fields", () => {
    const f = fixture();
    const request = f.collection.requests[0];
    request.auth = { type: "apiKey", key: "oldKey", value: "old-value", in: "query" };
    request.queryParams = [createKeyValue("oldKey", "old-value"), createKeyValue("customer", "old-customer")];
    request.headers = [createKeyValue("Authorization", "Bearer old-token")];
    for (const auth of [{ kind: "none" }, { kind: "bearer", tokenVariable: "token" },
      { kind: "basic", usernameVariable: "user", passwordVariable: "password" },
      { kind: "apiKey", key: "customer", in: "query", valueVariable: "key" }] as ConnectionProfile["auth"][]) {
      const clone = workflowRequest(request, { ...f.profile, auth });
      expect(clone.auth.type).toBe(auth.kind);
      expect(clone.headers).toEqual([]);
      expect(clone.queryParams.some((item) => item.key === "oldKey")).toBe(false);
      if (auth.kind === "apiKey") expect(clone.queryParams).toEqual([]);
    }
    expect(request.headers).toHaveLength(1);
    expect(request.queryParams).toHaveLength(2);
    const recipe = workflowAuthenticationRequest({ ...f.profile, auth: { ...apinizer, clientSecretVariable: undefined } });
    expect(recipe?.body.form?.some((item) => item.key === "client_secret")).toBe(false);
  });
});
