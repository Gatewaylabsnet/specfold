import { test, expect, chromium } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

test.skip(process.platform !== "win32", "Windows portable launcher integration");
test("portable desktop configuration uses its extracted runtime for real stdio", async () => {
  test.setTimeout(60_000);
  const repository = fileURLToPath(new URL("../../../../", import.meta.url));
  const root = await realpath(await mkdtemp(join(tmpdir(), "specfold-portable-agent-")));
  const version = JSON.parse(await readFile(join(repository, "package.json"), "utf8")).version;
  const executable = resolve(repository, `apps/desktop/dist/Specfold-${version}-x64-portable.exe`);
  const child = spawn(executable, ["--remote-debugging-port=0", "--disable-gpu"], {
    env: { ...process.env, SPECFOLD_E2E_USER_DATA_PATH: root }, stdio: "ignore", windowsHide: true
  });
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined, client: Client | undefined;
  try {
    let port = "";
    await expect.poll(async () => { try { port = (await readFile(join(root, "DevToolsActivePort"), "utf8")).split("\n")[0]; return !!port; } catch { return false; } }, { timeout: 25_000 }).toBe(true);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts()[0].pages()[0];
    await expect(page.locator(".save-status")).toHaveText("Saved");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Enable AI connections").check();
    await expect.poll(async () => page.evaluate(async () => (await window.studio.loadSettings()).agentEnabled)).toBe(true);
    await page.getByRole("button", { name: "Test connection", exact: true }).click();
    await expect(page.getByText("The bundled agent connected successfully.", { exact: false })).toBeVisible();
    const info = await page.evaluate(() => window.studio.getAgentConnection());
    expect(info.configuration.command).not.toBe(executable);
    expect(info.configuration.command).toMatch(/Specfold\.exe$/);
    client = new Client({ name: "portable-client-test", version: "1" });
    await client.connect(new StdioClientTransport({ ...info.configuration, stderr: "pipe" }));
    const result = await client.callTool({ name: "list_collections", arguments: {} });
    expect(result.isError).not.toBe(true);
  } finally {
    await client?.close(); await browser?.close();
    if (child.pid && child.exitCode === null) await promisify(execFile)("taskkill", ["/pid", String(child.pid), "/t", "/f"]).catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
