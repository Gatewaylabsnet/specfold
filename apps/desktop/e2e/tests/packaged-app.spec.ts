import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

type RecordedRequest = {
  body: string;
  headers: IncomingMessage["headers"];
  method: string;
  path: string;
};

type MockApi = {
  baseUrl: string;
  close(): Promise<void>;
  uploads: RecordedRequest[];
};

type AppFixture = {
  app: ElectronApplication;
  backupPath: string;
  exportPath: string;
  page: Page;
  root: string;
};

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const execFile = promisify(execFileCallback);
const packagedExecutable = process.env.SPECFOLD_E2E_EXECUTABLE
  ? resolve(process.env.SPECFOLD_E2E_EXECUTABLE)
  : join(desktopRoot, "dist", "win-unpacked", "Specfold.exe");

test.describe.configure({ mode: "serial" });
test.skip(process.platform !== "win32", "The packaged application scenario runs on Windows.");

let api: MockApi;
let fixture: AppFixture | undefined;

test.beforeAll(async () => {
  api = await startMockApi();
});

test.beforeEach(async () => {
  fixture = await launchPackagedApp(api.baseUrl);
});

test.afterEach(async () => {
  const currentFixture = fixture;
  fixture = undefined;
  if (!currentFixture) {
    return;
  }
  await waitForSaved(currentFixture.page).catch(() => undefined);
  await stopPackagedApp(currentFixture.app);
  await rm(currentFixture.root, { force: true, maxRetries: 5, recursive: true, retryDelay: 200 });
});

test.afterAll(async () => {
  await api.close();
});

test("imports a document, manages routing, sends a request, and exports it", async () => {
  const { page, exportPath } = currentFixture();

  await page.getByLabel("Import").click();
  await page.getByRole("button", { name: "Open file", exact: true }).click();
  await expect(page.locator(".source-textarea")).toHaveValue(/E2E Inventory API/);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText("1/1 selected")).toBeVisible();
  await page.getByRole("button", { name: /^Import \(1\)$/ }).click();

  await expect(page.getByLabel("Request URL")).toHaveValue("{{baseUrl}}/v1/items");
  await page.getByLabel("Manage environments").click();
  await page.getByLabel("Environment name").fill("E2E environment");
  await page.getByLabel("Environment name").press("Tab");
  await page.getByLabel("Environment base URL").fill(api.baseUrl);
  await page.getByRole("button", { name: "Test connection", exact: true }).click();
  await expect(page.locator(".status-box--success")).toContainText("Reachable: HTTP 204");

  await page.getByLabel("Editor").click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".status-pill")).toContainText("200");
  await expect(page.locator(".response-panel pre")).toContainText("e2e-access-token");

  await page.getByLabel("Target variable name").fill("accessToken");
  await page.locator(".assign-row").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".notice-banner")).toContainText('Saved "accessToken"');

  await page.getByLabel("Export").click();
  await page.locator(".export-layout select").selectOption("collection-json");
  await expect(page.locator(".export-preview")).toContainText("E2E Inventory API");
  await page.getByRole("button", { name: "Copy to clipboard", exact: true }).click();
  await expect(page.locator(".notice-banner")).toContainText("Copied export content to the clipboard.");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(page.getByText(`Saved to ${exportPath}`)).toBeVisible();
  await expect.poll(async () => readFile(exportPath, "utf8")).toContain("E2E Inventory API");
});

test("sends a multipart request with a native file-picker grant", async () => {
  const { page } = currentFixture();

  await configureEnvironment(page, api.baseUrl);
  await page.getByLabel("Editor").click();
  await page.getByRole("button", { name: "New collection", exact: true }).click();
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await page.getByLabel("Method").selectOption("POST");
  await page.getByLabel("Request URL").fill("/v1/upload");
  await page.getByRole("button", { name: "Body", exact: true }).click();
  await page.getByRole("button", { name: "Form data", exact: true }).click();
  await page.getByRole("button", { name: "Add text field", exact: true }).click();
  await page.getByLabel("Field 1 name").fill("title");
  await page.getByLabel("Field 1 value").fill("E2E upload");
  await page.getByRole("button", { name: "Add file", exact: true }).click();
  await page.getByLabel("Field 2 name").fill("attachment");
  await page.getByLabel("Choose file for field 2").click();
  await expect(page.getByText("e2e-upload.txt", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".status-pill")).toContainText("201");
  await expect.poll(() => api.uploads.length).toBe(1);
  expect(api.uploads[0]?.body).toContain('name="title"');
  expect(api.uploads[0]?.body).toContain("E2E upload");
  expect(api.uploads[0]?.body).toContain('name="attachment"');
  expect(api.uploads[0]?.body).toContain("e2e-file-content");
});

test("backs up, deletes, and restores the complete local workspace", async () => {
  const { backupPath, page } = currentFixture();
  await page.evaluate(() => {
    window.confirm = () => true;
    window.prompt = () => "DELETE ALL";
  });

  await page.getByRole("button", { name: "New collection", exact: true }).click();
  await waitForSaved(page);
  await page.getByLabel("Settings").click();
  await page.getByRole("button", { name: "Export backup", exact: true }).click();
  await expect(page.locator(".notice-banner")).toContainText("Complete backup saved");
  await expect.poll(async () => readFile(backupPath, "utf8")).toContain("specfold.backup.v1");

  await page.getByRole("button", { name: "Delete all data", exact: true }).click();
  await expect(page.locator(".notice-banner")).toContainText("All local data was deleted");
  await expect(page.getByText("No collections yet. Import an OpenAPI document or create one.")).toBeVisible();

  await page.getByLabel("Settings").click();
  await page.getByRole("button", { name: "Restore backup", exact: true }).click();
  await expect(page.locator(".notice-banner")).toContainText("Backup restored");
  await expect(page.getByText("New Collection", { exact: true })).toBeVisible();
});

async function launchPackagedApp(baseUrl: string): Promise<AppFixture> {
  const root = await mkdtemp(join(tmpdir(), "specfold-e2e-"));
  const userDataPath = join(root, "user-data");
  const importPath = join(root, "inventory.openapi.json");
  const uploadPath = join(root, "e2e-upload.txt");
  const exportPath = join(root, "inventory.collection.json");
  const backupPath = join(root, "workspace.backup.json");
  await writeFile(importPath, JSON.stringify(openApiDocument(baseUrl)), "utf8");
  await writeFile(uploadPath, "e2e-file-content", "utf8");

  const app = await electron.launch({
    args: ["--disable-gpu"],
    env: { ...process.env, SPECFOLD_E2E_USER_DATA_PATH: userDataPath },
    executablePath: packagedExecutable,
    timeout: 30_000
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".app-shell");
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async (...args) => {
      const options = args[args.length - 1] as { title?: string } | undefined;
      if (options?.title === "Open API document") return { canceled: false, filePaths: [paths.importPath] };
      if (options?.title === "Choose file to upload") return { canceled: false, filePaths: [paths.uploadPath] };
      if (options?.title === "Restore Specfold backup") return { canceled: false, filePaths: [paths.backupPath] };
      return { canceled: true, filePaths: [] };
    };
    dialog.showSaveDialog = async (...args) => {
      const options = args[args.length - 1] as { title?: string } | undefined;
      if (options?.title === "Save export") return { canceled: false, filePath: paths.exportPath };
      if (options?.title === "Export complete Specfold backup") return { canceled: false, filePath: paths.backupPath };
      return { canceled: true };
    };
  }, { backupPath, exportPath, importPath, uploadPath });
  return { app, backupPath, exportPath, page, root };
}

async function configureEnvironment(page: Page, baseUrl: string): Promise<void> {
  await page.getByLabel("Manage environments").click();
  await page.getByLabel("Environment base URL").fill(baseUrl);
  await page.getByLabel("Environment base URL").press("Tab");
  await waitForSaved(page);
}

function currentFixture(): AppFixture {
  if (!fixture) {
    throw new Error("Packaged app fixture was not initialized.");
  }
  return fixture;
}

async function stopPackagedApp(app: ElectronApplication): Promise<void> {
  const process = app.process();
  if (process.exitCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolveExit) => process.once("exit", () => resolveExit()));
  // Electron 43 can leave renderer/GPU children behind after an app.quit() from
  // CDP. Stop the test-only process tree after the renderer has flushed saves.
  await execFile("taskkill", ["/pid", String(process.pid), "/t", "/f"]).catch(() => undefined);
  await exited;
}

async function waitForSaved(page: Page): Promise<void> {
  await expect(page.locator(".save-status")).toHaveText("Saved");
}

function openApiDocument(baseUrl: string) {
  return {
    openapi: "3.0.3",
    info: { title: "E2E Inventory API", version: "1.0.0" },
    servers: [{ url: baseUrl }],
    paths: {
      "/v1/items": {
        get: {
          operationId: "listItems",
          responses: {
            "200": {
              description: "Inventory response",
              content: { "application/json": { schema: { type: "object" } } }
            }
          }
        }
      }
    }
  };
}

async function startMockApi(): Promise<MockApi> {
  const uploads: RecordedRequest[] = [];
  const server = createServer(async (request, response) => {
    const path = request.url ?? "/";
    if (request.method === "HEAD" && path === "/") {
      response.writeHead(204).end();
      return;
    }
    if (request.method === "GET" && path === "/v1/items") {
      sendJson(response, 200, { access_token: "e2e-access-token", items: [{ id: "item-1" }] });
      return;
    }
    if (request.method === "POST" && path === "/v1/upload") {
      uploads.push({
        body: await readRequestBody(request),
        headers: request.headers,
        method: request.method,
        path
      });
      sendJson(response, 201, { uploaded: true });
      return;
    }
    sendJson(response, 404, { error: "not found" });
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The E2E mock API did not bind to a TCP port.");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => close(server),
    uploads
  };
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function listen(server: Server): Promise<void> {
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveServer();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolveServer, reject) => {
    server.close((error) => error ? reject(error) : resolveServer());
  });
}
