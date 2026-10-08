import { expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEmptyWorkspace } from "@openapi-collection-studio/core";

it("uses a real stdio MCP client/server without stdout logs or unapproved writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "specfold-mcp-"));
  const workspace = createEmptyWorkspace();
  await writeFile(join(root, "workspace.json"), JSON.stringify(workspace));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url)), "mcp", "--data-dir", root], stderr: "pipe" });
  const client = new Client({ name: "specfold-acceptance", version: "1.0.0" });
  let stderr = ""; transport.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  const decode = (result: any) => JSON.parse(result.content[0].text);
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "list_collections", "inspect_request", "preview_openapi_import", "show_diff", "preview_bind_bearer",
      "preview_apinizer_jwt", "apply_plan", "validate_collection", "send_request"
    ]));
    expect(decode(await client.callTool({ name: "list_collections", arguments: {} })).collections).toEqual([]);
    const text = await readFile(new URL("../fixtures/tarimkredi.synthetic.openapi.yaml", import.meta.url), "utf8");
    const preview = decode(await client.callTool({ name: "preview_openapi_import", arguments: { text, apinizer: true } }));
    expect(preview.diff.added).toHaveLength(17);
    expect(decode(await client.callTool({ name: "show_diff", arguments: { planId: preview.planId } })).diff.added).toHaveLength(17);
    const apply = await client.callTool({ name: "apply_plan", arguments: { planId: preview.planId, expectedRevision: preview.expectedRevision } });
    expect(apply.isError).toBe(true); expect(decode(apply).code).toBe("WRITES_DISABLED");
    const send = await client.callTool({ name: "send_request", arguments: { collectionId: "unknown", requestId: "unknown" } });
    expect(decode(send).code).toBe("NETWORK_DISABLED");
    const broken = decode(await client.callTool({ name: "preview_openapi_import", arguments: { text: '{"password":"NEVER_LOG_ME" broken}' } }));
    expect(broken.code).toBe("INVALID_OPENAPI"); expect(JSON.stringify(broken)).not.toContain("NEVER_LOG_ME");
    expect(stderr).not.toContain("NEVER_LOG_ME");
    expect(JSON.parse(await readFile(join(root, "workspace.json"), "utf8")).collections).toEqual([]);
  } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
}, 20_000);
