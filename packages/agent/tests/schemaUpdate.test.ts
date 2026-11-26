import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import {
  createCollection, createEmptyWorkspace, createId, flattenRequests, importApiDocument,
  type Workspace
} from "@openapi-collection-studio/core";
import { AgentRepository } from "../src/repository";
import { AgentService } from "../src/service";
import { atomicWriteFile } from "../src/atomicFile";
import { safeSchemaUpdateText } from "../src/schemaUpdateSource";
import type { AgentPreview } from "../src/desktopContracts";

function source(updated: boolean) {
  const operation = { requestBody: { content: { "application/json": {
    schema: { $ref: "#/components/schemas/Payload" },
    example: updated ? { fileName: "new.pdf", password: "NEVER_STORE_SOURCE_PASSWORD" }
      : { fileName: "original.pdf", requestHeader: {} }
  } } }, responses: { "204": { description: "OK" } } };
  return JSON.stringify({
    openapi: "3.0.3", info: { title: "Local acceptance", version: updated ? "2" : "1" },
    paths: { "/selected": { post: operation }, "/affected": { post: operation } },
    components: { schemas: { Payload: {
      type: "object",
      properties: { fileName: { type: "string", ...(updated ? { minLength: 1 } : {}) },
        ...(updated ? {} : { requestHeader: { type: "object" } }) },
      required: updated ? ["fileName"] : ["fileName", "requestHeader"]
    } } }
  });
}

let root: string, workspace: Workspace, service: AgentService;
const selected = () => flattenRequests(workspace.collections[0])[0].request;
const affected = () => flattenRequests(workspace.collections[0])[1].request;
const workspacePath = () => join(root, "workspace.json");
const requestIds = () => [selected().id];
const args = async (text = source(true)) => ({
  kind: "update-openapi-schema" as const, targetCollectionId: workspace.collections[0].id,
  requestIds: requestIds(), expectedRevision: (await service.repository.snapshot()).revision, text
});

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "specfold-schema-plan-")));
  workspace = createEmptyWorkspace();
  workspace.collections = [importApiDocument(source(false), { grouping: "tags" }).collection, createCollection("Unrelated")];
  selected().auth = { type: "bearer", token: "{{apinizerAuthAccessToken}}" };
  selected().body.raw = '{"fileName":"user.pdf","requestHeader":{"value":1}}';
  workspace.environments[0].variables.push({ id: createId("var"), name: "apinizerAuthAccessToken",
    value: "enc:v1:ZW5jcnlwdGVk", enabled: true, secret: true });
  await writeFile(workspacePath(), JSON.stringify(workspace));
  service = new AgentService(new AgentRepository(root), true);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe("approval-gated OpenAPI schema refresh", () => {
  it("previews the exact sanitized plan, requires human scope approval and is idempotent on disk", async () => {
    const before = await readFile(workspacePath(), "utf8");
    const fetch = vi.spyOn(globalThis, "fetch");
    const input = await args();
    const plan = await service.preview(input);
    expect(await readFile(workspacePath(), "utf8")).toBe(before);
    expect(plan.schemaUpdate).toMatchObject({ changed: true, selectedRequestIds: requestIds(),
      affectedRequestIds: [affected().id], requiresAcknowledgement: true });
    expect(plan.networkRequests).toBe(0);
    expect(plan.diff).toMatchObject({ added: [], changed: expect.arrayContaining(["POST /selected", "POST /affected"]) });
    expect((await service.showDiff(plan.planId)).schemaUpdate).toEqual(plan.schemaUpdate);
    const serialized = await readFile(join(root, ".agent", `${plan.planId}.plan.json`), "utf8");
    for (const content of [JSON.stringify(plan), serialized]) {
      expect(content).not.toContain("NEVER_STORE_SOURCE_PASSWORD");
      expect(content).not.toContain("enc:v1:ZW5jcnlwdGVk");
    }
    expect(serialized).toContain("[REDACTED]");
    expect(JSON.parse(JSON.parse(serialized).action.text).paths["/selected"].post.requestBody.content["application/json"].example)
      .toEqual({ fileName: "new.pdf", password: "[REDACTED]" });
    await expect(service.approve(plan.planId, input.expectedRevision)).rejects.toThrow("SCHEMA_DESKTOP_REVIEW_REQUIRED");
    await expect(service.apply(plan.planId, input.expectedRevision)).rejects.toThrow("SCHEMA_DESKTOP_REVIEW_REQUIRED");
    await expect(service.approveAndApply(plan.planId, input.expectedRevision)).rejects.toThrow("SCHEMA_IMPACT_APPROVAL_REQUIRED");
    await expect(service.approveAndApply(plan.planId, input.expectedRevision, [affected().id, affected().id]))
      .rejects.toThrow("SCHEMA_IMPACT_APPROVAL_REQUIRED");
    expect(await readFile(workspacePath(), "utf8")).toBe(before);
    const applied = await service.approveAndApply(plan.planId, input.expectedRevision, [affected().id]);
    expect(await readFile(join(root, "backups", applied.safetyBackup!), "utf8")).toBe(before);
    const reopened = new AgentService(new AgentRepository(root), true);
    const saved = (await reopened.repository.snapshot()).workspace;
    expect(saved.environments).toEqual(workspace.environments);
    expect(saved.collections[1]).toEqual(workspace.collections[1]);
    expect(flattenRequests(saved.collections[0])[0].request).toMatchObject({
      id: selected().id, auth: selected().auth, body: { raw: selected().body.raw }
    });
    const schemas = saved.collections[0].openApi?.components?.schemas as Record<string, unknown>;
    expect(schemas.Payload).toEqual({ type: "object", required: ["fileName"], properties: { fileName: { type: "string", minLength: 1 } } });
    expect(await reopened.approveAndApply(plan.planId, input.expectedRevision, [affected().id])).toMatchObject({ alreadyApplied: true });
    const noOp = await reopened.preview(await args());
    expect(noOp.schemaUpdate).toMatchObject({ changed: false, affectedRequestIds: [] });
    await expect(reopened.approveAndApply(noOp.planId, noOp.expectedRevision)).resolves.toMatchObject({ alreadyApplied: true });
    expect(await readdir(join(root, "backups"))).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses stale revision on preview and apply and retains the credential guard", async () => {
    const input = await args();
    const plan = await service.preview(input);
    workspace.name = "Newer workspace";
    workspace.environments[0].variables[0].value = "LEGACY_PLAINTEXT_VALUE";
    const newer = JSON.stringify(workspace);
    await writeFile(workspacePath(), newer);
    await expect(service.preview(input)).rejects.toThrow("REVISION_CONFLICT");
    await expect(service.showDiff(plan.planId)).rejects.toThrow("REVISION_CONFLICT");
    await expect(service.approveAndApply(plan.planId, input.expectedRevision, [affected().id])).rejects.toThrow("REVISION_CONFLICT");
    const fresh = await service.preview(await args());
    await expect(service.approveAndApply(fresh.planId, fresh.expectedRevision, [affected().id])).rejects.toThrow("UNPROTECTED_SECRET");
    expect(await readFile(workspacePath(), "utf8")).toBe(newer);
  });

  it("restores the exact previous workspace when writing the schema update receipt fails", async () => {
    const before = await readFile(workspacePath(), "utf8");
    let workspaceWritten = false;
    const repository = new AgentRepository(root, async (path, content) => {
      if (path.endsWith(".receipt.json")) throw new Error("simulated receipt write failure");
      await atomicWriteFile(path, content);
      if (path === workspacePath()) workspaceWritten = true;
    });
    service = new AgentService(repository, true);
    const plan = await service.preview(await args());
    await expect(service.approveAndApply(plan.planId, plan.expectedRevision, [affected().id]))
      .rejects.toThrow("simulated receipt write failure");
    expect(workspaceWritten).toBe(true);
    expect(await readFile(workspacePath(), "utf8")).toBe(before);
    expect((await readdir(join(root, ".agent"))).some((file) => /\.(approval|receipt)\.json$/.test(file))).toBe(false);
  });

  it("keeps structural property names and refuses redaction that would change a constraint", () => {
    expect(JSON.parse(safeSchemaUpdateText(source(true), [])).components.schemas.Payload.properties.fileName)
      .toEqual({ type: "string", minLength: 1 });
    const document = JSON.parse(source(true));
    document.components.schemas.Payload.properties.fileName.const = "SYNTHETIC_SECRET_LITERAL";
    expect(() => safeSchemaUpdateText(JSON.stringify(document), ["SYNTHETIC_SECRET_LITERAL"]))
      .toThrow("SCHEMA_SOURCE_REDACTION_REQUIRED");
  });

  it("offers a real stdio tool with safe errors and no workspace writes", async () => {
    const before = await readFile(workspacePath(), "utf8");
    const transport = new StdioClientTransport({ command: process.execPath, args: [
      fileURLToPath(new URL("../dist/index.js", import.meta.url)), "mcp", "--allow-apply", "--data-dir", root
    ], stderr: "pipe" });
    const client = new Client({ name: "schema-update-acceptance", version: "1.0.0" });
    const invoke = async <T,>(name: string, params: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: params });
      const { content } = result as { content: Array<{ text: string }> };
      return { error: result.isError, data: JSON.parse(content[0].text) as T };
    };
    try {
      await client.connect(transport);
      const input = await args();
      const method = "preview_openapi_schema_update";
      const argumentsForTool = { text: input.text, targetCollectionId: input.targetCollectionId,
        requestIds: input.requestIds, expectedRevision: input.expectedRevision };
      const result = await invoke<AgentPreview>(method, argumentsForTool);
      expect(result.error).not.toBe(true);
      expect(result.data.schemaUpdate?.affectedRequestIds).toEqual([affected().id]);
      const apply = await invoke<{ code: string }>("apply_plan", {
        planId: result.data.planId, expectedRevision: result.data.expectedRevision
      });
      expect(apply.data.code).toBe("SCHEMA_DESKTOP_REVIEW_REQUIRED");
      const invalid = await invoke<{ code: string }>(method, { ...argumentsForTool, text: '{"password":"DONT_ECHO_THIS" broken}' });
      expect(invalid.data.code).toBe("INVALID_OPENAPI");
      expect(JSON.stringify(invalid)).not.toContain("DONT_ECHO_THIS");
      const unresolved = JSON.parse(input.text);
      delete unresolved.components.schemas.Payload;
      const refError = await invoke<{ code: string }>(method, { ...argumentsForTool, text: JSON.stringify(unresolved) });
      expect(refError.data.code).toBe("SCHEMA_UPDATE_REF_UNRESOLVED");
      expect(await readFile(workspacePath(), "utf8")).toBe(before);
    } finally { await client.close(); }
  }, 20_000);
});
