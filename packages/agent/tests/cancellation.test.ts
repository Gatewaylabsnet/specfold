import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect, type Socket } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startNetworkHost, callDesktopHost, callNetworkHost } from "../src/networkTransport";
import { AgentError, safeAgentError } from "../src/errors";
import type { AgentService } from "../src/service";

const mcp = vi.hoisted(() => ({ tools: new Map<string, (...args: any[]) => unknown>(), close: vi.fn(async () => undefined) }));
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({ McpServer: class {
  registerTool(name: string, _options: unknown, handler: (...args: any[]) => unknown) { mcp.tools.set(name, handler); }
  async connect() {}
  close = mcp.close;
} }));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({ StdioServerTransport: class {} }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const call = { collectionId: "synthetic-collection", requestId: "synthetic-request" };

describe("agent request cancellation", () => {
  let root: string, close: (() => Promise<void>) | undefined;
  const sockets: Socket[] = [];
  const release: Array<() => void> = [];
  const pending: Promise<unknown>[] = [];
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "specfold-cancel-")); });
  afterEach(async () => {
    for (const done of release.splice(0)) done();
    for (const socket of sockets.splice(0)) socket.destroy();
    await close?.(); close = undefined;
    await Promise.allSettled(pending.splice(0));
    await rm(root, { recursive: true, force: true });
  });
  async function rawCall(requestId: string) {
    const metadata = JSON.parse(await readFile(join(root, ".agent", "network-endpoint.json"), "utf8"));
    const socket = connect(metadata.endpoint); sockets.push(socket);
    socket.on("error", () => undefined);
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    socket.write(`${JSON.stringify({ ...call, requestId, token: metadata.token })}\n`);
    return socket;
  }
  async function startTestMcp(service: AgentService) {
    const { startMcp } = await import("../src/mcp");
    const once = vi.spyOn(process.stdin, "once");
    try {
      await startMcp(service);
      const calls: Array<[string, (...args: any[]) => void]> = once.mock.calls;
      const listeners = calls.filter(([event]) => event === "end" || event === "close");
      for (const [event, listener] of listeners) release.push(() => { process.stdin.off(event, listener); });
      return listeners;
    } finally { once.mockRestore(); }
  }

  it("disconnects deferred consent and keeps a newer operation busy when the old callback finishes", async () => {
    const oldConsent = deferred<void>(), currentConsent = deferred<void>();
    const oldStarted = deferred<void>(), currentStarted = deferred<void>(), oldFinished = deferred<void>();
    release.push(() => oldConsent.resolve(), () => currentConsent.resolve());
    let oldSignal: AbortSignal | undefined;
    const sent = vi.fn();
    close = await startNetworkHost(root, async (ids, signal?: AbortSignal) => {
      if (ids.requestId === "abandoned") {
        oldSignal = signal; oldStarted.resolve();
        try {
          await oldConsent.promise;
          if (signal?.aborted) throw new AgentError("OPERATION_CANCELLED");
          sent(ids.requestId);
        } finally { oldFinished.resolve(); }
      } else {
        currentStarted.resolve(); await currentConsent.promise;
      }
      return { ok: true };
    });
    const abandoned = await rawCall("abandoned");
    await oldStarted.promise;
    abandoned.destroy();
    await vi.waitFor(() => expect(oldSignal?.aborted).toBe(true));
    const current = callNetworkHost(root, { ...call, requestId: "current" });
    pending.push(current); void current.catch(() => undefined);
    await currentStarted.promise;
    oldConsent.resolve(); await oldFinished.promise;
    await expect(callNetworkHost(root, { ...call, requestId: "probe" })).rejects.toThrow("NETWORK_BUSY");
    expect(sent).not.toHaveBeenCalled();
    currentConsent.resolve();
    await expect(current).resolves.toEqual({ ok: true });
  });

  it("propagates caller AbortSignal through real desktop IPC before deferred approval can send", async () => {
    const consent = deferred<void>(), started = deferred<void>(), finished = deferred<void>();
    release.push(() => consent.resolve());
    let hostSignal: AbortSignal | undefined;
    const sent = vi.fn();
    close = await startNetworkHost(root, async () => undefined, async (_ids, signal?: AbortSignal) => {
      hostSignal = signal; started.resolve();
      try {
        await consent.promise;
        if (signal?.aborted) throw new AgentError("OPERATION_CANCELLED");
        sent(); return { ok: true };
      } finally { finished.resolve(); }
    });
    const controller = new AbortController();
    const result = callDesktopHost(root, { operation: "send", ...call }, controller.signal);
    pending.push(result); void result.catch(() => undefined);
    await started.promise;
    controller.abort();
    let outcome: unknown;
    void result.then((value) => { outcome = value; }, (error) => { outcome = error; });
    await vi.waitFor(() => expect(outcome).toBeInstanceOf(AgentError));
    expect(safeAgentError(outcome).code).toBe("OPERATION_CANCELLED");
    await vi.waitFor(() => expect(hostSignal?.aborted).toBe(true));
    consent.resolve(); await finished.promise;
    expect(sent).not.toHaveBeenCalled();
  });

  it("does not dispatch an already-cancelled client request", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    close = await startNetworkHost(root, execute);
    const controller = new AbortController(); controller.abort();
    await expect(callNetworkHost(root, call, controller.signal)).rejects.toThrow("OPERATION_CANCELLED");
    expect(execute).not.toHaveBeenCalled();
  });

  it("host shutdown aborts pending work and settles connected clients", async () => {
    const consent = deferred<void>(), started = deferred<void>();
    release.push(() => consent.resolve());
    let hostSignal: AbortSignal | undefined;
    close = await startNetworkHost(root, async (_ids, signal?: AbortSignal) => {
      hostSignal = signal; started.resolve(); await consent.promise;
      return { ok: true };
    });
    const result = callNetworkHost(root, call);
    pending.push(result); void result.catch(() => undefined);
    await started.promise;
    await close(); close = undefined;
    expect(hostSignal?.aborted).toBe(true);
    let outcome: unknown;
    void result.then((value) => { outcome = value; }, (error) => { outcome = error; });
    await vi.waitFor(() => expect(outcome).toBeInstanceOf(AgentError));
    expect(safeAgentError(outcome).code).toBe("IPC_DISCONNECTED");
    await expect(readFile(join(root, ".agent", "network-endpoint.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("forwards the MCP request cancellation signal to the service", async () => {
    const sendRequest = vi.fn(async () => ({ ok: true }));
    await startTestMcp({ sendRequest } as unknown as AgentService);
    const controller = new AbortController();
    const handler = mcp.tools.get("send_request")!;
    await handler(call, { signal: controller.signal });
    expect(sendRequest).toHaveBeenCalledWith(call.collectionId, call.requestId, controller.signal);
  });

  it("closes the MCP server on stdin EOF so SDK request signals abort before the helper exits", async () => {
    mcp.close.mockClear();
    const listeners = await startTestMcp({} as AgentService);
    const eof = listeners.find(([event]) => event === "end")?.[1];
    const closed = listeners.find(([event]) => event === "close")?.[1];
    expect(eof).toBeTypeOf("function");
    expect(closed).toBeTypeOf("function");
    eof?.(); closed?.();
    expect(mcp.close).toHaveBeenCalledOnce();
  });
});
