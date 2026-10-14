import { test, expect, _electron } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApinizerJwtRequest, createCollection, createEmptyWorkspace, createId, createRequest } from "../../../../packages/core/src/index";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));

test("real MCP masks stored custom API keys and JWT capture preserves pending user edits", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "specfold-agent-safety-")));
  if (!root.startsWith(join(await realpath(tmpdir()), "specfold-agent-safety-"))) throw new Error("Unexpected fixture root");
  let held: ServerResponse | undefined, reached!: () => void;
  const arrived = new Promise<void>((done) => { reached = done; });
  let requestCount = 0;
  const server = createServer((_request, response) => { requestCount++; held = response; reached(); });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No fixture address");
  const workspace = createEmptyWorkspace("Original workspace");
  const collection = createCollection("Synthetic API"); collection.baseUrl = `http://127.0.0.1:${address.port}`;
  const jwt = createApinizerJwtRequest(); jwt.url = `${collection.baseUrl}/auth/jwt`;
  const customKey = createRequest({ name: "Custom API key", method: "GET", url: "{{baseUrl}}/echo" });
  customKey.auth = { type: "apiKey", key: "X-Credential", value: "SYNTHETIC_MCP_API_CREDENTIAL", in: "header" };
  collection.requests.push(jwt, customKey); workspace.collections.push(collection);
  workspace.environments[0].variables.push(...["apinizerAuthAccessToken", "username", "password", "clientId"].map((name) =>
    ({ id: createId("var"), name, value: "SYNTHETIC_INITIAL", enabled: true, secret: true })));
  await writeFile(join(root, "workspace.json"), JSON.stringify(workspace));
  const executable = process.env.SPECFOLD_E2E_EXECUTABLE;
  const app = await _electron.launch({ executablePath: executable ? resolve(executable) : createRequire(import.meta.url)("electron"),
    args: executable ? ["--disable-gpu"] : [resolve(repository, "apps/desktop/out/main/index.js")],
    env: { ...process.env, SPECFOLD_E2E_USER_DATA_PATH: root } });
  let client: Client | undefined;
  try {
    const page = await app.firstWindow();
    await expect(page.locator(".save-status")).toHaveText("Saved");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Enable AI connections").check();
    await expect.poll(() => page.evaluate(async () => (await window.studio.loadSettings()).agentEnabled)).toBe(true);
    const connection = await page.evaluate(() => window.studio.getAgentConnection());
    client = new Client({ name: "specfold-safety-regression", version: "1" });
    await client.connect(new StdioClientTransport({ ...connection.configuration, stderr: "pipe" }));
    const expectedVersion = JSON.parse(await readFile(join(repository, "package.json"), "utf8")).version;
    expect(client.getServerVersion()?.version).toBe(expectedVersion);
    if (executable) expect(await app.evaluate(({ app }) => app.getVersion())).toBe(expectedVersion);
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client!.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      return JSON.parse((result.content as Array<{ text: string }>)[0].text);
    };
    const context = await call("get_documentation_context", { collectionId: collection.id });
    expect.soft(JSON.stringify(context)).not.toContain("SYNTHETIC_MCP_API_CREDENTIAL");
    expect(await readFile(join(root, "workspace.json"), "utf8")).not.toContain("SYNTHETIC_MCP_API_CREDENTIAL");
    await page.getByLabel("Allow agents to send requests and read masked responses").check();
    await expect.poll(() => page.evaluate(async () => (await window.studio.loadSettings()).agentNetworkEnabled)).toBe(true);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    // Hold the normal autosave window open so the HTTP completion race is deterministic.
    await page.evaluate(() => {
      const original = window.setTimeout.bind(window);
      window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
        original(handler, timeout === 350 ? 10_000 : timeout, ...args)) as typeof window.setTimeout;
    });
    const pending = call("send_request", { collectionId: collection.id, requestId: jwt.id });
    await arrived;
    await page.getByLabel("Workspace name", { exact: true }).fill("User edit during JWT");
    held!.setHeader("content-type", "application/json"); held!.end(JSON.stringify({ access_token: "SYNTHETIC_CAPTURED_JWT" }));
    expect((await pending).status).toBe(200);
    await expect.poll(async () => page.evaluate(async () => (await window.studio.loadWorkspace()).workspace.environments[0].variables
      .find((item) => item.name === "apinizerAuthAccessToken")?.value)).toBe("SYNTHETIC_CAPTURED_JWT");
    await expect(page.getByLabel("Workspace name", { exact: true })).toHaveValue("User edit during JWT");
    // An MCP read flushes pending renderer state through the normal production path.
    await call("list_collections", {});
    const saved = await page.evaluate(() => window.studio.loadWorkspace());
    expect(saved.workspace.name).toBe("User edit during JWT");
    expect(saved.workspace.environments[0].variables.find((item) => item.name === "apinizerAuthAccessToken")?.value).toBe("SYNTHETIC_CAPTURED_JWT");
    expect(await readFile(join(root, "workspace.json"), "utf8")).not.toContain("SYNTHETIC_CAPTURED_JWT");
    // Close the real MCP client's stdin while native consent is pending, then
    // simulate a late approval. The disconnected operation must never send.
    await app.evaluate(({ dialog }) => {
      const audit = globalThis as unknown as { auditConsent?: { signal?: AbortSignal; approve(): void } };
      dialog.showMessageBox = ((_parent: unknown, options: { signal?: AbortSignal }) =>
        new Promise((resolve) => { audit.auditConsent = { signal: options.signal,
          approve: () => resolve({ response: 0, checkboxChecked: false }) }; })) as typeof dialog.showMessageBox;
    });
    const abandoned = client.callTool({ name: "send_request", arguments: { collectionId: collection.id, requestId: jwt.id } }).catch(() => undefined);
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as unknown as { auditConsent?: unknown }).auditConsent))).toBe(true);
    await client.close();
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { auditConsent?: { signal?: AbortSignal } }).auditConsent?.signal?.aborted)).toBe(true);
    await app.evaluate(() => (globalThis as unknown as { auditConsent: { approve(): void } }).auditConsent.approve());
    await abandoned;
    client = new Client({ name: "specfold-after-disconnect", version: "1" });
    await client.connect(new StdioClientTransport({ ...connection.configuration, stderr: "pipe" }));
    await call("list_collections", {});
    expect(requestCount).toBe(1);
  } finally {
    held?.end(); await client?.close(); await app.close(); server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    // Only this test's canonical, uniquely created temporary profile is removed.
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
