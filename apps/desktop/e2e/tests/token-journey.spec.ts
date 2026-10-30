import { test, expect, _electron } from "@playwright/test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCollection, createEmptyWorkspace, createFolder, createRequest } from "../../../../packages/core/src/index";

// Synthetic credentials still must not end up in trace/video/screenshot artifacts.
test.use({ trace: "off", video: "off", screenshot: "off" });
test("token selection reviews exact scope, keeps credentials private and starts tests from the selected context", async () => {
  test.setTimeout(60_000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "specfold-token-journey-")));
  if (!root.startsWith(join(await realpath(tmpdir()), "specfold-token-journey-"))) throw new Error("Unexpected fixture root");
  const token = randomBytes(24).toString("hex");
  let issuerCalls = 0, serviceCalls = 0;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/auth/jwt") { issuerCalls++; response.end(JSON.stringify({ access_token: token })); }
    else { serviceCalls++; response.end(JSON.stringify({ ok: true })); }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No fixture port");
  const workspace = createEmptyWorkspace("Synthetic token journey"), first = createCollection("Other API"), selected = createCollection("Selected API");
  selected.baseUrl = `http://127.0.0.1:${address.port}`;
  const issuer = createRequest({ name: "Issuer", method: "POST", url: "{{baseUrl}}/auth/jwt" });
  const folder = createFolder("Orders"), request = createRequest({ name: "List orders", method: "GET", url: "{{baseUrl}}/orders" });
  folder.requests = [request]; selected.requests = [issuer]; selected.folders = [folder]; workspace.collections = [first, selected];
  workspace.environments[0].name = "Synthetic staging";
  await writeFile(join(root, "workspace.json"), JSON.stringify(workspace));
  const repository = fileURLToPath(new URL("../../../../", import.meta.url));
  const executable = process.env.SPECFOLD_E2E_EXECUTABLE;
  const app = await _electron.launch({ executablePath: executable ? resolve(executable) : createRequire(import.meta.url)("electron"),
    args: executable ? ["--disable-gpu"] : [resolve(repository, "apps/desktop/out/main/index.js"), "--disable-gpu"],
    env: { ...process.env, SPECFOLD_E2E_USER_DATA_PATH: root } });
  try {
    const page = await app.firstWindow();
    await expect(page.locator(".save-status")).toHaveText("Saved");
    // The first collection is intentionally different: select the intended API.
    await page.getByText("Selected API", { exact: true }).first().click();
    await page.getByText("Issuer", { exact: true }).first().click();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Use this token", exact: true })).toBeVisible();
    expect(issuerCalls).toBe(1); expect(serviceCalls).toBe(0);
    expect((await page.locator("body").innerText()).includes(token)).toBe(false);
    await page.getByLabel("Token scope").selectOption(folder.id);
    await page.getByRole("button", { name: "Review token use", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "Confirm token use" });
    await expect(confirm).toContainText("List orders");
    expect((await confirm.innerText()).includes(token)).toBe(false);
    await confirm.getByRole("button", { name: "Cancel token use" }).click();
    expect((await page.evaluate(() => window.studio.loadWorkspace())).workspace.collections[1].folders[0].requests[0].auth.type).toBe("none");
    await page.getByRole("button", { name: "Review token use", exact: true }).click();
    await confirm.getByRole("button", { name: "Save token and bind 1 requests" }).click();
    await expect.poll(async () => (await page.evaluate(() => window.studio.loadWorkspace())).workspace.collections[1].folders[0].requests[0].auth.type).toBe("bearer");
    await expect(page.locator(".save-status")).toHaveText("Saved");
    const saved = await page.evaluate(() => window.studio.loadWorkspace());
    const auth = saved.workspace.collections[1].folders[0].requests[0].auth;
    expect(auth.type).toBe("bearer");
    expect((await readFile(join(root, "workspace.json"), "utf8")).includes(token)).toBe(false);
    expect(serviceCalls).toBe(0);
    await page.getByRole("button", { name: "Test workflow", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Existing collection", exact: true })).toHaveValue(selected.id);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Authentication", exact: true })).toHaveValue("bearer");
    expect(await page.getByLabel("Bearer token", { exact: true }).inputValue()).toBe("");
    await page.getByRole("button", { name: "Save & preview", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Test preview", exact: true })).toBeVisible();
    expect(serviceCalls).toBe(0); // Configuring/previewing never executes the service.
    await page.getByRole("button", { name: "Back to editor", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Enable AI connections").click();
    await expect.poll(() => page.evaluate(async () => (await window.studio.loadSettings()).agentEnabled)).toBe(true);
    await page.getByRole("button", { name: "Test bundled helper", exact: true }).click();
    await expect(page.getByText("Bundled helper self-test passed.", { exact: false })).toBeVisible();
    await expect(page.getByText(/External client: not verified by this self-test/)).toBeVisible();
    expect(serviceCalls).toBe(0);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
