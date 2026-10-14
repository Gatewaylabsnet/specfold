import { test, expect, _electron, type ElectronApplication } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, type RequestListener, type Server } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCollection, createEmptyWorkspace, createRequest,
  type ConnectionProfile, type WorkflowRunReport, type WorkflowTestPlan, type Workspace
} from "../../../../packages/core/src/index";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const credentials = {
  username: "SYNTHETIC_WORKFLOW_USER_29", password: "SYNTHETIC_WORKFLOW_PASSWORD_29",
  clientId: "SYNTHETIC_WORKFLOW_CLIENT_29", token: "SYNTHETIC_WORKFLOW_ISSUER_TOKEN_29"
};
interface Consent { title?: string; message: string; detail?: string; defaultId?: number; cancelId?: number }
interface ConsentState { workflowConsent: Consent[] }

async function fixtureRoot() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "specfold-guided-e2e-")));
  if (!root.startsWith(join(await realpath(tmpdir()), "specfold-guided-e2e-"))) throw new Error("Unexpected fixture root");
  return root;
}

async function loopback(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); done(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No loopback address");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function launchStudio(root: string) {
  const executable = process.env.SPECFOLD_E2E_EXECUTABLE;
  return _electron.launch({ executablePath: executable ? resolve(executable) : createRequire(import.meta.url)("electron"),
    args: executable ? ["--disable-gpu"] : [resolve(repository, "apps/desktop/out/main/index.js")],
    env: { ...process.env, SPECFOLD_E2E_USER_DATA_PATH: root,
      ...(process.env.SPECFOLD_E2E_PORTABLE_HELPER ? { PORTABLE_EXECUTABLE_FILE: process.env.SPECFOLD_E2E_PORTABLE_HELPER } : {}) } });
}

async function interceptConsent(app: ElectronApplication) {
  await app.evaluate(({ dialog }) => {
    const state = globalThis as unknown as ConsentState;
    state.workflowConsent = [];
    dialog.showMessageBox = ((_parent: unknown, options: Consent) => {
      state.workflowConsent.push({ title: options.title, message: options.message, detail: options.detail,
        defaultId: options.defaultId, cancelId: options.cancelId });
      return Promise.resolve({ response: 0, checkboxChecked: false });
    }) as typeof dialog.showMessageBox;
  });
}

async function dispose(root: string, server: Server, app?: ElectronApplication) {
  try {
    // Fixture teardown must bypass the wizard's intentional unsaved-exit prompt;
    // otherwise a cleanup dialog error can hide the original test failure.
    await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await app?.close().catch(() => undefined);
  }
  finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    // root is the canonical, uniquely-created fixture directory checked before launch.
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

function specification(origin: string) {
  const response = { description: "Synthetic response", content: { "application/json": {
    schema: { type: "object", required: ["id"], properties: { id: { type: "integer" } } }
  } } };
  const postSchema = { type: "object", required: ["label"], properties: { label: { type: "string" } } };
  return JSON.stringify({ openapi: "3.0.3", info: { title: "Guided synthetic API", version: "1" }, servers: [{ url: origin }], paths: {
    "/ok": { get: { summary: "Read OK", responses: { "200": response } } },
    "/wrong-schema": { get: { summary: "Wrong schema", responses: { "200": response } } },
    "/wrong-status": { get: { summary: "Wrong status", responses: { "200": response } } },
    "/missing-example": { post: { summary: "Missing example", requestBody: { required: true,
      content: { "application/json": { schema: postSchema } } }, responses: { "200": response } } },
    "/write": { post: { summary: "Risky write", requestBody: { required: true,
      content: { "application/json": { schema: postSchema, example: { label: "explicit fixture" } } } }, responses: { "200": response } } }
  } });
}

test("guided UI imports safely, obtains an issuer token, checks responses and exports a masked report", async () => {
  test.setTimeout(120_000);
  const root = await fixtureRoot();
  const received: Array<{ method?: string; url?: string; authorization?: string; body: string }> = [];
  const { server, origin } = await loopback((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      received.push({ method: request.method, url: request.url, authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8") });
      response.setHeader("content-type", "application/json");
      if (request.url === "/issuer/token") { response.end(JSON.stringify({ access_token: credentials.token })); return; }
      response.statusCode = request.url === "/wrong-status" ? 503 : 200;
      response.setHeader("x-reflected-credential", credentials.token);
      response.end(JSON.stringify({ id: request.url === "/wrong-schema" ? "invalid integer" : 7,
        echoes: Object.values(credentials), visible: "synthetic response remains visible" }));
    });
  });
  let app: ElectronApplication | undefined;
  try {
    const workspace = createEmptyWorkspace("Preserved workspace");
    const existing = createCollection("Existing collection to preserve"); existing.baseUrl = origin;
    existing.requests.push(createRequest({ name: "Existing saved request", method: "GET", url: "{{baseUrl}}/preserved" }));
    workspace.collections.push(existing);
    const sourcePath = join(root, "workflow.openapi.json"), exportPath = join(root, "workflow-report.json");
    await writeFile(join(root, "workspace.json"), JSON.stringify(workspace));
    await writeFile(sourcePath, specification(origin));
    app = await launchStudio(root);
    const page = await app.firstWindow();
    await expect(page.locator(".save-status")).toHaveText("Saved");
    const preservedCollection = JSON.parse(JSON.stringify((await page.evaluate(() => window.studio.loadWorkspace()))
      .workspace.collections.find((item) => item.id === existing.id)));
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
    }, sourcePath);
    await interceptConsent(app);
    await page.getByRole("button", { name: "Test workflow", exact: true }).click();
    await page.getByLabel("Profile name", { exact: true }).fill("Synthetic guided profile");
    await page.getByLabel("Base URL", { exact: true }).fill(origin);
    await page.getByLabel("Provider", { exact: true }).selectOption("apinizer");
    await page.getByLabel("OpenAPI file", { exact: true }).check();
    await page.getByRole("button", { name: "Choose OpenAPI file", exact: true }).click();
    await expect(page.getByText("Loaded: workflow.openapi.json", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("combobox", { name: "Authentication", exact: true }).selectOption("apinizer");
    await page.getByLabel("Token endpoint", { exact: true }).fill(`${origin}/issuer/token`);
    for (const [label, value] of [["Username", credentials.username], ["Password", credentials.password], ["Client ID", credentials.clientId]]) {
      await expect(page.getByLabel(label, { exact: true })).toHaveAttribute("type", "password");
      await page.getByLabel(label, { exact: true }).fill(value);
    }
    await page.getByRole("button", { name: "Save & preview", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Test preview", exact: true })).toBeVisible();
    for (const name of ["Read OK", "Wrong schema", "Wrong status"]) await expect(page.getByRole("checkbox", { name: `Select ${name}`, exact: true })).toBeChecked();
    const missing = page.getByRole("row").filter({ has: page.getByRole("checkbox", { name: "Select Missing example", exact: true }) });
    await expect(missing).toContainText("skipped");
    await expect(missing.getByRole("checkbox")).toBeDisabled();
    await expect(missing.getByRole("checkbox")).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Select Risky write", exact: true })).toBeEnabled();
    await expect(page.getByRole("checkbox", { name: "Select Risky write", exact: true })).not.toBeChecked();
    expect(received).toEqual([]);
    const beforeRun = await page.evaluate(() => window.studio.loadWorkspace());
    expect(beforeRun.workspace.collections).toHaveLength(2);
    expect(JSON.parse(JSON.stringify(beforeRun.workspace.collections.find((item) => item.id === existing.id)))).toEqual(preservedCollection);
    expect(beforeRun.workspace.connectionProfiles?.[0]).toMatchObject({ name: "Synthetic guided profile", provider: "apinizer",
      auth: { kind: "apinizer", endpoint: `${origin}/issuer/token` } });
    for (const secret of Object.values(credentials)) expect(await readFile(join(root, "workspace.json"), "utf8")).not.toContain(secret);
    await page.getByRole("button", { name: "Run selected tests", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Results", exact: true })).toBeVisible();
    const consent = await app.evaluate(() => (globalThis as unknown as ConsentState).workflowConsent);
    expect(consent).toHaveLength(1);
    expect(consent[0]).toMatchObject({ title: "Approve workflow run", defaultId: 1, cancelId: 1 });
    for (const path of ["/issuer/token", "/ok", "/wrong-schema", "/wrong-status"]) expect(consent[0].detail).toContain(`${origin}${path}`);
    for (const path of ["/write", "/missing-example"]) expect(consent[0].detail).not.toContain(`${origin}${path}`);
    for (const secret of Object.values(credentials)) expect(JSON.stringify(consent)).not.toContain(secret);
    expect(received.map((item) => item.url)).toEqual(["/issuer/token", "/ok", "/wrong-schema", "/wrong-status"]);
    expect(received[0].method).toBe("POST");
    expect(Object.fromEntries(new URLSearchParams(received[0].body))).toEqual({ grant_type: "password",
      username: credentials.username, password: credentials.password, client_id: credentials.clientId });
    expect(received.slice(1).every((item) => item.authorization === `Bearer ${credentials.token}`)).toBe(true);
    const article = (name: string) => page.locator("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(article("Read OK")).toContainText("status: passed");
    await expect(article("Read OK")).toContainText("schema: passed");
    await expect(article("Wrong schema")).toContainText("schema: failed");
    await expect(article("Wrong status")).toContainText("status: failed");
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, exportPath);
    await page.getByRole("button", { name: "Export JSON report", exact: true }).click();
    await expect.poll(async () => readFile(exportPath, "utf8").catch(() => "")).toContain('"completed"');
    const exported = await readFile(exportPath, "utf8"), report = JSON.parse(exported) as WorkflowRunReport;
    expect(report).toMatchObject({ status: "completed", authentication: { status: "passed" },
      totals: { passed: 1, failed: 2, skipped: 2, blocked: 0 } });
    expect(exported).toContain("[REDACTED]"); expect(exported).toContain("synthetic response remains visible");
    for (const secret of Object.values(credentials)) expect(exported).not.toContain(secret);
    expect(await page.evaluate((id) => window.studio.getWorkflowReport(id), report.id)).toEqual(report);
    const storedText = await readFile(join(root, "workspace.json"), "utf8"), stored = JSON.parse(storedText) as Workspace;
    for (const secret of Object.values(credentials)) expect(storedText).not.toContain(secret);
    const savedAuth = beforeRun.workspace.connectionProfiles![0].auth;
    if (savedAuth.kind !== "apinizer") throw new Error("Expected Apinizer profile");
    for (const name of [savedAuth.usernameVariable, savedAuth.passwordVariable, savedAuth.clientIdVariable, savedAuth.tokenVariable]) {
      expect(stored.environments[0].variables.find((item) => item.name === name)?.value).toMatch(/^enc:v1:/);
    }
    expect(stored.collections.find((item) => item.id === existing.id)).toEqual(preservedCollection);
    const settings = await page.evaluate(() => window.studio.loadSettings());
    expect(settings.agentEnabled).not.toBe(true); expect(settings.agentNetworkEnabled).not.toBe(true);
    await test.info().attach("masked-workflow-report", { body: exported, contentType: "application/json" });
    await page.getByRole("button", { name: "Preview again", exact: true }).click();
    for (const name of ["Read OK", "Wrong schema", "Wrong status"]) {
      const checkbox = page.getByRole("checkbox", { name: `Select ${name}`, exact: true });
      await checkbox.click(); await expect(checkbox).not.toBeChecked();
    }
    await page.getByRole("checkbox", { name: "Select Risky write", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Select Risky write", exact: true })).toBeChecked();
    await page.getByRole("button", { name: "Run selected tests", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Results", exact: true })).toBeVisible();
    const approvedWrite = (await app.evaluate(() => (globalThis as unknown as ConsentState).workflowConsent))[1];
    expect(approvedWrite.detail).toContain(`MAY CHANGE DATA: POST ${origin}/write`);
    expect(received.slice(4).map((item) => [item.method, item.url])).toEqual([["POST", "/issuer/token"], ["POST", "/write"]]);
    expect(JSON.parse(received[5].body)).toEqual({ label: "explicit fixture" });
    await expect(article("Risky write")).toContainText("schema: passed");
    await page.screenshot({ path: join(repository, "apps/desktop/e2e/artifacts/guided-workflow-results.png"), fullPage: true });
  } finally { await dispose(root, server, app); }
});

async function tool<T>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.find((item) => item.type === "text");
  if (!text || text.type !== "text") throw new Error("Missing MCP result");
  if (result.isError) throw new Error(`MCP tool failed: ${text.text}`);
  return JSON.parse(text.text) as T;
}

test("real MCP workflow cancellation and disconnect retain reports and prevent later sends", async () => {
  test.setTimeout(120_000);
  const root = await fixtureRoot();
  const received: string[] = [];
  let closed = 0;
  const { server, origin } = await loopback((request, response) => {
    received.push(request.url ?? "");
    response.on("close", () => { closed++; });
    if (request.url !== "/held") response.end(JSON.stringify({ ok: true }));
    // The first selected request stays pending until the real transport is aborted.
  });
  let app: ElectronApplication | undefined, client: Client | undefined;
  try {
    const workspace = createEmptyWorkspace("Workflow cancellation");
    const collection = createCollection("Synthetic cancellation API"); collection.baseUrl = origin;
    collection.requests.push(createRequest({ name: "Held first", method: "GET", url: "{{baseUrl}}/held" }),
      createRequest({ name: "Must not send next", method: "GET", url: "{{baseUrl}}/after" }));
    workspace.collections.push(collection);
    const profile: ConnectionProfile = { id: "synthetic-cancellation-profile", name: "Cancellation profile", provider: "openapi",
      collectionId: collection.id, environmentId: workspace.environments[0].id, baseUrl: origin,
      source: { kind: "existing", label: collection.name }, auth: { kind: "none" } };
    workspace.connectionProfiles = [profile];
    await writeFile(join(root, "workspace.json"), JSON.stringify(workspace));
    app = await launchStudio(root);
    const page = await app.firstWindow(); await expect(page.locator(".save-status")).toHaveText("Saved");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Enable AI connections").check();
    await expect.poll(() => page.evaluate(async () => (await window.studio.loadSettings()).agentEnabled)).toBe(true);
    await interceptConsent(app);
    const connection = await page.evaluate(() => window.studio.getAgentConnection());
    const connectClient = async () => {
      const next = new Client({ name: "specfold-guided-cancellation", version: "1" });
      await next.connect(new StdioClientTransport({ ...connection.configuration, stderr: "pipe" }));
      return next;
    };
    client = await connectClient();
    expect(await tool<unknown[]>(client, "list_connection_profiles")).toEqual([expect.objectContaining({ id: profile.id, auth: { kind: "none" } })]);
    const firstPlan = await tool<WorkflowTestPlan>(client, "preview_test_plan", { profileId: profile.id });
    expect(firstPlan.rows.map((row) => [row.name, row.selected, row.status])).toEqual([
      ["Held first", true, "ready"], ["Must not send next", true, "ready"]
    ]);
    const denied = await tool<WorkflowRunReport>(client, "run_test_plan", { planId: firstPlan.id });
    expect(denied.status).toBe("blocked");
    expect(denied.results.every((item) => item.status === "blocked" && item.reason === "Agent network permission is disabled.")).toBe(true);
    expect(received).toEqual([]);
    expect(await app.evaluate(() => (globalThis as unknown as ConsentState).workflowConsent)).toEqual([]);
    await page.getByLabel("Allow agents to send requests and read masked responses").check();
    await expect.poll(() => page.evaluate(async () => (await window.studio.loadSettings()).agentNetworkEnabled)).toBe(true);

    for (const mode of ["cancel", "disconnect"] as const) {
      const plan = await tool<WorkflowTestPlan>(client, "preview_test_plan", { profileId: profile.id });
      const count = received.length, controller = new AbortController();
      const pending = client.callTool({ name: "run_test_plan", arguments: { planId: plan.id } }, undefined,
        { signal: controller.signal }).then(() => "resolved", () => "interrupted");
      await expect.poll(() => received.length).toBe(count + 1);
      expect(received.at(-1)).toBe("/held");
      if (mode === "cancel") controller.abort();
      else { await client.close(); client = await connectClient(); }
      expect(await pending).toBe("interrupted");
      await expect.poll(() => closed).toBe(count + 1);
      // The completed cancellation report is the synchronization barrier: no sleeps
      // or assumptions about how quickly the backend notices the disconnect.
      let report: WorkflowRunReport | undefined;
      await expect.poll(async () => {
        try { report = await tool<WorkflowRunReport>(client!, "get_test_report", { id: plan.id }); return report.status; }
        catch { return "waiting"; }
      }).toBe("canceled");
      expect(report!.results).toHaveLength(2);
      expect(report!.results.every((item) => item.status === "blocked" && item.httpStatus === undefined)).toBe(true);
      expect(received).toEqual(Array.from({ length: count + 1 }, () => "/held"));
      expect(await tool<WorkflowRunReport>(client, "get_test_report", { id: report!.id })).toEqual(report);
    }
    const consent = await app.evaluate(() => (globalThis as unknown as ConsentState).workflowConsent);
    expect(consent).toHaveLength(2);
    for (const entry of consent) {
      expect(entry.detail).toContain(`GET ${origin}/held`); expect(entry.detail).toContain(`GET ${origin}/after`);
    }
    expect(received).toEqual(["/held", "/held"]);
  } finally {
    try { await client?.close(); } finally { await dispose(root, server, app); }
  }
});
