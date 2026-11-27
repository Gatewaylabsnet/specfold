import { test, expect, _electron, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCollection, createEmptyWorkspace, createRequest, type Workspace } from "../../../../packages/core/src/index";

async function bindLoopback(server: Server): Promise<string> {
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); done(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No loopback fixture port");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  const closed = new Promise<void>((done) => { server.close(() => done()); });
  server.closeAllConnections();
  await closed;
}

async function sendFromEditor(page: Page, requestName: string): Promise<void> {
  await page.getByText(requestName, { exact: true }).first().click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
}

// Keep even randomized synthetic tokens out of test diagnostics.
test.use({ trace: "off", screenshot: "off", video: "off" });
test("manual Auth shows the masked response first and uses an encrypted collection token only on same-origin requests", async () => {
  test.setTimeout(90_000);
  const temp = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(temp, "specfold-auto-collection-token-")));
  if (!root.startsWith(join(temp, "specfold-auto-collection-token-"))) throw new Error("Unexpected fixture root");
  const file = join(root, "workspace.json");
  const tokens = [randomBytes(24).toString("hex"), randomBytes(24).toString("hex"), randomBytes(24).toString("hex")];
  let issuerCalls = 0, rejectIssuer = false, activeToken = tokens[0];
  let foreignOrigin: string;
  const issuerHadAuth: boolean[] = [];
  const seen: Record<string, Array<"collection" | "explicit" | "none" | "other">> = {};
  const service = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "POST" && request.url === "/auth/jwt") {
      const issued = tokens[issuerCalls++];
      issuerHadAuth.push(!!request.headers.authorization);
      if (!rejectIssuer) activeToken = issued;
      response.statusCode = rejectIssuer ? 401 : 200;
      response.setHeader("x-fixture-echo", issued);
      response.end(JSON.stringify({ access_token: issued, token_type: "Bearer", expires_in: 900 }));
      return;
    }
    const header = request.headers.authorization;
    const kind = header === `Bearer ${activeToken}` ? "collection" : header === "Bearer explicit-fixture-bearer" ? "explicit" : header ? "other" : "none";
    (seen[request.url ?? "/"] ??= []).push(kind);
    if (request.url === "/redirect") {
      response.writeHead(302, { location: `${foreignOrigin}/destination` }).end();
      return;
    }
    response.end(JSON.stringify({ fixture: "ok" }));
  });
  const receivedForeignAuth: boolean[] = [];
  const outside = createServer((request, response) => {
    receivedForeignAuth.push(!!request.headers.authorization);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ fixture: "other origin" }));
  });
  const repository = fileURLToPath(new URL("../../../../", import.meta.url));
  const executable = process.env.SPECFOLD_E2E_EXECUTABLE;
  const launch = () => _electron.launch({
    executablePath: executable ? resolve(executable) : createRequire(import.meta.url)("electron"),
    args: executable ? ["--disable-gpu"] : [resolve(repository, "apps/desktop/out/main/index.js"), "--disable-gpu"],
    env: { ...process.env, SPECFOLD_E2E_USER_DATA_PATH: root }
  });
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    const origin = await bindLoopback(service);
    foreignOrigin = await bindLoopback(outside);
    const workspace = createEmptyWorkspace("Synthetic automatic collection token");
    const collection = createCollection("Fixture Auth API");
    collection.baseUrl = origin;
    const issuer = createRequest({ name: "Fixture JWT issuer", method: "POST", url: "{{baseUrl}}/auth/jwt" });
    const apiRequest = createRequest({ name: "Fixture same-origin service", url: "{{baseUrl}}/protected" });
    const explicit = createRequest({ name: "Fixture explicit Bearer", url: "{{baseUrl}}/explicit" });
    explicit.auth = { type: "bearer", token: "explicit-fixture-bearer" };
    const foreign = createRequest({ name: "Fixture outside origin", url: `${foreignOrigin}/outside` });
    const redirect = createRequest({ name: "Fixture attempted cross-origin redirect", url: "{{baseUrl}}/redirect" });
    collection.requests.push(issuer, apiRequest, explicit, foreign, redirect);
    const other = createCollection("Other fixture collection");
    other.baseUrl = origin;
    other.requests.push(createRequest({ name: "Fixture other collection service", url: "{{baseUrl}}/other-collection" }));
    workspace.collections = [collection, other];
    await writeFile(file, JSON.stringify(workspace));

    const readDisk = async (): Promise<Workspace> => JSON.parse(await readFile(file, "utf8"));
    app = await launch();
    const page = await app.firstWindow();
    await expect(page.locator(".save-status")).toHaveText("Saved");
    await sendFromEditor(page, issuer.name);
    const bodyView = page.locator(".response-body-view");
    await expect(bodyView).toHaveAttribute("open", "");
    await expect(bodyView.locator("pre")).toBeVisible();
    const content = await bodyView.locator("pre").innerText();
    expect(content.includes("expires_in")).toBe(true);
    expect(content.includes(tokens[0])).toBe(false);
    await bodyView.getByRole("button", { name: "Headers", exact: true }).click();
    const headers = await bodyView.locator("pre").innerText();
    expect(headers.includes("x-fixture-echo")).toBe(true);
    expect(headers.includes(tokens[0])).toBe(false);
    const responseFirst = await page.locator(".response-panel").evaluate((panel) => {
      const body = panel.querySelector(".response-body-view");
      const advanced = panel.querySelector(".response-advanced");
      const binding = panel.querySelector(".response-token-binding");
      return !!(body && advanced && (body.compareDocumentPosition(advanced) & Node.DOCUMENT_POSITION_FOLLOWING)
        && (!binding || (body.compareDocumentPosition(binding) & Node.DOCUMENT_POSITION_FOLLOWING)));
    });
    expect(responseFirst).toBe(true);
    expect(issuerCalls).toBe(1);
    expect(issuerHadAuth).toEqual([false]);
    expect(seen).toEqual({});
    expect(receivedForeignAuth).toEqual([]);

    await expect.poll(async () => !!(await readDisk()).collections[0].autoAccessToken).toBe(true);
    const disk = await readDisk();
    const binding = disk.collections[0].autoAccessToken!;
    expect(binding).toMatchObject({ issuerRequestId: issuer.id, origin });
    const variable = disk.environments[0].variables.find(({ name }) => name === binding.variableName);
    expect(!!variable?.secret && !!variable?.enabled && variable.value.startsWith("enc:v1:")).toBe(true);
    expect(disk.collections[0].requests[1].auth).toEqual({ type: "none" });
    expect(disk.collections[1].autoAccessToken).toBeUndefined();

    // Collection inheritance must not rewrite request auth or enable any
    // automatic sends, and it must stop at an exact origin boundary.
    await sendFromEditor(page, apiRequest.name);
    await expect.poll(() => seen["/protected"]).toEqual(["collection"]);
    await sendFromEditor(page, explicit.name);
    await expect.poll(() => seen["/explicit"]).toEqual(["explicit"]);
    await sendFromEditor(page, foreign.name);
    await expect.poll(() => receivedForeignAuth).toEqual([false]);
    await sendFromEditor(page, redirect.name);
    await expect.poll(() => seen["/redirect"]).toEqual(["collection"]);
    await expect(page.locator(".response-panel .response-error")).toBeVisible();
    expect(receivedForeignAuth).toEqual([false]); // No redirected request.
    await page.getByText(other.name, { exact: true }).first().click();
    await sendFromEditor(page, other.requests[0].name);
    await expect.poll(() => seen["/other-collection"]).toEqual(["none"]);
    await page.getByText(collection.name, { exact: true }).first().click();

    rejectIssuer = true;
    await sendFromEditor(page, issuer.name);
    await expect(page.locator(".response-panel .status-pill")).toContainText("401");
    await sendFromEditor(page, apiRequest.name);
    await expect.poll(() => seen["/protected"]).toEqual(["collection", "collection"]);
    rejectIssuer = false;
    await sendFromEditor(page, issuer.name);
    await expect.poll(async () => {
      const current = (await readDisk()).environments[0].variables.find(({ name }) => name === binding.variableName);
      return !!current?.value.startsWith("enc:v1:") && current.value !== variable?.value;
    }).toBe(true);
    expect(issuerHadAuth).toEqual([false, false, false]);
    const saved = await readDisk();
    expect(saved.collections[0].autoAccessToken).toEqual(binding);
    expect(saved.environments[0].variables.filter(({ name }) => name === binding.variableName)).toHaveLength(1);

    await app.close();
    app = await launch();
    const reopened = await app.firstWindow();
    await sendFromEditor(reopened, apiRequest.name);
    await expect.poll(() => seen["/protected"]).toEqual(["collection", "collection", "collection"]);
    expect(issuerCalls).toBe(3);
    const backups = join(root, "backups");
    for (const persisted of [file, ...(await readdir(backups)).filter((name) => name.endsWith(".json")).map((name) => join(backups, name))]) {
      const raw = await readFile(persisted, "utf8");
      expect(tokens.some((token) => raw.includes(token))).toBe(false);
    }
  } finally {
    await app?.close().catch(() => undefined);
    await Promise.all([closeServer(service), closeServer(outside)]);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
