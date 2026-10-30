import { test, expect, _electron, type ElectronApplication } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { copyFile, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createEmptyWorkspace, importApiDocument } from "../../../../packages/core/src/index";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.skip(!process.env.SPECFOLD_E2E_BASELINE_EXECUTABLE || !process.env.SPECFOLD_E2E_EXECUTABLE, "Explicit baseline and candidate executables are required for isolated upgrade/rollback QA.");
test("existing 1.11 data upgrades and pre-update snapshot rolls back without losing encrypted credentials", async () => {
  test.setTimeout(60_000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "specfold-upgrade-candidate-")));
  if (!root.startsWith(join(await realpath(tmpdir()), "specfold-upgrade-candidate-"))) throw new Error("Unexpected fixture root");
  let app: ElectronApplication | undefined;
  const secret = randomBytes(24).toString("hex"), workspace = createEmptyWorkspace("Synthetic preserved workspace");
  const collection = importApiDocument(JSON.stringify({ openapi: "3.0.3", info: { title: "Preserved API", version: "1" },
    paths: { "/read": { get: { responses: { "200": { description: "OK" } } } } } }), { grouping: "tags" }).collection;
  if (collection.openApi) delete collection.openApi.security; // Match pre-feature 1.11 metadata.
  workspace.collections = [collection];
  workspace.connectionProfiles = [{ id: "preserved-setup", name: "Preserved setup", collectionId: collection.id, environmentId: workspace.environments[0].id,
    baseUrl: "http://127.0.0.1:9", provider: "openapi", source: { kind: "existing", label: "Preserved API" }, auth: { kind: "bearer", tokenVariable: "syntheticToken" } }];
  await writeFile(join(root, "workspace.json"), JSON.stringify(workspace));
  async function launch(executable: string) {
    app = await _electron.launch({ executablePath: resolve(executable), args: ["--disable-gpu"], env: { ...process.env, SPECFOLD_E2E_USER_DATA_PATH: root } });
    const page = await app.firstWindow(); await expect(page.locator(".save-status")).toHaveText("Saved"); return page;
  }
  async function stop() { await app!.close(); app = undefined; }
  try {
    let page = await launch(process.env.SPECFOLD_E2E_BASELINE_EXECUTABLE!);
    expect(await page.evaluate(async () => (await window.studio.getAppInfo()).version)).toBe("1.11.0");
    await page.evaluate(async (value) => {
      const loaded = await window.studio.loadWorkspace();
      loaded.workspace.environments[0].variables.push({ id: "synthetic-secret", name: "syntheticToken", value, secret: true, enabled: true });
      await window.studio.saveWorkspace(loaded.workspace, loaded.generation);
      const settings = await window.studio.loadSettings();
      await window.studio.saveSettings({ ...settings, theme: "dark", requestTimeoutMs: 8123, agentEnabled: false, agentNetworkEnabled: false });
    }, secret);
    const before = await page.evaluate(() => window.studio.loadWorkspace());
    expect((await readFile(join(root, "workspace.json"), "utf8")).includes(secret)).toBe(false);
    await stop();
    await copyFile(join(root, "workspace.json"), join(root, "pre-update-workspace.json"));
    await copyFile(join(root, "app-settings.json"), join(root, "pre-update-settings.json"));
    page = await launch(process.env.SPECFOLD_E2E_EXECUTABLE!);
    expect(await page.evaluate(async () => (await window.studio.getAppInfo()).version)).toBe("1.12.0-dev.1");
    const upgraded = await page.evaluate(() => window.studio.loadWorkspace());
    expect(upgraded.recovered).toBe(false); expect(JSON.stringify(upgraded.workspace.collections) === JSON.stringify(before.workspace.collections)).toBe(true);
    expect(upgraded.workspace.environments[0].variables.some((item) => item.name === "syntheticToken" && item.value === secret)).toBe(true);
    expect(await page.evaluate(async () => { const settings = await window.studio.loadSettings(); return settings.theme === "dark" && settings.requestTimeoutMs === 8123 && !settings.agentEnabled && !settings.agentNetworkEnabled; })).toBe(true);
    // New rule metadata is deliberately exercised; old workflow validators cannot interpret it.
    const setup = upgraded.workspace.connectionProfiles![0], requestId = collection.folders.flatMap((folder) => folder.requests)[0]?.id ?? collection.requests[0].id;
    await page.evaluate(async ({ setup, requestId }) => {
      const current = await window.studio.loadWorkspace();
      await window.studio.saveWorkflowProfile({ profile: { ...setup, rules: [{ id: "rule-upgrade", requestId, path: "/count", kind: "exists" }] }, expectedGeneration: current.generation! });
    }, { setup, requestId });
    expect((await page.evaluate(() => window.studio.loadWorkspace())).workspace.connectionProfiles?.[0].rules?.length).toBe(1);
    expect((await readFile(join(root, "workspace.json"), "utf8")).includes(secret)).toBe(false);
    await stop();
    // Rollback is explicit snapshot restoration while both runtimes are closed, not an implicit downgrade.
    await copyFile(join(root, "pre-update-workspace.json"), join(root, "workspace.json"));
    await copyFile(join(root, "pre-update-settings.json"), join(root, "app-settings.json"));
    page = await launch(process.env.SPECFOLD_E2E_BASELINE_EXECUTABLE!);
    const restored = await page.evaluate(() => window.studio.loadWorkspace());
    expect(restored.recovered).toBe(false); expect(JSON.stringify(restored.workspace.collections) === JSON.stringify(before.workspace.collections)).toBe(true);
    expect(restored.workspace.environments[0].variables.some((item) => item.name === "syntheticToken" && item.value === secret)).toBe(true);
    expect(restored.workspace.connectionProfiles?.[0].id).toBe("preserved-setup");
    expect(restored.workspace.connectionProfiles?.[0].rules).toBeUndefined();
    expect(await page.evaluate(async () => { const settings = await window.studio.loadSettings(); return settings.theme === "dark" && settings.requestTimeoutMs === 8123 && !settings.agentEnabled && !settings.agentNetworkEnabled; })).toBe(true);
    await page.evaluate(async () => { const plan = await window.studio.previewWorkflowRun("preserved-setup"); return plan.id; }); // No service is called.
  } finally {
    await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
