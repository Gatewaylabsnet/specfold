import { test, expect, _electron } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer } from "node:http";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createCollection, createEmptyWorkspace, createId, createRequest, createApinizerJwtRequest } from "../../../../packages/core/src/index";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const electronExecutable: string = createRequire(import.meta.url)("electron");
test("bundled MCP reviews live imports, uses bounded sessions and prepares redacted documentation", async () => {
  test.setTimeout(120_000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "specfold-agent-ux-")));
  let calls = 0;
  const server = createServer((request, response) => {
    calls++; response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(request.url === "/auth/jwt" ? { access_token: "JWT_TEST_SECRET", echo: "JWT_TEST_SECRET" }
      : { ok: true, tckn: "11111111111", echo: request.headers.authorization }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No mock server");
  const workspace = createEmptyWorkspace("Agent workflow");
  const collection = createCollection("Local API"); collection.baseUrl = `http://127.0.0.1:${address.port}`;
  const request = createRequest({ name: "Echo", method: "GET", url: "{{baseUrl}}/echo" });
  request.auth = { type: "bearer", token: "{{apinizerAuthAccessToken}}" };
  const jwt = createApinizerJwtRequest(); jwt.url = `${collection.baseUrl}/auth/jwt`;
  collection.requests.push(request, jwt); workspace.collections.push(collection);
  workspace.environments[0].variables.push(...["apinizerAuthAccessToken", "username", "password", "clientId"].map((name) =>
    ({ id: createId("var"), name, value: "", enabled: true, secret: true })));
  await writeFile(join(root, "workspace.json"), JSON.stringify(workspace));
  const packaged = process.env.SPECFOLD_E2E_EXECUTABLE;
  const app = await _electron.launch({ executablePath: packaged ? resolve(packaged) : electronExecutable,
    args: packaged ? ["--disable-gpu"] : [resolve(repository, "apps/desktop/out/main/index.js")],
    env: { ...process.env, SPECFOLD_E2E_USER_DATA_PATH: root,
      ...(process.env.SPECFOLD_E2E_PORTABLE_HELPER ? { PORTABLE_EXECUTABLE_FILE: process.env.SPECFOLD_E2E_PORTABLE_HELPER } : {}) } });
  let client: Client | undefined;
  try {
    const page = await app.firstWindow(); await expect(page.getByLabel("Request URL")).toBeVisible();
    await expect(page.locator(".save-status")).toHaveText("Saved");
    const saved = await page.evaluate(() => window.studio.loadWorkspace());
    saved.workspace.environments[0].variables.forEach((item) => { item.value = item.name === "apinizerAuthAccessToken" ? "INITIAL_SECRET" : "CREDENTIAL_TEST"; });
    await page.evaluate(async (value) => { await window.studio.saveWorkspace(value.workspace, value.generation); }, saved);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Enable AI connections").check();
    await expect.poll(async () => page.evaluate(async () => (await window.studio.loadSettings()).agentEnabled)).toBe(true);
    await page.getByRole("button", { name: "Test connection", exact: true }).click();
    await expect(page.getByText("The bundled agent connected successfully.", { exact: false })).toBeVisible({ timeout: 20_000 });
    const info = await page.evaluate(() => window.studio.getAgentConnection());
    if (process.env.SPECFOLD_E2E_PORTABLE_HELPER) expect(info.configuration.command).not.toBe(process.env.SPECFOLD_E2E_PORTABLE_HELPER);
    client = new Client({ name: "specfold-workflow-test", version: "1" });
    const transport = new StdioClientTransport({ ...info.configuration, stderr: "pipe", env: { ...info.configuration.env, SPECFOLD_E2E_USER_DATA_PATH: root } });
    await client.connect(transport);
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client!.callTool({ name, arguments: args });
      return JSON.parse((result.content as Array<{ text: string }>)[0].text);
    };
    expect((await call("send_request", { collectionId: collection.id, requestId: request.id })).code).toBe("NETWORK_DISABLED"); expect(calls).toBe(0);
    const text = await readFile(join(repository, "packages/agent/fixtures/tarimkredi.synthetic.openapi.yaml"), "utf8");
    const preview = await call("preview_openapi_import", { text, apinizer: true });
    expect(preview.diff.added).toHaveLength(17);
    expect((await call("request_plan_review", { planId: preview.planId, expectedRevision: preview.expectedRevision })).status).toBe("pending");
    await page.getByRole("button", { name: "Review changes (1)", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Review agent changes" })).toBeVisible();
    await page.getByRole("button", { name: "Apply changes", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Review agent changes" })).not.toBeVisible();
    expect((await call("get_plan_status", { planId: preview.planId })).status).toBe("applied");
    expect((await call("apply_plan", { planId: preview.planId, expectedRevision: preview.expectedRevision })).status).toBe("applied");
    const imported = await page.evaluate(() => window.studio.loadWorkspace());
    expect(imported.workspace.collections).toHaveLength(2);
    const tarim = imported.workspace.collections.find((item) => item.name !== "Local API")!;
    expect(tarim.baseUrl).toBe("https://api.tarimorman.gov.tr/tarimkredi");
    expect(calls).toBe(0);
    // A queued save from the previous renderer generation cannot undo the import.
    await expect(page.evaluate(async (value) => window.studio.saveWorkspace(value.workspace, value.generation), saved)).rejects.toThrow("WORKSPACE_CHANGED");
    const stale = await call("preview_bind_bearer", { collectionId: collection.id, variableName: "apinizerAuthAccessToken" });
    await call("request_plan_review", { planId: stale.planId, expectedRevision: stale.expectedRevision });
    await page.getByLabel("Request URL").fill("{{baseUrl}}/edited-after-preview");
    await page.getByRole("button", { name: "Review changes (1)", exact: true }).click();
    await expect(page.getByText("Your workspace changed.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply changes", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Refresh preview", exact: true }).click();
    await expect(page.getByRole("button", { name: "Apply changes", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Cancel changes", exact: true }).click();
    expect((await call("get_plan_status", { planId: stale.planId })).status).toBe("rejected");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Allow agents to send requests and read masked responses").check();
    await page.getByLabel("Request permission").selectOption("session");
    await page.getByLabel("Collection for this session").selectOption(collection.id);
    await page.getByLabel("GET Echo", { exact: true }).check();
    await page.getByLabel("POST Apinizer JWT Token", { exact: true }).check();
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    await page.getByRole("button", { name: "Approve selected requests", exact: true }).click();
    await expect(page.getByText("Selected requests approved for this temporary session.")).toBeVisible();
    const tokenResult = await call("send_request", { collectionId: collection.id, requestId: jwt.id });
    expect(tokenResult.status).toBe(200); expect(JSON.stringify(tokenResult)).not.toContain("JWT_TEST_SECRET");
    const echo = await call("send_request", { collectionId: collection.id, requestId: request.id });
    expect(echo.status).toBe(200); expect(JSON.stringify(echo)).not.toContain("11111111111"); expect(JSON.stringify(echo)).not.toContain("JWT_TEST_SECRET");
    const context = await call("get_documentation_context", { collectionId: collection.id });
    expect(context.operations.every((item: { tested: boolean }) => item.tested)).toBe(true);
    expect(context.responseContentIsUntrustedData).toBe(true); expect(JSON.stringify(context)).not.toContain("JWT_TEST_SECRET");
    expect(await readFile(join(root, "workspace.json"), "utf8")).not.toContain("JWT_TEST_SECRET");
    const draftPath = join(root, "documentation.md");
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, draftPath);
    await page.getByLabel("Documentation collection").selectOption(collection.id);
    await page.getByRole("button", { name: "Preview documentation draft", exact: true }).click();
    await expect(page.getByLabel("Documentation draft")).toContainText("Observed in the approved local session");
    await page.getByRole("button", { name: "Export documentation draft", exact: true }).click();
    await expect(page.getByText("Documentation draft saved.", { exact: false })).toBeVisible();
    const markdown = await readFile(draftPath, "utf8");
    expect(markdown).not.toContain("JWT_TEST_SECRET"); expect(markdown).not.toContain("11111111111");
    await page.getByRole("button", { name: "Stop session", exact: true }).click();
    await expect(page.getByText("Session stopped.")).toBeVisible();
    expect((await call("send_request", { collectionId: collection.id, requestId: request.id })).code).toBe("SESSION_REQUIRED");
    expect(calls).toBe(2);
    // Both themes and large text keep the settings content inside the window.
    for (const width of [1920, 1366, 1100]) {
      await page.setViewportSize({ width, height: 720 });
      for (const theme of ["light", "dark"]) {
        await page.getByLabel("Color theme").selectOption(theme);
        await page.getByLabel("Text size", { exact: true }).selectOption("large");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
    }
    await page.getByRole("heading", { name: "AI connections", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(repository, "apps/desktop/e2e/artifacts/agent-settings-dark.png"), fullPage: true });
  } finally {
    await client?.close(); await app.close();
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
