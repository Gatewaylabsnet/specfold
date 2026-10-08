import { app, dialog } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { validateAgentWorkspace } from "../../../../packages/agent/src/validation";
import { startNetworkHost } from "../../../../packages/agent/src/networkTransport";
import { executeApprovedNetwork } from "../../../../packages/agent/src/networkPolicy";
import { loadSettings, loadWorkspace, serializeStorageMutation } from "./storage";
import { sendHttpRequest } from "./http";

export async function installAgentNetworkHost(): Promise<() => Promise<void>> {
  const root = app.getPath("userData");
  const snapshot = () => serializeStorageMutation(async () => {
    const raw = await readFile(join(root, "workspace.json"), "utf8");
    // Refuse corruption before the ordinary desktop loader can quarantine it.
    try { validateAgentWorkspace(JSON.parse(raw)); } catch { throw new Error("INVALID_WORKSPACE"); }
    const result = await loadWorkspace();
    if (result.recovered) throw new Error("INVALID_WORKSPACE");
    return { workspace: result.workspace, revision: createHash("sha256").update(raw).digest("hex") };
  });
  return startNetworkHost(root, (call) => executeApprovedNetwork(call, {
    enabled: async () => (await loadSettings()).agentNetworkEnabled === true,
    snapshot,
    confirm: async ({ method, route }) => (await dialog.showMessageBox({
      type: "warning", title: "Agent requests network access", defaultId: 1, cancelId: 1,
      buttons: ["Send this request", "Cancel"],
      message: `${method} ${route}`,
      detail: "A local agent wants to send this saved request using your configured environment credentials. This can modify server data. Secrets stay inside Specfold; common personal fields in the response are masked. Approve only if you trust this request."
    })).response === 0,
    execute: async ([request, environment, collection, folderPath]) => {
      const result = await sendHttpRequest({ request, environment, collection, folderPath: folderPath ? [...folderPath] : undefined }, -1, {
        maxResponseBytes: 512 * 1024, timeoutMs: 30_000, allowInsecureTls: false, redirect: "error"
      });
      return { ...result, rawBody: undefined };
    }
  }));
}
