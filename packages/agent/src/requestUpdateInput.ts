import { z } from "zod";

function inputContracts(strict: boolean) {
  // MCP SDK formats validation errors before invoking our handler. Preserve
  // unknown keys through discovery validation so the strict service decoder
  // can reject them without reflecting arbitrary key text into MCP responses.
  const record = <T extends z.ZodRawShape>(shape: T) =>
    strict ? z.object(shape).strict() : z.object(shape).passthrough();
  const id = z.string().min(1).max(200);
  const expectedRevision = z.string().regex(/^[a-f0-9]{64}$/);
  const value = z.string().max(8192);
  const name = z.string().min(1).max(128);
  const headerTarget = z.union([record({ id }), record({ name })]);
  const headerEdit = z.discriminatedUnion("op", [
    record({ op: z.literal("add"), name, value, enabled: z.boolean().optional() }),
    record({ op: z.literal("set-value"), target: headerTarget, value }),
    record({ op: z.literal("set-enabled"), target: headerTarget, enabled: z.boolean() }),
    record({ op: z.literal("remove"), target: headerTarget })
  ]);
  const path = z.string().max(2048);
  const jsonValue = z.unknown().refine((input) => input !== undefined, "A JSON value is required.");
  const patch = z.union([
    record({ op: z.enum(["add", "replace"]), path, value: jsonValue }),
    record({ op: z.literal("remove"), path })
  ]);
  const contentType = z.string().min(1).max(256).optional();
  const fields = z.array(record({ key: z.string().min(1).max(256), value: z.string().max(256 * 1024),
    enabled: z.boolean().optional() })).max(100);
  const body = z.union([
    record({ op: z.literal("clear") }),
    record({ op: z.literal("patch-json"), patch: z.array(patch).min(1).max(64) }),
    record({ op: z.literal("replace"), mode: z.literal("json"), value: jsonValue, contentType }),
    record({ op: z.literal("replace"), mode: z.literal("raw"), value: z.string().max(256 * 1024), contentType }),
    record({ op: z.literal("replace"), mode: z.enum(["form", "multipart"]), fields, contentType })
  ]);
  const edit = { requestId: id, body: body.optional(), headers: z.array(headerEdit).min(1).max(64).optional() };
  const schemaUpdate = record({
    text: z.string().min(1).max(4 * 1024 * 1024),
    requestIds: z.array(id).min(1).max(500).refine((ids) => new Set(ids).size === ids.length)
  }).optional();
  const context = { collectionId: id, expectedRevision, schemaUpdate };

  const batchShape = {
    ...context,
    updates: z.array(record(edit).refine((input) => input.body !== undefined || input.headers !== undefined))
      .min(1).max(25).refine((updates) => new Set(updates.map(({ requestId }) => requestId)).size === updates.length)
  };
  return {
    batchShape,
    batch: record(batchShape),
    single: record({ ...context, ...edit }).refine((input) => input.body !== undefined || input.headers !== undefined)
  };
}

const mcp = inputContracts(false);
export const singleRequestUpdateInput = mcp.single;
export const batchRequestUpdateInput = mcp.batch;
export const batchRequestUpdateShape = inputContracts(true).batchShape;
