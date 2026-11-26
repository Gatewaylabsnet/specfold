import { test, expect, _electron } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApinizerJwtRequest, createCollection, createEmptyWorkspace, createKeyValue,
  flattenRequests, importApiDocument, type Workspace } from "../../../../packages/core/src/index";
import type { AgentPreview } from "../../../../packages/agent/src/desktopContracts";

const routes = ["/export-control", "/ec-dgs-list", "/ec-transaction-list"];
const source = (old: boolean) => JSON.stringify({
  openapi: "3.0.3", info: { title: "Synthetic MKK request edits", version: "1" },
  components: { schemas: { Input: { type: "object",
    properties: { id: { type: "integer" }, query: { type: "object" }, ...(old ? { requestHeader: { type: "object" } } : {}) },
    required: old ? ["id", "query", "requestHeader"] : ["id", "query"] } } },
  paths: Object.fromEntries(routes.map((route) => [route, { post: {
    requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Input" },
      example: old ? { id: 1, query: {}, requestHeader: {} } : { id: 1, query: {} } } } },
    responses: { "200": { description: "OK" } }
  } }]))
});

test.use({ trace: "off", screenshot: "off", video: "off" });
test("MCP batches MKK body and actual HTTP header edits with a separate schema preview in one desktop approval", async () => {
  test.setTimeout(90_000);
  const temp = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(temp, "specfold-request-edit-")));
  if (!root.startsWith(join(temp, "specfold-request-edit-"))) throw new Error("Unexpected fixture root");
  const file = join(root, "workspace.json");
  const readWorkspace = async (): Promise<Workspace> => JSON.parse(await readFile(file, "utf8"));
  const workspace = createEmptyWorkspace("Isolated MKK request edits");
  const collection = importApiDocument(source(true), { grouping: "tags" }).collection;
  const selected = flattenRequests(collection).map(({ request }, index) => {
    request.body.raw = JSON.stringify({ id: index + 17, query: { filter: "{{queryScope}}" }, requestHeader: { via: "saved payload" } });
    request.auth = { type: "bearer", token: "{{apinizerAuthAccessToken}}" };
    request.headers.push(createKeyValue("X-Debug", "local"));
    request.queryParams.push(createKeyValue("limit", "3"));
    return request;
  });
  const jwt = createApinizerJwtRequest();
  collection.requests.push(jwt);
  workspace.collections.push(collection, createCollection("Other collection"));
  workspace.environments[0].variables.push(
    { id: "schema-update-synthetic-token", name: "apinizerAuthAccessToken", secret: true, enabled: true, value: "SYNTHETIC_MKK_BODY_TEST" },
    { id: "schema-update-synthetic-query", name: "queryScope", enabled: true, value: "test-scope" }
  );
  await writeFile(file, JSON.stringify(workspace));
  await writeFile(join(root, "app-settings.json"), JSON.stringify({ agentEnabled: true, agentNetworkEnabled: false }));
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
    const connection = await page.evaluate(() => window.studio.getAgentConnection());
    client = new Client({ name: "synthetic-request-edit", version: "1" });
    await client.connect(new StdioClientTransport({ ...connection.configuration, stderr: "pipe" }));
    const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const result = await client!.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      return JSON.parse((result.content as { text: string }[])[0].text);
    };
    const { revision } = await call<{ revision: string }>("list_collections", {});
    const base = { collectionId: collection.id, expectedRevision: revision };
    const remove = { op: "patch-json", patch: [{ op: "remove", path: "/requestHeader" }] };
    const single = await call<AgentPreview>("preview_request_update", { ...base, requestId: selected[0].id, body: remove });
    await call("request_plan_review", { planId: single.planId, expectedRevision: revision });
    await page.getByRole("button", { name: /^Review changes/ }).click();
    await expect(page.getByRole("dialog")).toContainText("/requestHeader");
    await page.getByRole("button", { name: "Cancel changes" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await call("get_plan_status", { planId: single.planId })).toMatchObject({ status: "rejected" });
    expect(await readWorkspace()).toEqual(baseline);

    const plan = await call<AgentPreview>("preview_request_updates", {
      ...base, schemaUpdate: { text: source(false), requestIds: selected.map(({ id }) => id) },
      updates: selected.map((request, index) => ({ requestId: request.id, body: remove, ...(index === 0 ? { headers: [
        { op: "set-value", target: { name: "content-type" }, value: "application/vnd.mkk+json" },
        { op: "set-enabled", target: { id: request.headers.at(-1)!.id }, enabled: false }
      ] } : {}) }))
    });
    expect(plan.networkRequests).toBe(0);
    expect(plan.requestUpdate?.requests).toHaveLength(3);
    expect(plan.schemaUpdate?.changed).toBe(true);
    expect(await readWorkspace()).toEqual(baseline);
    await call("request_plan_review", { planId: plan.planId, expectedRevision: revision });
    await page.getByRole("button", { name: /^Review changes/ }).click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName("Review request and schema updates");
    await expect(page.getByRole("dialog")).toContainText(/Content-Type/i);
    await page.getByRole("button", { name: "Apply request and schema updates" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await call("get_plan_status", { planId: plan.planId })).toMatchObject({ status: "applied" });

    const saved = await readWorkspace();
    const targets = flattenRequests(saved.collections[0]).filter(({ request }) => selected.some(({ id }) => id === request.id));
    for (const { request } of targets) {
      const index = selected.findIndex(({ id }) => id === request.id);
      expect(JSON.parse(request.body.raw!)).toEqual({ id: index + 17, query: { filter: "{{queryScope}}" } });
      expect(request.auth).toEqual(selected[index].auth);
      expect(request.queryParams).toEqual(selected[index].queryParams);
      expect(request.url).toBe(selected[index].url);
      expect(request.method).toBe(selected[index].method);
      expect(request.responseExamples).toEqual(selected[index].responseExamples);
      expect(JSON.stringify(request.openApi?.rawOperation)).not.toContain("requestHeader");
    }
    expect(targets[0].request.headers[0]).toMatchObject({ key: "Content-Type", value: "application/vnd.mkk+json" });
    expect(targets[0].request.headers.at(-1)).toMatchObject({ key: "X-Debug", value: "local", enabled: false });
    expect(saved.environments).toEqual(baseline.environments);
    expect(saved.collections[1]).toEqual(baseline.collections[1]);
    expect(saved.collections[0].requests.find(({ id }) => id === jwt.id)).toEqual(baseline.collections[0].requests.find(({ id }) => id === jwt.id));
    await client.close(); client = undefined;
    await app.close(); app = await launch();
    const reopened = await (await app.firstWindow()).evaluate(() => window.studio.loadWorkspace());
    expect(reopened.workspace.environments[0].variables[0].value).toBe("SYNTHETIC_MKK_BODY_TEST");
    for (const { request } of targets) {
      const loaded = flattenRequests(reopened.workspace.collections[0]).find((item) => item.request.id === request.id)!.request;
      expect(loaded.body).toEqual(request.body);
      expect(loaded.headers).toEqual(request.headers);
    }
  } finally {
    await client?.close().catch(() => undefined);
    await app?.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
