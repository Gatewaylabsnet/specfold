import { test, expect, _electron } from "@playwright/test";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const electronExecutable: string = createRequire(import.meta.url)("electron");
const command = promisify(execFile);
test("actual desktop blocks agent writes and approves/redacts a separate local network request", async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(join(tmpdir(), "specfold-desktop-agent-"));
  let calls = 0, authorization = "";
  const server = createServer((request, response) => {
    calls++; authorization = request.headers.authorization ?? "";
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ tckn: "11111111111", access_token: "LOCAL_TEST_SECRET", echo: "LOCAL_TEST_SECRET" }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local test server");
  const workspace = { id: "workspace-test", schemaVersion: 1, name: "Agent E2E", updatedAt: new Date().toISOString(),
    activeEnvironmentId: "env-test", environments: [{ id: "env-test", name: "Specfold", variables: [
      { id: "var-test", name: "accessToken", value: "", enabled: true, secret: true }
    ] }], collections: [{ id: "col-test", name: "Local API", baseUrl: `http://127.0.0.1:${address.port}`, folders: [], requests: [{
      id: "req-test", name: "Echo", method: "GET", url: "{{baseUrl}}/echo", queryParams: [], pathParams: [], headers: [],
      body: { mode: "none" }, auth: { type: "bearer", token: "{{accessToken}}" }, responseExamples: []
    }] }] };
  await writeFile(join(root, "workspace.json"), JSON.stringify(workspace));
  const childEnv = { ...process.env };
  delete childEnv.FORCE_COLOR;
  delete childEnv.NO_COLOR;
  const run = async (...args: string[]) => {
    try { return await command(process.execPath, [join(repository, "packages/agent/dist/index.js"), ...args, "--data-dir", root], { env: childEnv }); }
    catch (error) { const value = error as { stdout: string; stderr: string }; return { stdout: value.stdout, stderr: value.stderr }; }
  };
  const app = await _electron.launch({ executablePath: electronExecutable, args: [resolve(repository, "apps/desktop/out/main/index.js")],
    env: { ...process.env, SPECFOLD_E2E_USER_DATA_PATH: root } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByLabel("Request URL")).toBeVisible();
    await expect.poll(async () => Boolean(await readFile(join(root, ".specfold-writer.lock"), "utf8"))).toBe(true);
    await expect.poll(async () => JSON.parse(await readFile(join(root, "workspace.json"), "utf8")).updatedAt).not.toBe(workspace.updatedAt);
    await expect(page.locator(".save-status")).toHaveText("Saved");
    // Owner-process IPC saves encrypt the secret through the real OS safeStorage.
    workspace.environments[0].variables[0].value = "LOCAL_TEST_SECRET";
    await page.evaluate(async (value) => { await window.studio.saveWorkspace(value as never); }, workspace);
    const atRest = await readFile(join(root, "workspace.json"), "utf8");
    expect(atRest).not.toContain("LOCAL_TEST_SECRET");
    expect(atRest).toContain("enc:v1:");
    const listed = JSON.parse((await run("list")).stdout);
    expect(listed.collections[0].name).toBe("Local API");
    const preview = JSON.parse((await run("preview", "--file", join(repository, "packages/agent/fixtures/tarimkredi.synthetic.openapi.yaml"), "--apinizer")).stdout);
    const apply = await run("apply", "--allow-apply", "--plan", preview.planId, "--revision", preview.expectedRevision);
    expect(JSON.parse(apply.stderr).code).toBe("WORKSPACE_BUSY");
    expect(await readFile(join(root, "workspace.json"), "utf8")).toBe(atRest);
    const denied = await run("send", "--allow-network", "--collection", "col-test", "--request", "req-test");
    expect(JSON.parse(denied.stderr).code).toBe("NETWORK_DISABLED"); expect(calls).toBe(0);
    await page.evaluate(async () => {
      const settings = await window.studio.loadSettings();
      await window.studio.saveSettings({ ...settings, agentNetworkEnabled: true });
    });
    // Test only: simulate native user choices, not an MCP approval parameter.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    const cancel = await run("send", "--allow-network", "--collection", "col-test", "--request", "req-test");
    expect(JSON.parse(cancel.stderr).code).toBe("NETWORK_APPROVAL_DENIED"); expect(calls).toBe(0);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    const allowed = await run("send", "--allow-network", "--collection", "col-test", "--request", "req-test");
    expect(allowed.stderr).toBe("");
    expect(JSON.parse(allowed.stdout).status).toBe(200);
    expect(calls).toBe(1); expect(authorization).toBe("Bearer LOCAL_TEST_SECRET");
    expect(allowed.stdout).not.toContain("LOCAL_TEST_SECRET"); expect(allowed.stdout).not.toContain("11111111111");
  } finally {
    await app.close();
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
