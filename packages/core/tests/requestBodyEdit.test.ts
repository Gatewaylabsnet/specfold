import { describe, expect, it } from "vitest";
import { createRequest } from "../src/model/factory";
import type { RequestBody } from "../src/model/types";
import { applyRequestBodyEdit, type JsonBodyPatch, type RequestBodyEdit } from "../src/agent/requestBodyEdit";

const saved = (body: RequestBody) => ({ ...createRequest({ name: "Synthetic operation", method: "POST" }), body });
const json = (raw: string, schema: unknown = undefined) =>
  saved({ mode: "json", contentType: "application/json", raw, schema, required: true });

describe("MCP body edit primitives", () => {
  it("patches JSON structurally, preserves unrelated input and schema, and keeps values out of the summary", () => {
    const schema = { type: "object", required: ["requestHeader"], properties: { requestHeader: { type: "object" } } };
    const request = json('{"requestHeader":{"keepOutOfDiff":"literal"},"filter":{"id":47},"auth":"{{ref}}","a/b":{"~x":[1,3]}}', schema);
    const edits: JsonBodyPatch[] = [
      { op: "remove", path: "/requestHeader" },
      { op: "add", path: "/a~1b/~0x/1", value: 2 },
      { op: "replace", path: "/filter/id", value: 49 },
      { op: "add", path: "/a~1b/~0x/-", value: 4 }
    ];
    const result = applyRequestBodyEdit(request, { op: "patch-json", patch: edits });
    expect(JSON.parse(result.body.raw!)).toEqual({ filter: { id: 49 }, auth: "{{ref}}", "a/b": { "~x": [1, 2, 3, 4] } });
    expect(JSON.parse(request.body.raw!)).toHaveProperty("requestHeader");
    expect(result.body.schema).toEqual(schema);
    expect(result.body.required).toBe(true);
    expect(result.warnings).toContain("The proposed JSON does not satisfy the retained OpenAPI schema. No schema was edited.");
    expect(JSON.stringify(result.changes)).not.toContain("keepOutOfDiff");
    expect(JSON.stringify(result.changes)).not.toContain("{{ref}}");
  });

  it("uses three distinct actions for body removal, blank text, and JSON member removal", () => {
    const request = json('{"remove":2,"retain":"x"}');
    const clear = applyRequestBodyEdit(request, { op: "clear" });
    expect(clear.body).toMatchObject({ mode: "none", contentType: "application/json", required: true });
    expect(clear.body.raw).toBeUndefined();
    const blank = applyRequestBodyEdit(request, { op: "replace", mode: "raw", value: "" });
    expect(blank.body).toMatchObject({ mode: "raw", raw: "", contentType: "application/json" });
    expect(blank.changes.map(({ scope }) => scope)).toContain("Body type");
    const removed = applyRequestBodyEdit(request, { op: "patch-json", patch: [{ op: "remove", path: "/remove" }] });
    expect(JSON.parse(removed.body.raw!)).toEqual({ retain: "x" });
    const noChange = applyRequestBodyEdit(request, { op: "patch-json", patch: [{ op: "replace", path: "/retain", value: "x" }] });
    expect(noChange.body.raw).toBe(request.body.raw);
    expect(noChange.changes).toEqual([]);
  });

  it.each([
    ["{", "/name", "REQUEST_BODY_INVALID"],
    ['{"n":9007199254740993,"name":"x"}', "/name", "REQUEST_BODY_INVALID"],
    ['{"n":0.123456789012345678901,"name":"x"}', "/name", "REQUEST_BODY_INVALID"],
    ['{"a":[1],"a":[2],"name":"x"}', "/name", "REQUEST_BODY_INVALID"],
    ['{"a":[1]}', "/a/01", "REQUEST_BODY_PATCH_INVALID"],
    ['{"a":[1]}', "/a/-", "REQUEST_BODY_PATCH_INVALID"],
    ['{"a":[1]}', "/a/10", "REQUEST_BODY_PATCH_INVALID"],
    ['{"a":[1]}', "/a~2", "REQUEST_BODY_PATCH_INVALID"],
    ['{"safe":true}', "/__proto__/pollution", "REQUEST_BODY_PATCH_INVALID"],
    ['{"safe":true}', "/a/constructor", "REQUEST_BODY_PATCH_INVALID"],
    ['{"safe":true}', "/missing", "REQUEST_BODY_PATCH_INVALID"],
    ['{"safe":true}', "", "REQUEST_BODY_PATCH_INVALID"],
    ["enc:v1:ciphertext", "/field", "REQUEST_BODY_OPAQUE"]
  ])("does not silently modify invalid saved bodies or pointers: %s %s", (raw, path, code) => {
    expect(() => applyRequestBodyEdit(json(raw), { op: "patch-json", patch: [{ op: "remove", path }] })).toThrow(code);
  });

  it.each<RequestBodyEdit>([
    { op: "replace", mode: "json", value: { nested: { password: "FAKE_SECRET" } } },
    { op: "patch-json", patch: [{ op: "replace", path: "/password", value: "FAKE_SECRET" }] },
    { op: "replace", mode: "form", fields: [{ key: "X-Api-Key", value: "FAKE_SECRET" }] },
    { op: "replace", mode: "multipart", fields: [{ key: "Authorization", value: "Bearer FAKE_SECRET" }] },
    { op: "replace", mode: "raw", value: "<root><apiKey>FAKE_SECRET</apiKey></root>" },
    { op: "replace", mode: "raw", value: "password=FAKE_SECRET" },
    { op: "replace", mode: "raw", value: "password%20ignored=anything&%70assword=FAKE_SECRET" }
  ])("rejects credential literals in supplied data: %s", (edit) => {
    expect(() => applyRequestBodyEdit(json('{"password":"{{oldPassword}}"}'), edit))
      .toThrow(/^REQUEST_BODY_SECRET_REFERENCE_REQUIRED$/);
  });

  it("allows existing credential references and refuses to invent them", () => {
    const edit: RequestBodyEdit = { op: "patch-json", patch: [{ op: "replace", path: "/password", value: "{{safePassword}}" }] };
    expect(() => applyRequestBodyEdit(json('{"password":"{{old}}"}'), edit, {}, () => false)).toThrow("REQUEST_BODY_SECRET_REFERENCE_REQUIRED");
    expect(applyRequestBodyEdit(json('{"password":"{{old}}"}'), edit, {}, (name) => name === "safePassword").body.raw).toContain("{{safePassword}}");
  });

  it("replaces URL-encoded/multipart text deterministically without reading file data", () => {
    const placeholder = { id: "existing", key: "attachment", type: "file" as const, value: "", enabled: false, fileName: "document.pdf" };
    const request = saved({ mode: "multipart", multipart: [placeholder, { id: "existing-text", key: "name", type: "text", value: "before", enabled: false }] });
    const input = { op: "replace" as const, mode: "multipart" as const, fields: [{ key: "name", value: "after" }, { key: "extra", value: "ok" }] };
    const result = applyRequestBodyEdit(request, input);
    expect(result).toEqual(applyRequestBodyEdit(request, input));
    expect(result.body.multipart).toEqual([placeholder, expect.objectContaining({ id: "existing-text", value: "after", enabled: false }),
      expect.objectContaining({ type: "text", key: "extra" })]);
    const urlencoded = applyRequestBodyEdit(request, { op: "replace", mode: "form", fields: [{ key: "name", value: "form" }] });
    expect(urlencoded.body.multipart).toBeUndefined();
    expect(urlencoded.body.form).toEqual([expect.objectContaining({ key: "name", value: "form" })]);
    expect(urlencoded.changes.map(({ message }) => message)).toContain("The replacement removes the existing multipart file placeholders; no file is read or sent.");
  });
});
