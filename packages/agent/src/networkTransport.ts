import { connect, createServer, type Server } from "node:net";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { lstat, mkdir, unlink } from "node:fs/promises";
import { atomicWriteFile } from "./atomicFile";
import { readBoundedFile } from "./fileIO";
import { AgentError, safeAgentError } from "./errors";

export interface AgentNetworkCall { collectionId: string; requestId: string }
const endpointFile = (root: string) => join(root, ".agent", "network-endpoint.json");
const MAX_MESSAGE = 4096;
const MAX_RESULT = 2 * 1024 * 1024;

/** Authenticated same-user IPC for network execution only. It never writes workspace data. */
export async function startNetworkHost(root: string, execute: (call: AgentNetworkCall) => Promise<unknown>): Promise<() => Promise<void>> {
  const state = join(root, ".agent");
  await mkdir(state, { recursive: true, mode: 0o700 });
  if ((await lstat(state)).isSymbolicLink()) throw new AgentError("UNSAFE_DATA_PATH");
  const suffix = createHash("sha256").update(root).digest("hex").slice(0, 24);
  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\specfold-agent-${suffix}` : join(state, "network.sock");
  if (process.platform !== "win32") await unlink(endpoint).catch(() => undefined);
  const token = randomBytes(32).toString("hex");
  let busy = false;
  const server: Server = createServer((socket) => {
    let input = "";
    socket.setEncoding("utf8");
    socket.setTimeout(60_000, () => socket.destroy());
    socket.on("error", () => undefined);
    socket.on("data", (chunk) => {
      input += chunk;
      if (Buffer.byteLength(input) > MAX_MESSAGE) { socket.destroy(); return; }
      if (!input.includes("\n")) return;
      socket.removeAllListeners("data");
      void (async () => {
        let ownsBusy = false;
        try {
          const value = JSON.parse(input.trim());
          if (typeof value.token !== "string" || value.token.length !== token.length ||
              !timingSafeEqual(Buffer.from(value.token), Buffer.from(token))) throw new AgentError("IPC_UNAUTHORIZED");
          if (typeof value.collectionId !== "string" || typeof value.requestId !== "string" ||
              value.collectionId.length > 200 || value.requestId.length > 200) throw new AgentError("INVALID_ARGUMENTS");
          if (busy) throw new AgentError("NETWORK_BUSY");
          busy = true; ownsBusy = true;
          const output = JSON.stringify({ result: await execute({ collectionId: value.collectionId, requestId: value.requestId }) });
          if (Buffer.byteLength(output) > MAX_RESULT) throw new AgentError("INPUT_TOO_LARGE");
          socket.end(`${output}\n`);
        } catch (error) { socket.end(`${JSON.stringify({ error: safeAgentError(error) })}\n`); }
        finally { if (ownsBusy) busy = false; }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(endpoint, resolve); });
  try { await atomicWriteFile(endpointFile(root), JSON.stringify({ schema: "specfold.agent-ipc.v1", endpoint, token })); }
  catch (error) { server.close(); throw error; }
  return async () => {
    server.close();
    await unlink(endpointFile(root)).catch(() => undefined);
    if (process.platform !== "win32") await unlink(endpoint).catch(() => undefined);
  };
}

export async function callNetworkHost(root: string, call: AgentNetworkCall): Promise<unknown> {
  let metadata;
  try { metadata = JSON.parse(await readBoundedFile(endpointFile(root), 4096)); }
  catch { throw new AgentError("DESKTOP_REQUIRED"); }
  const suffix = createHash("sha256").update(root).digest("hex").slice(0, 24);
  const expected = process.platform === "win32" ? `\\\\.\\pipe\\specfold-agent-${suffix}` : join(root, ".agent", "network.sock");
  if (metadata.schema !== "specfold.agent-ipc.v1" || metadata.endpoint !== expected || !/^[a-f0-9]{64}$/.test(metadata.token)) {
    throw new AgentError("IPC_UNAUTHORIZED");
  }
  return new Promise((resolve, reject) => {
    const socket = connect(metadata.endpoint);
    let output = "";
    socket.setEncoding("utf8");
    socket.setTimeout(65_000, () => { socket.destroy(); reject(new AgentError("NETWORK_TIMEOUT")); });
    socket.on("connect", () => socket.write(`${JSON.stringify({ ...call, token: metadata.token })}\n`));
    socket.on("error", () => reject(new AgentError("DESKTOP_REQUIRED")));
    socket.on("data", (chunk) => {
      output += chunk;
      if (Buffer.byteLength(output) > MAX_RESULT) { socket.destroy(); reject(new AgentError("INPUT_TOO_LARGE")); }
    });
    socket.on("end", () => {
      try {
        const value = JSON.parse(output.trim());
        if (value.error) reject(new AgentError(value.error.code));
        else resolve(value.result);
      } catch { reject(new AgentError("IPC_INVALID_RESPONSE")); }
    });
  });
}
