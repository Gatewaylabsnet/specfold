import { describe, expect, it } from "vitest";
import {
  importDocument,
  importPostmanV3Folder,
  previewImportDocument,
  serializeCollectionJson,
  createCollection
} from "../src";

const importOptions = { grouping: "tags" as const };

describe("HTTP file imports", () => {
  it("imports shared .http/.rest syntax, variables, headers, query strings, and bodies", () => {
    const text = `
@baseUrl = https://api.example.test
@token = secret

### List products
GET {{baseUrl}}/products?limit=10 HTTP/1.1
Accept: application/json
Authorization: Bearer {{token}}

### Create product
# @name createProduct
POST {{baseUrl}}/products
Content-Type: application/json

{"name":"Wheat"}
`;
    const result = importDocument(text, importOptions);
    const [list, create] = result.collections[0].requests;

    expect(result.kind).toBe("http-file");
    expect(result.preview).toMatchObject({ format: "text", requestCount: 2 });
    expect(list).toMatchObject({ name: "List products", method: "GET", url: "{{baseUrl}}/products" });
    expect(list.queryParams[0]).toMatchObject({ key: "limit", value: "10" });
    expect(list.auth).toEqual({ type: "bearer", token: "{{token}}" });
    expect(create).toMatchObject({ name: "createProduct", method: "POST", url: "{{baseUrl}}/products" });
    expect(create.body).toMatchObject({ mode: "json", contentType: "application/json" });
    expect(result.environments[0].variables).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "baseUrl", value: "https://api.example.test" }),
      expect.objectContaining({ name: "token", secret: true })
    ]));
  });

  it("reports malformed sections and refuses documents without a supported request", () => {
    const result = importDocument(`### broken\nnot a request\n\n### valid\nGET https://example.test/ok`, importOptions);
    expect(result.collections[0].requests).toHaveLength(1);
    expect(result.warnings.join(" ")).toMatch(/no supported request line/i);
    expect(() => importDocument("### only comments\n# nothing here", importOptions)).toThrow();
  });
});
