import { connect, createServer, type Server, type Socket } from "node:net";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { lstat, mkdir, unlink } from "node:fs/promises";
import { atomicWriteFile } from "./atomicFile";
import { readBoundedFile } from "./fileIO";
import { AgentError, safeAgentError } from "./errors";
import type { DesktopAgentCall } from "./desktopContracts";
import { mutationSchema } from "./validation";

export interface AgentNetworkCall { collectionId: string; requestId: string }
const endpointFile = (root: string) => join(root, ".agent", "network-endpoint.json");
const MAX_MESSAGE = 5 * 1024 * 1024;
const MAX_RESULT = 2 * 1024 * 1024;

/** Authenticated same-user transport. Only the desktop owner dispatches mutations. */
export async function startNetworkHost(root: string, execute: (call: AgentNetworkCall, signal?: AbortSignal) => Promise<unknown>,
  dispatch?: (call: DesktopAgentCall, signal?: AbortSignal) => Promise<unknown>): Promise<() => Promise<void>> {
  const state = join(root, ".agent");
  await mkdir(state, { recursive: true, mode: 0o700 });
  if ((await lstat(state)).isSymbolicLink()) throw new AgentError("UNSAFE_DATA_PATH");
  const suffix = createHash("sha256").update(root).digest("hex").slice(0, 24);
  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\specfold-agent-${suffix}` : join(state, "network.sock");
  if (process.platform !== "win32") await unlink(endpoint).catch(() => undefined);
  const token = randomBytes(32).toString("hex");
  let active: AbortController | undefined;
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    let input = "";
    let finished = false;
    const controller = new AbortController();
    sockets.add(socket);
    const cancel = () => {
      if (!finished) controller.abort();
      // A late result from a cancelled operation must not release its successor.
      if (active === controller) active = undefined;
    };
    socket.setEncoding("utf8");
    socket.setTimeout(60_000, () => { cancel(); socket.destroy(); });
    socket.on("error", () => undefined);
    socket.on("end", cancel);
    socket.on("close", () => { cancel(); sockets.delete(socket); });
    socket.on("data", (chunk) => {
      input += chunk;
      if (Buffer.byteLength(input) > MAX_MESSAGE) { socket.destroy(); return; }
      if (!input.includes("\n")) return;
      socket.removeAllListeners("data");
      void (async () => {
        try {
          if (controller.signal.aborted) throw new AgentError("OPERATION_CANCELLED");
          const value = JSON.parse(input.trim());
          if (typeof value.token !== "string" || value.token.length !== token.length ||
              !timingSafeEqual(Buffer.from(value.token), Buffer.from(token))) throw new AgentError("IPC_UNAUTHORIZED");
          const call = value.operation ? validateDesktopCall(value) : validateDesktopCall({ ...value, operation: "send" });
          if (call.operation === "workflow-run") socket.setTimeout(12 * 60_000);
          if (active) throw new AgentError("NETWORK_BUSY");
          active = controller;
          const output = JSON.stringify({ result: value.operation && dispatch ? await dispatch(call, controller.signal)
            : call.operation === "send" ? await execute({ collectionId: call.collectionId, requestId: call.requestId }, controller.signal) : (() => { throw new AgentError("INVALID_ARGUMENTS"); })() });
          if (Buffer.byteLength(output) > MAX_RESULT) throw new AgentError("INPUT_TOO_LARGE");
          if (!controller.signal.aborted && !socket.destroyed) socket.end(`${output}\n`);
        } catch (error) {
          if (!controller.signal.aborted && !socket.destroyed) socket.end(`${JSON.stringify({ error: safeAgentError(error) })}\n`);
        } finally {
          finished = true;
          if (active === controller) active = undefined;
        }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(endpoint, resolve); });
  try { await atomicWriteFile(endpointFile(root), JSON.stringify({ schema: "specfold.agent-ipc.v1", endpoint, token })); }
  catch (error) { server.close(); throw error; }
  let closing: Promise<void> | undefined;
  return () => closing ??= (async () => {
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    active?.abort(); active = undefined;
    for (const socket of sockets) socket.destroy();
    await closed;
    await unlink(endpointFile(root)).catch(() => undefined);
    if (process.platform !== "win32") await unlink(endpoint).catch(() => undefined);
  })();
}

export async function callNetworkHost(root: string, call: AgentNetworkCall, signal?: AbortSignal): Promise<unknown> {
  return callDesktopHost(root, call, signal);
}

export async function callDesktopHost<T = unknown>(root: string, call: DesktopAgentCall | AgentNetworkCall,
  signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new AgentError("OPERATION_CANCELLED");
  let metadata;
  try { metadata = JSON.parse(await readBoundedFile(endpointFile(root), 4096)); }
  catch { throw new AgentError(signal?.aborted ? "OPERATION_CANCELLED" : "DESKTOP_REQUIRED"); }
  if (signal?.aborted) throw new AgentError("OPERATION_CANCELLED");
  const suffix = createHash("sha256").update(root).digest("hex").slice(0, 24);
  const expected = process.platform === "win32" ? `\\\\.\\pipe\\specfold-agent-${suffix}` : join(root, ".agent", "network.sock");
  if (metadata.schema !== "specfold.agent-ipc.v1" || metadata.endpoint !== expected || !/^[a-f0-9]{64}$/.test(metadata.token)) {
    throw new AgentError("IPC_UNAUTHORIZED");
  }
  return new Promise((resolve, reject) => {
    const socket = connect(metadata.endpoint);
    let output = "";
    let settled = false, connected = false;
    const finish = (error?: AgentError, value?: T) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      socket.destroy();
      if (error) reject(error); else resolve(value as T);
    };
    const abort = () => finish(new AgentError("OPERATION_CANCELLED"));
    signal?.addEventListener("abort", abort, { once: true });
    socket.setEncoding("utf8");
    socket.setTimeout("operation" in call && call.operation === "workflow-run" ? 12 * 60_000 + 5000 : 65_000,
      () => finish(new AgentError("NETWORK_TIMEOUT")));
    socket.on("connect", () => {
      connected = true;
      if (signal?.aborted) { abort(); return; }
      socket.write(`${JSON.stringify({ ...call, token: metadata.token })}\n`);
    });
    socket.on("error", () => finish(new AgentError(connected ? "IPC_DISCONNECTED" : "DESKTOP_REQUIRED")));
    socket.on("close", () => finish(new AgentError("IPC_DISCONNECTED")));
    socket.on("data", (chunk) => {
      output += chunk;
      if (Buffer.byteLength(output) > MAX_RESULT) finish(new AgentError("INPUT_TOO_LARGE"));
    });
    socket.on("end", () => {
      if (!output.trim()) { finish(new AgentError("IPC_DISCONNECTED")); return; }
      try {
        const value = JSON.parse(output.trim());
        if (value.error) finish(new AgentError(value.error.code));
        else finish(undefined, value.result as T);
      } catch { finish(new AgentError("IPC_INVALID_RESPONSE")); }
    });
    if (signal?.aborted) abort();
  });
}

function validateDesktopCall(value: Record<string, unknown>): DesktopAgentCall {
  const id = (name: string, plan = false) => {
    const item = value[name];
    if (typeof item !== "string" || !item || item.length > 200 || (plan && !/^[a-f0-9]{64}$/.test(item))) throw new AgentError("INVALID_ARGUMENTS");
    return item;
  };
  switch (value.operation) {
    case "ping": case "list": case "workflow-profiles": return { operation: value.operation };
    case "workflow-run": return { operation: value.operation, planId: id("planId") };
    case "workflow-report": return { operation: value.operation, id: id("id") };
    case "workflow-preview": {
      const requestIds = value.requestIds;
      if (requestIds !== undefined && (!Array.isArray(requestIds) || requestIds.length > 20 ||
        requestIds.some((item) => typeof item !== "string" || !item || item.length > 200) ||
        new Set(requestIds).size !== requestIds.length)) throw new AgentError("INVALID_ARGUMENTS");
      return { operation: value.operation, profileId: id("profileId"), requestIds: requestIds as string[] | undefined };
    }
    case "inspect": case "send": return { operation: value.operation, collectionId: id("collectionId"), requestId: id("requestId") };
    case "validate": case "documentation": return { operation: value.operation, collectionId: id("collectionId") };
    case "diff": case "status": return { operation: value.operation, planId: id("planId", true) };
    case "review": return { operation: "review", planId: id("planId", true), expectedRevision: id("expectedRevision", true) };
    case "preview": {
      const action = mutationSchema.safeParse(value.action);
      if (!action.success) throw new AgentError("INVALID_ARGUMENTS");
      return { operation: "preview", action: action.data };
    }
    default: throw new AgentError("INVALID_ARGUMENTS");
  }
}
