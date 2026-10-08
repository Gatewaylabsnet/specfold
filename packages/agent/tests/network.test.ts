import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCollection, createEmptyWorkspace, createId, createRequest } from "@openapi-collection-studio/core";
import { startNetworkHost, callNetworkHost } from "../src/networkTransport";
import { executeApprovedNetwork } from "../src/networkPolicy";

const workspace = createEmptyWorkspace();
const collection = createCollection("Network test");
collection.baseUrl = "https://example.test/service";
const request = createRequest({ name: "GET test", url: "{{baseUrl}}/echo" });
request.auth = { type: "bearer", token: "{{accessToken}}" };
collection.requests.push(request); workspace.collections.push(collection);
workspace.environments[0].variables.push({ id: createId("var"), name: "accessToken", value: "PRIVATE_TOKEN", enabled: true, secret: true });
const call = { collectionId: collection.id, requestId: request.id };
const dependencies = () => ({
  enabled: vi.fn(async () => true),
  snapshot: vi.fn(async () => ({ workspace, revision: "same" })),
  confirm: vi.fn(async () => true),
  execute: vi.fn(async () => ({ status: 200, headers: { authorization: "Bearer PRIVATE_TOKEN" },
    body: JSON.stringify({ tckn: "11111111111", access_token: "PRIVATE_TOKEN", echo: "PRIVATE_TOKEN", email: "private@example.test" }) }))
});

describe("approved network capability", () => {
  it("defaults off and does not even resolve or send without opt-in", async () => {
    const deps = dependencies(); deps.enabled.mockResolvedValue(false);
    await expect(executeApprovedNetwork(call, deps)).rejects.toThrow("NETWORK_DISABLED");
    expect(deps.snapshot).not.toHaveBeenCalled(); expect(deps.execute).not.toHaveBeenCalled();
  });
  it("requires human native consent for each request", async () => {
    const deps = dependencies(); deps.confirm.mockResolvedValue(false);
    await expect(executeApprovedNetwork(call, deps)).rejects.toThrow("NETWORK_APPROVAL_DENIED");
    expect(deps.confirm).toHaveBeenCalledWith({ method: "GET", route: "https://example.test/service/echo" });
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it("refuses a changed workspace after consent", async () => {
    const deps = dependencies();
    deps.snapshot.mockResolvedValueOnce({ workspace, revision: "old" }).mockResolvedValueOnce({ workspace, revision: "new" });
    await expect(executeApprovedNetwork(call, deps)).rejects.toThrow("REVISION_CONFLICT");
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it("keeps resolved credentials inside the desktop and returns masked response data", async () => {
    const deps = dependencies();
    const result = JSON.stringify(await executeApprovedNetwork(call, deps));
    expect(deps.execute).toHaveBeenCalledOnce();
    for (const secret of ["PRIVATE_TOKEN", "11111111111", "private@example.test"]) expect(result).not.toContain(secret);
    expect(result).toContain("[REDACTED]");
  });
});

describe("same-user local network IPC", () => {
  let root: string, close: (() => Promise<void>) | undefined;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "specfold-ipc-")); });
  afterEach(async () => { await close?.(); await rm(root, { recursive: true, force: true }); });
  it("round trips only IDs over authenticated local IPC", async () => {
    const execute = vi.fn(async (ids) => ({ status: 200, ids }));
    close = await startNetworkHost(root, execute);
    expect(await callNetworkHost(root, call)).toEqual({ status: 200, ids: call });
    expect(execute).toHaveBeenCalledWith(call);
  });
  it("rejects an incorrect session capability token without executing", async () => {
    const execute = vi.fn(); close = await startNetworkHost(root, execute);
    const path = join(root, ".agent", "network-endpoint.json");
    const value = JSON.parse(await readFile(path, "utf8")); value.token = "0".repeat(64);
    await writeFile(path, JSON.stringify(value));
    await expect(callNetworkHost(root, call)).rejects.toThrow("IPC_UNAUTHORIZED");
    expect(execute).not.toHaveBeenCalled();
  });
});
