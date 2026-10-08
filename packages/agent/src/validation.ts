import { z } from "zod";
import type { Workspace } from "@openapi-collection-studio/core";
import { AgentError } from "./errors";

const id = z.string().min(1).max(200);
export const mutationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("import-openapi"), text: z.string().min(1).max(4 * 1024 * 1024),
    baseUrl: z.string().max(2000).optional(), targetCollectionId: id.optional(), apinizer: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("bind-bearer"), collectionId: id, variableName: z.string().regex(/^[a-zA-Z_][\w.-]{0,127}$/),
    requestId: id.optional(), folderId: id.optional() }).strict(),
  z.object({ kind: z.literal("create-apinizer"), collectionId: id, baseUrl: z.string().max(2000).optional() }).strict()
]);

const kv = z.object({ id, key: z.string(), value: z.string(), enabled: z.boolean() }).passthrough();
const auth = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }).passthrough(),
  z.object({ type: z.literal("bearer"), token: z.string() }).passthrough(),
  z.object({ type: z.literal("basic"), username: z.string(), password: z.string() }).passthrough(),
  z.object({ type: z.literal("apiKey"), key: z.string(), value: z.string(), in: z.enum(["header", "query"]) }).passthrough()
]);
const request = z.object({ id, name: z.string(), method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]),
  url: z.string(), queryParams: z.array(kv), pathParams: z.array(kv), headers: z.array(kv),
  body: z.object({ mode: z.enum(["none", "json", "raw", "form", "multipart"]), raw: z.string().optional(), form: z.array(kv).optional(),
    multipart: z.array(z.object({ id, key: z.string(), enabled: z.boolean(), type: z.enum(["text", "file"]), value: z.string().optional() }).passthrough()).optional()
  }).passthrough(), auth,
  responseExamples: z.array(z.object({ id, name: z.string(), status: z.number(), headers: z.array(kv), body: z.string().optional() }).passthrough())
}).passthrough();

export function validateAgentWorkspace(value: unknown): Workspace {
  // Bound depth/node count before recursive traversal or importer code sees data.
  let count = 0;
  const walk = (node: unknown, depth = 0) => {
    if (++count > 300_000 || depth > 80) throw new AgentError("INVALID_WORKSPACE");
    if (node && typeof node === "object") for (const [key, item] of Object.entries(node)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new AgentError("INVALID_WORKSPACE");
      walk(item, depth + 1);
    }
  };
  walk(value);
  const root = z.object({ id, name: z.string(), schemaVersion: z.literal(1), updatedAt: z.string(),
    collections: z.array(z.object({ id, name: z.string(), baseUrl: z.string().optional(), folders: z.array(z.unknown()), requests: z.array(request) }).passthrough()),
    environments: z.array(z.object({ id, name: z.string(), variables: z.array(z.object({
      id, name: z.string(), value: z.string(), enabled: z.boolean(), secret: z.boolean().optional()
    }).passthrough()) }).passthrough())
  }).passthrough().safeParse(value);
  if (!root.success) throw new AgentError("INVALID_WORKSPACE");
  const seenIds = new Set<string>();
  const checkId = (item: { id: string }) => {
    if (seenIds.has(item.id)) throw new AgentError("INVALID_WORKSPACE");
    seenIds.add(item.id);
  };
  const folderSchema = z.object({ id, name: z.string(), baseUrl: z.string().optional(), folders: z.array(z.unknown()), requests: z.array(request) }).passthrough();
  const checkFolders = (folders: unknown[], depth = 0) => {
    if (depth > 30) throw new AgentError("INVALID_WORKSPACE");
    for (const input of folders) {
      const parsed = folderSchema.safeParse(input);
      if (!parsed.success) throw new AgentError("INVALID_WORKSPACE");
      checkId(parsed.data); parsed.data.requests.forEach(checkId);
      checkFolders(parsed.data.folders, depth + 1);
    }
  };
  for (const collection of root.data.collections) {
    checkId(collection); collection.requests.forEach(checkId); checkFolders(collection.folders);
  }
  root.data.environments.forEach(checkId);
  return value as Workspace; // Preserve unknown fields and the existing schema exactly.
}
