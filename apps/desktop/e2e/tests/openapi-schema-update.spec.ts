import { test, expect, _electron } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createApinizerJwtRequest, createCollection, createEmptyWorkspace, createId, exportCollectionToOpenApiDocument,
  flattenRequests, importApiDocument, type Workspace
} from "../../../../packages/core/src/index";
import type { AgentPreview } from "../../../../packages/agent/src/desktopContracts";

const paths = ["/export-control", "/ec-dgs-list", "/ec-transaction-list"];
const source = (old: boolean, exampleId = 2, version = "1") => JSON.stringify({
  openapi: "3.0.3", info: { title: "Synthetic MKK", version }, servers: [{ url: "http://127.0.0.1:9/api" }],
  components: {
    schemas: {
      Payload: {
        type: "object",
        properties: { id: { type: "integer" }, ...(old ? { requestHeader: { type: "object" } } : {}) },
        required: old ? ["id", "requestHeader"] : ["id"],
        additionalProperties: false
      }
    },
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } }
  },
  paths: Object.fromEntries(paths.map((path) => [path, { post: {
    summary: path.slice(1), security: [{ bearer: [] }],
    requestBody: { required: true, content: { "application/json": {
      schema: { $ref: "#/components/schemas/Payload" }, example: old ? { id: 1, requestHeader: {} } : { id: exampleId }
    } } },
    responses: { 200: { description: "OK" } }
  } }]))
});
const stripContract = (workspace: Workspace): Workspace => {
  const result = structuredClone(workspace);
  result.updatedAt = "";
  const target = result.collections[0];
  delete target.openApi;
  for (const { request } of flattenRequests(target)) {
    delete request.openApi; delete request.body.schema; delete request.body.required;
  }
  return result;
};

test.use({ trace: "off", screenshot: "off", video: "off" });
test("desktop and MCP update the synthetic MKK contract without rewriting saved execution data", async () => {
  test.setTimeout(90_000);
  const temp = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(temp, "specfold-schema-update-")));
  if (!root.startsWith(join(temp, "specfold-schema-update-"))) throw new Error("Unexpected fixture root");
  const file = join(root, "workspace.json");
  const readWorkspace = async (): Promise<Workspace> => JSON.parse(await readFile(file, "utf8"));
  const workspace = createEmptyWorkspace("Isolated schema update");
  const target = importApiDocument(source(true), { grouping: "tags" }).collection;
  const requestIds = flattenRequests(target).map(({ request }) => {
    request.body.raw = JSON.stringify({ id: 35, requestHeader: { source: "user edit" } });
    request.auth = { type: "bearer", token: "{{apinizerAuthAccessToken}}" };
    request.responseExamples = [{ id: createId("example"), name: "User response", status: 202,
      headers: [], body: '{"ownValue":true}', contentType: "application/json" }];
    return request.id;
  });
  target.requests.push(createApinizerJwtRequest());
  workspace.collections.push(target, createCollection("Unrelated collection"));
  workspace.environments[0].variables.push({
    id: createId("var"), name: "apinizerAuthAccessToken", enabled: true, secret: true, value: "SYNTHETIC_SCHEMA_TOKEN"
  });
  await writeFile(file, JSON.stringify(workspace));
  const repository = fileURLToPath(new URL("../../../../", import.meta.url));
  const executable = process.env.SPECFOLD_E2E_EXECUTABLE;
  const launch = () => _electron.launch({
    executablePath: executable ? resolve(executable) : createRequire(import.meta.url)("electron"),
    args: executable ? ["--disable-gpu"] : [resolve(repository, "apps/desktop/out/main/index.js"), "--disable-gpu"],
    env: { ...process.env, SPECFOLD_E2E_USER_DATA_PATH: root }
  });
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  let client: Client | undefined;
  try {
    app = await launch();
    const page = await app.firstWindow();
    await expect.poll(async () => (await readWorkspace()).environments[0].variables[0].value).toMatch(/^enc:v1:/);
    await expect(page.locator(".save-status")).toHaveText("Saved");
    const baseline = await readWorkspace();
    expect(baseline.environments[0].variables[0].value).toMatch(/^enc:v1:/);
    // Import UI preview works without turning on AI connections; rejecting it is inert.
    await page.getByLabel("Import", { exact: true }).click();
    await page.getByRole("button", { name: "Update schemas and keep request data" }).click();
    await page.getByLabel("Updated OpenAPI document").fill(source(false));
    await page.getByLabel("Existing OpenAPI collection").selectOption(target.id);
    for (const path of paths) await page.getByRole("checkbox", { name: new RegExp(path + "$") }).check();
    await page.getByRole("button", { name: "Preview schema update" }).click();
    await expect(page.getByRole("dialog")).toContainText("requestHeader");
    await page.getByRole("button", { name: "Cancel changes" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await readWorkspace()).toEqual(baseline);

    await page.evaluate(async () => { await window.studio.saveSettings({ ...await window.studio.loadSettings(), agentEnabled: true }); });
    const connection = await page.evaluate(() => window.studio.getAgentConnection());
    client = new Client({ name: "schema-update-fixture", version: "1" });
    await client.connect(new StdioClientTransport({ ...connection.configuration, stderr: "pipe" }));
    const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const result = await client!.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      return JSON.parse((result.content as { text: string }[])[0].text);
    };
    const { revision } = await call<{ revision: string }>("list_collections", {});
    const args = { targetCollectionId: target.id, text: source(false), requestIds: requestIds.slice(0, 1), expectedRevision: revision };
    const proposal = await call<AgentPreview>("preview_openapi_schema_update", args);
    expect(proposal.networkRequests).toBe(0);
    expect(proposal.schemaUpdate?.affectedRequestIds.slice().sort()).toEqual(requestIds.slice(1).sort());
    await call("request_plan_review", { planId: proposal.planId, expectedRevision: revision });
    // Use the trusted review handler, then apply exactly the affected IDs via the
    // same IPC that the native review dialog calls after acknowledgement.
    const diff = await page.evaluate((id) => window.studio.reviewAgentPlan(id), proposal.planId);
    const rejected = await page.evaluate(async ({ planId, expectedRevision }) => {
      try { await window.studio.applyAgentPlan(planId, expectedRevision); return ""; }
      catch (error) { return String(error); }
    }, diff);
    expect(rejected).not.toBe("");
    expect(await readWorkspace()).toEqual(baseline);
    // Refresh all three operation examples as well as their shared schema.
    const allArgs = { ...args, text: source(false, 2, "2"), requestIds };
    const all = await call<AgentPreview>("preview_openapi_schema_update", allArgs);
    await call("request_plan_review", { planId: all.planId, expectedRevision: revision });
    await page.evaluate(async ({ planId, expectedRevision }) => { await window.studio.applyAgentPlan(planId, expectedRevision); }, all);
    const saved = await readWorkspace();
    expect(stripContract(saved)).toEqual(stripContract(baseline));
    const exported = exportCollectionToOpenApiDocument(saved.collections[0], {
      format: "json", useFolderNamesAsTags: true, includeRequestExamples: true, includeResponseExamples: false,
      includeBearerJwtSecurityScheme: true, includeAllComponents: false, preferSourceOperation: true
    });
    for (const path of paths) expect(JSON.stringify((exported.paths as Record<string, unknown>)[path])).not.toContain("requestHeader");
    expect(JSON.stringify(exported.components)).toContain('"required":["id"]');
    expect(JSON.stringify(exported.paths)).toContain('"example":{"id":2}');
    expect(JSON.stringify(exported.paths)).not.toContain("user edit");

    const latest = await call<{ revision: string }>("list_collections", {});
    const repeated = await call<AgentPreview>("preview_openapi_schema_update", { ...allArgs, expectedRevision: latest.revision });
    expect(repeated.schemaUpdate?.changed).toBe(false);
    await client.close(); client = undefined;
    await app.close(); app = await launch();
    const reopened = await (await app.firstWindow()).evaluate(() => window.studio.loadWorkspace());
    for (const { request } of flattenRequests(reopened.workspace.collections[0]).filter(({ request }) => requestIds.includes(request.id))) {
      expect(request.body.raw).toContain("user edit");
      expect(JSON.stringify(request.openApi?.rawOperation)).not.toContain("requestHeader");
    }
    expect(reopened.workspace.environments[0].variables[0].value).toBe("SYNTHETIC_SCHEMA_TOKEN");

    // A new source example can also be approved directly in the Import UI,
    // without changing the runtime body or requiring AI connections.
    const reopenedPage = await app.firstWindow();
    // Normal startup autosave may re-encrypt unchanged secrets (new nonces).
    // Compare the schema transaction to the exact on-disk snapshot it reviewed.
    await expect.poll(async () => (await readWorkspace()).updatedAt).not.toBe(saved.updatedAt);
    await expect(reopenedPage.locator(".save-status")).toHaveText("Saved");
    const reopenedBaseline = await readWorkspace();
    await reopenedPage.evaluate(async () => { await window.studio.saveSettings({ ...await window.studio.loadSettings(), agentEnabled: false }); });
    await reopenedPage.getByLabel("Import", { exact: true }).click();
    await reopenedPage.getByRole("button", { name: "Update schemas and keep request data" }).click();
    await reopenedPage.getByLabel("Updated OpenAPI document").fill(source(false, 3, "2"));
    await reopenedPage.getByLabel("Existing OpenAPI collection").selectOption(target.id);
    await reopenedPage.getByRole("checkbox", { name: new RegExp(paths[0] + "$") }).check();
    await reopenedPage.getByRole("button", { name: "Preview schema update" }).click();
    await reopenedPage.getByRole("button", { name: "Apply schema update" }).click();
    await expect(reopenedPage.getByRole("dialog")).toHaveCount(0);
    const final = await readWorkspace();
    expect(JSON.stringify(flattenRequests(final.collections[0]).find(({ request }) => request.id === requestIds[0])?.request.openApi?.rawOperation))
      .toContain('"example":{"id":3}');
    expect(stripContract(final)).toEqual(stripContract(reopenedBaseline));
  } finally {
    await client?.close().catch(() => undefined);
    await app?.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
