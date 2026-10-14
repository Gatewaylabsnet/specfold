import { afterEach, describe, expect, it } from "vitest";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  createCollection,
  createEmptyWorkspace,
  createFolder,
  createRequest,
  exportCollectionToOpenApiResult,
  findRequest,
  flattenRequests,
  folderAccessTokenVariable,
  importApiDocument,
  parseCollectionJson,
  prepareHttpRequest,
  serializeCollectionJson,
  type ConnectionProfile,
  type Workspace
} from "@openapi-collection-studio/core";
import type { AppSettings } from "../shared/contracts";
import { ENCRYPTED_PREFIX, createStorageService, storagePaths, type SecureStorageAdapter } from "./storageService";

const temporaryDirectories: string[] = [];
const temporaryPrefix = "specfold-upgrade-";
const previousTime = "2026-09-20T10:00:00.000Z";
const upgradedTime = "2026-10-14T10:00:00.000Z";

// Only invented credentials and reserved .test hosts occur in this fixture.
const secrets = {
  basic: "synthetic-upgrade-basic-password",
  bearer: "synthetic-upgrade-literal-bearer",
  apiKey: "synthetic-upgrade-api-key",
  header: "synthetic-upgrade-header-token",
  query: "synthetic-upgrade-query-secret",
  path: "synthetic-upgrade-path-secret",
  body: "synthetic-upgrade-body-secret",
  form: "synthetic-upgrade-form-password",
  example: "synthetic-upgrade-example-token",
  cookie: "synthetic-upgrade-example-cookie",
  environment: "synthetic-upgrade-environment-password",
  folderToken: "synthetic-upgrade-folder-access-token"
};

const legacySettings = {
  requestTimeoutMs: 4567,
  maxResponseBytes: 345678,
  allowInsecureTls: false,
  theme: "dark" as const,
  fontSize: "large" as const
};

const settings: AppSettings = {
  ...legacySettings,
  agentEnabled: false,
  agentNetworkEnabled: false,
  agentNetworkMode: "ask"
};

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith(temporaryPrefix)) {
      throw new Error("Refusing to remove a directory outside the generated upgrade fixture.");
    }
    await rm(target, { recursive: true, force: true });
  }
});

async function testDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), temporaryPrefix));
  temporaryDirectories.push(directory);
  return directory;
}

// Exercise real authenticated ciphertext without depending on Electron or a host keychain.
// This adapter is deliberately local to each test and is not a production keychain test.
function syntheticSecureStorage(): SecureStorageAdapter {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decryptString: (value) => {
      const decipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString("utf8");
    }
  };
}

function legacyWorkspace(): Workspace {
  const workspace = createEmptyWorkspace("Synthetic upgrade workspace");
  const collection = createCollection("Synthetic Orders");
  collection.version = "2.4.0";
  collection.description = "Saved collection description";
  collection.baseUrl = "https://collection.example.test/v1";
  collection.openApi = {
    sourceFormat: "openapi3",
    documentVersion: "3.0.3",
    components: { schemas: { Order: { type: "object", properties: { label: { type: "string" } } } } },
    securitySchemes: { BearerAuth: { type: "http", scheme: "bearer" } }
  };
  Object.assign(collection, { "x-collection-extension": { owner: "synthetic", retained: true } });

  const basic = createRequest({ name: "Synthetic credentials", method: "POST", url: "/credentials/{secret}" });
  basic.auth = { type: "basic", username: "synthetic-user", password: secrets.basic };
  basic.headers = [{ id: "auth-header", key: "Authorization", value: secrets.header, enabled: true }];
  basic.queryParams = [{ id: "query-secret", key: "api_key", value: secrets.query, enabled: true }];
  basic.pathParams = [{ id: "path-secret", key: "secret", value: secrets.path, enabled: true }];
  basic.body = { mode: "json", contentType: "application/json", raw: JSON.stringify({ client_secret: secrets.body }) };
  basic.responseExamples = [{
    id: "secret-example", name: "Synthetic token response", status: 200,
    headers: [{ id: "cookie", key: "Set-Cookie", value: secrets.cookie, enabled: true }],
    contentType: "application/json", body: JSON.stringify({ access_token: secrets.example })
  }];
  collection.requests.push(basic);

  const outer = createFolder("Gateway");
  outer.baseUrl = "https://gateway.example.test/api";
  outer.accessTokenVariable = "gatewayToken";
  outer.description = "Inherited routing and token reference";
  Object.assign(outer, { "x-folder-extension": ["keep", { depth: 1 }] });
  const form = createRequest({ name: "Synthetic form", method: "POST", url: "/form" });
  form.auth = { type: "apiKey", key: "X-Api-Key", value: secrets.apiKey, in: "header" };
  form.body = { mode: "form", form: [{ id: "form-password", key: "password", value: secrets.form, enabled: true }] };
  outer.requests.push(form);

  const inner = createFolder("Orders");
  inner.baseUrl = "https://orders.example.test/v2";
  const order = createRequest({ name: "Update order", method: "PATCH", url: "/orders/{orderId}" });
  order.id = "request-reference-order";
  order.favorite = true;
  order.description = "Saved request description";
  order.auth = { type: "bearer", token: "{{gatewayToken}}" };
  order.pathParams = [{ id: "order-id", key: "orderId", value: "{{orderId}}", enabled: true, description: "Order identifier" }];
  order.queryParams = [{ id: "expand", key: "expand", value: "details", enabled: true }];
  order.headers = [{ id: "trace", key: "X-Trace", value: "saved-trace", enabled: true }];
  order.body = Object.assign({
    mode: "json" as const, contentType: "application/json", required: false,
    raw: '{"label":"saved order"}', schema: { $ref: "#/components/schemas/Order" }
  }, { "x-body-extension": { retained: "body" } });
  order.responseExamples = [Object.assign({
    id: "order-example", name: "Saved order", status: 202, headers: [],
    contentType: "application/json", body: '{"label":"saved order"}'
  }, { "x-example-extension": "keep example" })];
  order.openApi = {
    sourceFormat: "openapi3", path: "/orders/{orderId}", method: "patch", operationId: "updateOrder",
    tags: ["Orders"], rawOperation: {
      deprecated: true, "x-operation-extension": { retained: true },
      security: [{ BearerAuth: [] }],
      requestBody: { required: false, content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } },
      responses: { "202": { description: "Saved order", content: { "application/json": { example: { label: "saved order" } } } } }
    }
  };
  Object.assign(order, { "x-request-extension": { retained: "request", nested: [1, 2] } });
  const bearer = createRequest({ name: "Synthetic bearer", url: "/bearer" });
  bearer.auth = { type: "bearer", token: secrets.bearer };
  inner.requests.push(order, bearer);
  outer.folders.push(inner);
  collection.folders.push(outer);
  workspace.collections.push(collection);
  workspace.environments[0].variables = [
    { id: "base-url", name: "baseUrl", value: "https://environment.example.test", enabled: true },
    { id: "order-variable", name: "orderId", value: "42", enabled: true },
    // A folder token reference must cause encryption even when the old flag is false.
    { id: "folder-token", name: "gatewayToken", value: secrets.folderToken, enabled: true, secret: false },
    Object.assign({ id: "password-variable", name: "password", value: secrets.environment, enabled: true, secret: true },
      { "x-variable-extension": "keep variable" })
  ];
  workspace.environments.push({ id: "disabled-environment", name: "Secondary", variables: [
    { id: "disabled-value", name: "disabledValue", value: "retained-disabled-value", enabled: false }
  ] });
  Object.assign(workspace.environments[0], { "x-environment-extension": "keep environment" });
  Object.assign(workspace, { "x-workspace-extension": { retained: "workspace" } });
  // Previous schema-1 workspaces must not depend on the new optional field.
  delete workspace.connectionProfiles;
  return workspace;
}

function expectEncryptedWorkspace(text: string): void {
  expect(text).toContain(ENCRYPTED_PREFIX);
  for (const secret of Object.values(secrets)) expect(text).not.toContain(secret);
}

function expectReferenceExportUsable(workspace: Workspace): void {
  // Export the reference-only request; no synthetic literal credential requests are included.
  const collection = structuredClone(workspace.collections[0]);
  collection.requests = [];
  collection.folders[0].requests = [];
  collection.folders[0].folders[0].requests = [findRequest(collection, "request-reference-order")!.request];
  const exported = exportCollectionToOpenApiResult(collection, {
    format: "json", useFolderNamesAsTags: true,
    includeRequestExamples: true, includeResponseExamples: true,
    includeBearerJwtSecurityScheme: true, includeAllComponents: true
  });
  expect(exported.warnings).toEqual([]);
  for (const secret of Object.values(secrets)) expect(exported.content).not.toContain(secret);
  const document = JSON.parse(exported.content);
  expect(document.paths["/orders/{orderId}"].patch).toMatchObject({
    operationId: "updateOrder", deprecated: true, security: [{ BearerAuth: [] }],
    servers: [{ url: "https://orders.example.test/v2" }], "x-operation-extension": { retained: true },
    requestBody: { required: false, content: { "application/json": {
      schema: { $ref: "#/components/schemas/Order" }, example: { label: "saved order" }
    } } }
  });
  expect(document.components.schemas.Order).toMatchObject({ type: "object" });
  const imported = importApiDocument(exported.content, { grouping: "tags" });
  expect(imported.preview.operationCount).toBe(1);
  const request = flattenRequests(imported.collection)[0].request;
  expect(request.auth).toEqual({ type: "bearer", token: "{{accessToken}}" });
  expect(request.openApi?.operationId).toBe("updateOrder");
  expect(request.body.schema).toEqual({ $ref: "#/components/schemas/Order" });
  expect(request.responseExamples[0].status).toBe(202);
  expect(JSON.parse(request.responseExamples[0].body!)).toEqual({ label: "saved order" });
  expect(JSON.parse(exportCollectionToOpenApiResult(imported.collection, {
    format: "json", useFolderNamesAsTags: true,
    includeRequestExamples: true, includeResponseExamples: true,
    includeBearerJwtSecurityScheme: true, includeAllComponents: true
  }).content).paths["/orders/{orderId}"].patch["x-operation-extension"]).toEqual({ retained: true });
}

describe("synthetic schema-1 upgrade to stable 1.11", () => {
  // Synthetic fixtures use the unchanged legacy schema/encryption format through the current
  // service with previous appVersion labels. They do not execute archived previous binaries.
  it.each(["1.9.4", "1.10.0"])("preserves %s data, encrypted credentials, and portable exports through save and full restore", async (previousVersion) => {
    const directory = await testDirectory();
    const paths = storagePaths(join(directory, "upgrade"));
    const secureStorage = syntheticSecureStorage();
    const previous = createStorageService({ paths, secureStorage, appVersion: previousVersion, now: () => new Date(previousTime) });
    const original = legacyWorkspace();
    await previous.saveWorkspace(original);
    // Pre-workflow settings have no agent flags; upgrading must keep networking disabled.
    await writeFile(paths.settings, JSON.stringify(legacySettings), "utf8");
    const expected = structuredClone(original);
    expected.updatedAt = previousTime;
    expected.environments[0].variables[2].secret = true;
    const expectedLoaded = structuredClone(expected);
    // The legacy restore path supplies an empty form array for every body mode.
    // Preserve that compatible additive normalization while comparing all saved data.
    for (const collection of expectedLoaded.collections) for (const { request } of flattenRequests(collection)) {
      request.body.form ??= [];
    }
    const beforeUpgrade = await readFile(paths.workspace, "utf8");
    expectEncryptedWorkspace(beforeUpgrade);
    expect(JSON.parse(beforeUpgrade)).not.toHaveProperty("connectionProfiles");
    const backupPath = join(directory, "previous.full-backup.json");
    await previous.writeBackup(backupPath, expected);
    // Full backups explicitly include secrets and remain confined to the synthetic temp directory.
    const backup = JSON.parse(await readFile(backupPath, "utf8"));
    expect(backup).toMatchObject({ schema: "specfold.backup.v1", appVersion: previousVersion, secretsIncluded: true });
    expect(backup.workspace).toEqual(expected);
    expect(backup.settings).toEqual(settings);
    // Recreate the previous full-backup settings shape, likewise without workflow flags.
    backup.settings = legacySettings;
    await writeFile(backupPath, JSON.stringify(backup), "utf8");

    const upgraded = createStorageService({ paths, secureStorage, appVersion: "1.11.0", now: () => new Date(upgradedTime) });
    const loaded = await upgraded.loadWorkspace();
    expect(loaded.recovered).toBe(false);
    expect(loaded.secureStorageAvailable).toBe(true);
    expect(loaded.workspace).toEqual(expectedLoaded);
    expect(await upgraded.loadSettings()).toEqual(settings);
    expect(await readFile(paths.workspace, "utf8")).toBe(beforeUpgrade);
    await upgraded.saveWorkspace(loaded.workspace);
    const automaticBackups = (await readdir(paths.backups)).filter((name) => name.startsWith("workspace-"));
    expect(automaticBackups).toHaveLength(1);
    expect(await readFile(join(paths.backups, automaticBackups[0]), "utf8")).toBe(beforeUpgrade);
    expectEncryptedWorkspace(await readFile(paths.workspace, "utf8"));
    const savedExpected = { ...expectedLoaded, updatedAt: upgradedTime };
    const reloaded = await upgraded.loadWorkspace();
    expect(reloaded.recovered).toBe(false);
    expect(reloaded.workspace).toEqual(savedExpected);
    expect(parseCollectionJson(serializeCollectionJson(reloaded.workspace.collections[0]))).toEqual(expectedLoaded.collections[0]);

    const located = findRequest(reloaded.workspace.collections[0], "request-reference-order")!;
    expect(located.folderPath.map((folder) => folder.name)).toEqual(["Gateway", "Orders"]);
    expect(folderAccessTokenVariable(located.folderPath)).toBe("gatewayToken");
    const prepared = prepareHttpRequest(located.request, reloaded.workspace.environments[0], located.collection, located.folderPath);
    expect(prepared.url).toBe("https://orders.example.test/v2/orders/42?expand=details");
    expect(prepared.headers.Authorization).toBe(`Bearer ${secrets.folderToken}`);
    expect(prepared.body).toBe('{"label":"saved order"}');
    expectReferenceExportUsable(reloaded.workspace);

    const restorePaths = storagePaths(join(directory, "restore"));
    const restoreService = createStorageService({ paths: restorePaths, secureStorage, appVersion: "1.11.0", now: () => new Date(upgradedTime) });
    await restoreService.saveWorkspace(createEmptyWorkspace("Before synthetic restore"));
    await restoreService.saveSettings({ ...settings, theme: "light", requestTimeoutMs: 9999 });
    const beforeRestore = await readFile(restorePaths.workspace, "utf8");
    const beforeRestoreSettings = await readFile(restorePaths.settings, "utf8");
    const restored = await restoreService.restoreBackupFile(backupPath);
    expect(restored).toMatchObject({ canceled: false, restored: true, secureStorageAvailable: true });
    expect(restored.workspace).toEqual(expectedLoaded);
    expect(restored.settings).toEqual(settings);
    expect(restored.safetyBackupPath).toBeDefined();
    expect(dirname(resolve(restored.safetyBackupPath!))).toBe(resolve(restorePaths.backups));
    expect(await readFile(restored.safetyBackupPath!, "utf8")).toBe(beforeRestore);
    expect(await readFile(restored.safetyBackupPath!.replace(".workspace.json", ".settings.json"), "utf8")).toBe(beforeRestoreSettings);
    expectEncryptedWorkspace(await readFile(restorePaths.workspace, "utf8"));
    expect((await restoreService.loadWorkspace()).workspace).toEqual(expectedLoaded);
    expect(await restoreService.loadSettings()).toEqual(settings);
  });

  it("round-trips optional 1.11 reference-only connection profiles with credentials in encrypted environments", async () => {
    const directory = await testDirectory();
    const paths = storagePaths(directory);
    const service = createStorageService({ paths, secureStorage: syntheticSecureStorage(), appVersion: "1.11.0", now: () => new Date(upgradedTime) });
    const workspace = legacyWorkspace();
    const profile: ConnectionProfile = {
      id: "synthetic-profile", name: "Synthetic Orders", provider: "openapi",
      collectionId: workspace.collections[0].id, environmentId: workspace.environments[0].id,
      baseUrl: "https://orders.example.test/v2", source: { kind: "existing", label: "Synthetic Orders" },
      auth: { kind: "bearer", tokenVariable: "gatewayToken" }
    };
    workspace.connectionProfiles = [Object.assign(profile, { "x-profile-extension": { retained: true } })];
    await service.saveSettings(settings);
    await service.saveWorkspace(workspace);
    const loaded = await service.loadWorkspace();
    expect(loaded.recovered).toBe(false);
    expect(loaded.workspace.connectionProfiles).toEqual(workspace.connectionProfiles);
    const persisted = await readFile(paths.workspace, "utf8");
    expectEncryptedWorkspace(persisted);
    expect(JSON.parse(persisted).connectionProfiles).toEqual(workspace.connectionProfiles);
    const backup = await service.createBackupDocument(loaded.workspace);
    expect(backup.appVersion).toBe("1.11.0");
    const restored = await service.restoreBackupText(JSON.stringify(backup));
    expect(restored.workspace).toEqual(loaded.workspace);
    expect(restored.settings).toEqual(settings);
    expect((await service.loadWorkspace()).workspace).toEqual(loaded.workspace);
    expectEncryptedWorkspace(await readFile(paths.workspace, "utf8"));
  });
});
