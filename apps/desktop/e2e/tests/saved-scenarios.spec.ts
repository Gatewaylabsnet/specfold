import { test, expect, _electron, type ElectronApplication } from "@playwright/test";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEmptyWorkspace, importApiDocument } from "../../../../packages/core/src/index";

test.use({ trace: "off", screenshot: "off", video: "off" });
test("saved scenarios survive restart, require fresh consent and compare content-free summaries", async () => {
  test.setTimeout(60_000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "specfold-scenario-e2e-")));
  if (!root.startsWith(join(await realpath(tmpdir()), "specfold-scenario-e2e-"))) throw new Error("Unexpected fixture root");
  const privateValue = randomBytes(24).toString("hex"); let calls = 0;
  const server = createServer((_request, response) => {
    calls++; response.statusCode = calls === 1 ? 200 : 500;
    response.setHeader("content-type", "application/json"); response.setHeader("x-private-value", privateValue);
    response.end(JSON.stringify({ id: 1, customer: "synthetic-person@example.invalid", privateData: privateValue }));
  });
  let app: ElectronApplication | undefined;
  try {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing fixture port");
  const origin = `http://127.0.0.1:${address.port}`;
  const workspace = createEmptyWorkspace();
  const responseSchema = { description: "OK", content: { "application/json": { schema: { type: "object", properties: { id: { type: "integer" } } } } } };
  const collection = importApiDocument(JSON.stringify({ openapi: "3.0.3", info: { title: "Synthetic scenarios", version: "1" }, servers: [{ url: origin }],
    paths: { "/read": { get: { summary: "Read synthetic order", responses: { "200": responseSchema } } } } }), { grouping: "tags" }).collection;
  workspace.collections = [collection];
  workspace.connectionProfiles = [{ id: "scenario-setup", name: "Synthetic setup", provider: "openapi", collectionId: collection.id,
    environmentId: workspace.environments[0].id, baseUrl: origin, source: { kind: "existing", label: "Synthetic API" }, auth: { kind: "none" } }];
  await writeFile(join(root, "workspace.json"), JSON.stringify(workspace));
  const repository = fileURLToPath(new URL("../../../../", import.meta.url));
  async function launch() {
    console.info("Scenario fixture: launching isolated desktop");
    const executable = process.env.SPECFOLD_E2E_EXECUTABLE;
    app = await _electron.launch({ executablePath: executable ? resolve(executable) : createRequire(import.meta.url)("electron"),
      args: executable ? ["--disable-gpu"] : [resolve(repository, "apps/desktop/out/main/index.js"), "--disable-gpu"],
      env: { ...process.env, SPECFOLD_E2E_USER_DATA_PATH: root } });
    console.info("Scenario fixture: installing synthetic consent handler");
    await app.evaluate(({ dialog }) => {
      const state = globalThis as unknown as { scenarioConsents: number }; state.scenarioConsents = 0;
      dialog.showMessageBox = (async (_parent: unknown, options: { title?: string; defaultId?: number; cancelId?: number }) => {
        if (options.title === "Approve workflow run") {
          if (options.defaultId !== 1 || options.cancelId !== 1) throw new Error("Unsafe consent default");
          state.scenarioConsents++;
        }
        return { response: 0, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    });
    const page = await app.firstWindow(); await expect(page.locator(".save-status")).toHaveText("Saved"); console.info("Scenario fixture: desktop ready"); return page;
  }
  async function library() {
    const content = await readFile(join(root, "workflow-library.json"), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return '{"scenarios":[],"runs":[]}';
      throw error;
    });
    return JSON.parse(content);
  }
    let page = await launch();
    await page.getByRole("button", { name: "Test workflow", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByText("No-code response rules (0)", { exact: true }).click();
    await page.getByLabel("Rule JSON pointer").fill("/id");
    await page.getByLabel("Rule check", { exact: true }).selectOption("range");
    await page.getByLabel("Rule minimum").fill("0"); await page.getByLabel("Rule maximum").fill("10");
    await page.getByRole("checkbox", { name: "I reviewed this non-secret rule definition and approve saving it with this setup." }).check();
    await page.getByRole("button", { name: "Add reviewed rule" }).click();
    expect(calls).toBe(0);
    await page.getByRole("button", { name: "Save & preview", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Test preview", exact: true })).toBeVisible();
    await page.getByText("Saved scenarios & safe history", { exact: true }).click();
    await page.getByRole("button", { name: "Save selected scenario" }).click();
    await expect.poll(async () => (await library()).scenarios.length).toBe(1);
    console.info("Scenario fixture: selection saved");
    expect(calls).toBe(0); expect((await library()).runs).toEqual([]);
    await page.getByRole("button", { name: "Run selected tests", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Results", exact: true })).toBeVisible();
    expect((await library()).runs).toEqual([]);
    await page.getByRole("button", { name: "Save safe summary" }).click();
    await expect.poll(async () => (await library()).runs.length).toBe(1);
    expect((await library()).runs[0].results[0].assertions.some((assertion: { name: string; outcome: string }) => assertion.name === "rule" && assertion.outcome === "passed")).toBe(true);
    console.info("Scenario fixture: first summary saved");
    expect(calls).toBe(1);
    expect(await app!.evaluate(() => (globalThis as unknown as { scenarioConsents: number }).scenarioConsents)).toBe(1);
    await app!.close(); app = undefined;
    console.info("Scenario fixture: first desktop stopped");
    page = await launch();
    await page.getByRole("button", { name: "Test workflow", exact: true }).click();
    await page.getByText("Saved scenarios & safe history", { exact: true }).click();
    await page.getByRole("button", { name: "Preview scenario 1", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Test preview", exact: true })).toBeVisible();
    expect(calls).toBe(1); // Opening persisted data never runs or reuses approval.
    await page.getByRole("button", { name: "Run selected tests", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Results", exact: true })).toBeVisible();
    expect(await app!.evaluate(() => (globalThis as unknown as { scenarioConsents: number }).scenarioConsents)).toBe(1);
    await page.getByRole("button", { name: "Save safe summary" }).click();
    await expect.poll(async () => (await library()).runs.length).toBe(2);
    console.info("Scenario fixture: second summary saved");
    const before = (await library()).runs[0].id;
    await page.getByLabel("History baseline").selectOption(before);
    await expect(page.getByRole("table", { name: "Saved result comparison" })).toContainText("passed → failed");
    const bytes = await readFile(join(root, "workflow-library.json"), "utf8");
    for (const forbidden of [privateValue, "synthetic-person@", origin, "Read synthetic order", "privateData", "response", "headers", "planId", '"path"', '"minimum"', '"maximum"']) expect(bytes.includes(forbidden)).toBe(false);
    expect(calls).toBe(2);
    await page.getByRole("button", { name: "Clear testing library on this device" }).click();
    await expect.poll(() => readFile(join(root, "workflow-library.json"), "utf8").then(() => false).catch(() => true)).toBe(true);
  } finally {
    await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
