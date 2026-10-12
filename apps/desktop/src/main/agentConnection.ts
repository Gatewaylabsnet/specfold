import { app } from "electron";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export function agentConfiguration() {
  // NSIS portable launchers do not forward stdio. Use the extracted runtime
  // while desktop owns it; its per-artifact extraction path is stable on restart.
  const command = process.platform === "win32" ? app.getPath("exe") : process.env.APPIMAGE || app.getPath("exe");
  // Resolve packaged resources at helper launch, including a fresh portable/AppImage extraction.
  const bootstrap = 'require(require("node:path").join(require("node:path").dirname(process.execPath), process.platform === "darwin" ? "../Resources/agent.cjs" : "resources/agent.cjs"))';
  const args = app.isPackaged ? ["-e", bootstrap, "--", "--data-dir", app.getPath("userData")]
    : [resolve(dirname(fileURLToPath(import.meta.url)), "../../../../packages/agent/dist/desktop.cjs"), "--data-dir", app.getPath("userData")];
  return { command, args, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

export async function testBundledAgent() {
  const client = new Client({ name: "specfold-connection-test", version: app.getVersion() });
  const transport = new StdioClientTransport({ ...agentConfiguration(), stderr: "pipe" });
  try {
    await client.connect(transport, { timeout: 10_000 });
    const result = await client.callTool({ name: "list_collections", arguments: {} }, undefined, { timeout: 10_000 });
    if (result.isError) throw new Error("AGENT_DISABLED");
    return { ok: true, message: "The bundled agent connected successfully. Copy its configuration to your AI client." };
  } catch {
    return { ok: false, message: "Could not connect. Enable AI connections and keep Specfold open, then try again." };
  } finally { await client.close(); }
}
