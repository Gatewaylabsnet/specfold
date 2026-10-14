import { expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEmptyWorkspace } from "@openapi-collection-studio/core";
import { callDesktopHost, startNetworkHost } from "../src/networkTransport";
import type { DesktopAgentCall } from "../src/desktopContracts";

it("routes the four guided tools through authenticated desktop IPC with only saved IDs", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "specfold-workflow-mcp-")));
  await writeFile(join(root, "workspace.json"), JSON.stringify(createEmptyWorkspace()));
  const dispatch = vi.fn(async (call: DesktopAgentCall) => call.operation === "workflow-profiles"
    ? [{ id: "profile", name: "Synthetic profile" }] : { received: call });
  const close = await startNetworkHost(root, vi.fn(), dispatch);
  const client = new Client({ name: "workflow-transport-regression", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url)), "mcp", "--data-dir", root, "--desktop", "--allow-network"], stderr: "pipe" });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    return JSON.parse((result.content as Array<{ text: string }>)[0].text);
  };
  try {
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["list_connection_profiles", "preview_test_plan", "run_test_plan", "get_test_report"]));
    expect(await call("list_connection_profiles")).toEqual([{ id: "profile", name: "Synthetic profile" }]);
    expect((await call("preview_test_plan", { profileId: "profile", requestIds: ["read", "write"] })).received)
      .toEqual({ operation: "workflow-preview", profileId: "profile", requestIds: ["read", "write"] });
    expect((await call("run_test_plan", { planId: "plan-uuid" })).received).toEqual({ operation: "workflow-run", planId: "plan-uuid" });
    expect((await call("get_test_report", { id: "plan-uuid" })).received).toEqual({ operation: "workflow-report", id: "plan-uuid" });
    const before = dispatch.mock.calls.length;
    await expect(callDesktopHost(root, { operation: "workflow-preview", profileId: "profile", requestIds: ["same", "same"] })).rejects.toThrow("INVALID_ARGUMENTS");
    await expect(callDesktopHost(root, { operation: "workflow-preview", profileId: "profile", requestIds: Array.from({ length: 21 }, (_, n) => String(n)) })).rejects.toThrow("INVALID_ARGUMENTS");
    expect(dispatch).toHaveBeenCalledTimes(before);
  } finally { await client.close(); await close(); await rm(root, { recursive: true, force: true }); }
}, 20_000);

it("aborts a guided desktop run when its MCP transport disconnects", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "specfold-workflow-cancel-")));
  let started!: () => void, aborted!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const canceled = new Promise<void>((resolve) => { aborted = resolve; });
  const close = await startNetworkHost(root, vi.fn(), async (_call, signal) => {
    started();
    await new Promise<void>((resolve) => signal!.addEventListener("abort", () => { aborted(); resolve(); }, { once: true }));
    return { status: "canceled" };
  });
  try {
    const controller = new AbortController();
    const pending = callDesktopHost(root, { operation: "workflow-run", planId: "plan" }, controller.signal);
    const rejection = expect(pending).rejects.toThrow("OPERATION_CANCELLED");
    await entered; controller.abort();
    await rejection; await canceled;
  } finally { await close(); await rm(root, { recursive: true, force: true }); }
}, 10_000);
