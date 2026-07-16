import { describe, expect, it } from "vitest";
import {
  importDocument,
  importPostmanV3Folder,
  previewImportDocument,
  serializeCollectionJson,
  createCollection
} from "../src";

const importOptions = { grouping: "tags" as const };

describe("Insomnia imports", () => {
  it("imports Insomnia JSON v4/v5 workspace structure and normalizes variables", () => {
    const document = {
      _type: "export",
      __export_format: 5,
      resources: [
        { _id: "wrk_1", _type: "workspace", name: "Orders API", description: "Workspace" },
        { _id: "env_1", _type: "environment", parentId: "wrk_1", name: "Base Environment", data: { baseUrl: "https://orders.example.test", apiToken: "secret", tenant: { id: "acme" } } },
        { _id: "fld_1", _type: "request_group", parentId: "wrk_1", name: "Orders" },
        {
          _id: "req_1",
          _type: "request",
          parentId: "fld_1",
          name: "Create order",
          method: "POST",
          url: "{{ _.baseUrl }}/orders?dryRun=true",
          parameters: [{ name: "dryRun", value: "true" }],
          headers: [{ name: "Content-Type", value: "application/json" }],
          authentication: { type: "bearer", token: "{{ _.apiToken }}" },
          body: { mimeType: "application/json", text: "{\"sku\":\"ABC\"}" }
        },
        {
          _id: "res_1",
          _type: "response",
          parentId: "req_1",
          statusCode: 201,
          statusMessage: "Created",
          headers: [{ name: "Content-Type", value: "application/json" }],
          body: "{\"id\":1}"
        }
      ]
    };

    const result = importDocument(JSON.stringify(document), importOptions);
    const request = result.collections[0].folders[0].requests[0];

    expect(result.kind).toBe("insomnia");
    expect(result.preview).toMatchObject({ label: "Insomnia JSON", version: "v5" });
    expect(request.url).toBe("{{baseUrl}}/orders");
    expect(request.queryParams[0]).toMatchObject({ key: "dryRun", value: "true" });
    expect(request.auth).toEqual({ type: "bearer", token: "{{apiToken}}" });
    expect(request.body).toMatchObject({ mode: "json", contentType: "application/json" });
    expect(request.responseExamples[0]).toMatchObject({ status: 201, name: "Created" });
    expect(result.environments[0].variables).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "baseUrl", value: "https://orders.example.test" }),
      expect.objectContaining({ name: "apiToken", secret: true }),
      expect.objectContaining({ name: "tenant.id", value: "acme" })
    ]));
  });

  it("breaks cyclic folder parents and warns about unsupported request data", () => {
    const document = {
      _type: "export",
      __export_format: 4,
      resources: [
        { _id: "wrk", _type: "workspace", name: "Cyclic" },
        { _id: "a", _type: "request_group", parentId: "b", name: "A" },
        { _id: "b", _type: "request_group", parentId: "a", name: "B" },
        { _id: "req", _type: "request", parentId: "a", name: "Socket request", method: "CONNECT", url: "https://example.test" }
      ]
    };
    const result = importDocument(JSON.stringify(document), importOptions);
    expect(result.collections[0].folders.map((folder) => folder.name).sort()).toEqual(["A", "B"]);
    expect(result.preview.requestCount).toBe(0);
    expect(result.warnings.join(" ")).toMatch(/unsupported HTTP method/i);
  });
});
