import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { safeAgentError } from "./errors";
import type { AgentService } from "./service";
import packageInfo from "../package.json";

export async function startMcp(service: AgentService): Promise<void> {
  const server = new McpServer({ name: "specfold-local", version: packageInfo.version }, { maxToolInputElements: 200 });
  const result = async (operation: () => Promise<unknown> | unknown) => {
    try { return { content: [{ type: "text" as const, text: JSON.stringify(await operation()) }] }; }
    catch (error) { return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(safeAgentError(error)) }] }; }
  };
  const id = z.string().min(1).max(200);
  const planId = z.string().regex(/^[a-f0-9]{64}$/);
  const readAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  server.registerTool("list_collections", { description: "List saved collections, requests and variable names. Values are never resolved.",
    inputSchema: {}, annotations: readAnnotations }, () => result(() => service.listCollections()));
  server.registerTool("inspect_request", { description: "Inspect a saved request with credentials and common personal data redacted.",
    inputSchema: { collectionId: id, requestId: id }, annotations: readAnnotations },
    ({ collectionId, requestId }) => result(() => service.inspectRequest(collectionId, requestId)));
  server.registerTool("preview_openapi_import", { description: "Preview inline OpenAPI/Swagger text. Does not call the API. Returns an approval-gated plan and revision.",
    inputSchema: { text: z.string().min(1).max(4 * 1024 * 1024), baseUrl: z.string().max(2000).optional(),
      targetCollectionId: id.optional(), apinizer: z.boolean().optional() }, annotations: readAnnotations },
    (args) => result(() => service.preview({ kind: "import-openapi", ...args })));
  server.registerTool("show_diff", { description: "Show the exact plan's non-destructive operation diff; refuses stale revisions.",
    inputSchema: { planId }, annotations: readAnnotations }, ({ planId }) => result(() => service.showDiff(planId)));
  server.registerTool("preview_bind_bearer", { description: "Plan binding a variable NAME, never a token value, to collection/folder/request bearer auth.",
    inputSchema: { collectionId: id, variableName: z.string().regex(/^[a-zA-Z_][\w.-]{0,127}$/), requestId: id.optional(), folderId: id.optional() },
    annotations: readAnnotations }, (args) => result(() => service.preview({ kind: "bind-bearer", ...args })));
  server.registerTool("preview_apinizer_jwt", { description: "Plan a separate origin /auth/jwt recipe with username/password/clientId variable references only.",
    inputSchema: { collectionId: id, baseUrl: z.string().max(2000).optional() }, annotations: readAnnotations },
    (args) => result(() => service.preview({ kind: "create-apinizer", ...args })));
  server.registerTool("apply_plan", { description: "Apply an exact CLI-approved plan while desktop is closed. Disabled unless operator passed --allow-apply.",
    inputSchema: { planId, expectedRevision: planId }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    ({ planId, expectedRevision }) => result(() => service.apply(planId, expectedRevision)));
  server.registerTool("validate_collection", { description: "Check duplicates and missing variable configuration without exposing values or sending requests.",
    inputSchema: { collectionId: id }, annotations: readAnnotations }, ({ collectionId }) => result(() => service.validateCollection(collectionId)));
  server.registerTool("send_request", { description: "Separate network operation: off by default. Requires --allow-network, desktop opt-in, and native human consent for every request.",
    inputSchema: { collectionId: id, requestId: id }, annotations: { readOnlyHint: false, openWorldHint: true } },
    ({ collectionId, requestId }) => result(() => service.sendRequest(collectionId, requestId)));
  await server.connect(new StdioServerTransport());
}
