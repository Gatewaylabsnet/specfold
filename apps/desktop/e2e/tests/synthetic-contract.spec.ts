import { test, expect, _electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEmptyWorkspace, importApiDocument } from "../../../../packages/core/src/index";

test.use({ trace: "off", screenshot: "off", video: "off" });
test("synthetic bodies require explicit apply and contract differences preview without modifying saved requests", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "specfold-synthetic-contract-")));
  if (!root.startsWith(join(await realpath(tmpdir()), "specfold-synthetic-contract-"))) throw new Error("Unexpected fixture root");
  const schema = { type: "object", properties: { count: { type: "integer", minimum: 1, maximum: 10 } }, required: ["count"] };
  const source = { openapi: "3.0.3", info: { title: "Synthetic contract API", version: "1" }, servers: [{ url: "http://127.0.0.1:9" }],
    paths: { "/items": { post: { summary: "Create synthetic item", requestBody: { required: true, content: { "application/json": { schema } } }, responses: { "200": { description: "OK" } } } } } };
  const workspace = createEmptyWorkspace(), collection = importApiDocument(JSON.stringify(source), { grouping: "tags" }).collection;
  workspace.collections = [collection]; await writeFile(join(root, "workspace.json"), JSON.stringify(workspace));
  const executable = process.env.SPECFOLD_E2E_EXECUTABLE, repository = fileURLToPath(new URL("../../../../", import.meta.url));
  const app = await _electron.launch({ executablePath: executable ? resolve(executable) : createRequire(import.meta.url)("electron"),
    args: executable ? ["--disable-gpu"] : [resolve(repository, "apps/desktop/out/main/index.js"), "--disable-gpu"], env: { ...process.env, SPECFOLD_E2E_USER_DATA_PATH: root } });
  try {
    const page = await app.firstWindow(); await expect(page.locator(".save-status")).toHaveText("Saved");
    await page.getByText("Create synthetic item", { exact: true }).first().click();
    await page.getByRole("button", { name: "Body", exact: true }).click();
    const before = await page.getByLabel("Request body", { exact: true }).inputValue();
    await page.getByText("Synthetic JSON test data", { exact: true }).click();
    await page.getByRole("button", { name: "Generate synthetic draft" }).click();
    await expect(page.getByLabel("Synthetic JSON draft")).toContainText("count");
    await expect(page.getByRole("button", { name: "Apply reviewed synthetic body" })).toBeDisabled();
    expect(await page.getByLabel("Request body", { exact: true }).inputValue()).toBe(before);
    await page.getByRole("button", { name: "Discard synthetic draft" }).click();
    expect(await page.getByLabel("Request body", { exact: true }).inputValue()).toBe(before);
    await page.getByRole("button", { name: "Generate synthetic draft" }).click();
    await page.getByRole("checkbox", { name: "I reviewed the generated body and approve replacing this request body." }).check();
    await page.getByRole("button", { name: "Apply reviewed synthetic body" }).click();
    expect(JSON.parse(await page.getByLabel("Request body", { exact: true }).inputValue()).count).toBeGreaterThanOrEqual(1);
    await expect(page.locator(".save-status")).toHaveText("Saved");
    const saved = await page.evaluate(() => window.studio.loadWorkspace());
    const changed = structuredClone(source); changed.paths["/items"].post.requestBody.content["application/json"].schema.required.push("category");
    Object.assign(changed.paths["/items"].post.requestBody.content["application/json"].schema.properties, { category: { type: "string" } });
    await page.getByLabel("Import", { exact: true }).click();
    await page.locator(".source-textarea").fill(JSON.stringify(changed));
    await page.getByRole("combobox", { name: /^Import destination/ }).selectOption(collection.id);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page.getByText(/Contract changes:/).click();
    await expect(page.getByText("Required object properties were added.", { exact: false })).toBeVisible();
    const unchanged = await page.evaluate(() => window.studio.loadWorkspace());
    expect(JSON.stringify(unchanged.workspace.collections) === JSON.stringify(saved.workspace.collections)).toBe(true);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
