import { describe, expect, it } from "vitest";
import {
  importDocument,
  importPostmanV3Folder,
  previewImportDocument,
  serializeCollectionJson,
  createCollection
} from "../src";

const importOptions = { grouping: "tags" as const };

describe("Postman imports", () => {
  it.each(["2.0.0", "2.1.0"])("imports Postman Collection v%s folders, variables, auth, bodies, and responses", (version) => {
    const document = {
      info: {
        _postman_id: "collection-id",
        name: "DATS CKS",
        description: "Postman sample",
        schema: `https://schema.getpostman.com/json/collection/v${version}/collection.json`
      },
      auth: {
        type: "bearer",
        bearer: [{ key: "token", value: "{{bearerToken}}", type: "string" }]
      },
      variable: [
        { key: "baseUrl", value: "https://api.example.test/v1" },
        { key: "bearerToken", value: "", type: "secret" }
      ],
      item: [
        {
          name: "Products",
          item: [
            {
              name: "Get products",
              request: {
                method: "GET",
                header: version === "2.0.0"
                  ? "Accept: application/json"
                  : [{ key: "Accept", value: "application/json" }],
                url: {
                  raw: "{{baseUrl}}/products?limit=10",
                  query: [{ key: "limit", value: "10" }]
                }
              },
              response: [
                {
                  name: "OK",
                  code: 200,
                  header: [{ key: "Content-Type", value: "application/json" }],
                  body: "{\"items\":[]}"
                }
              ]
            }
          ]
        },
        {
          name: "JWT token",
          request: {
            method: "POST",
            auth: { type: "noauth" },
            body: {
              mode: "urlencoded",
              urlencoded: [
                { key: "grant_type", value: "password", type: "text" },
                { key: "username", value: "{{username}}", type: "text" }
              ]
            },
            url: "https://api.example.test/auth/jwt"
          }
        }
      ]
    };

    const result = importDocument(JSON.stringify(document), importOptions);
    const collection = result.collections[0];
    const productRequest = collection.folders[0].requests[0];
    const tokenRequest = collection.requests[0];

    expect(result.kind).toBe("postman");
    expect(result.preview).toMatchObject({ label: "Postman Collection", version });
    expect(result.preview.requestCount).toBe(2);
    expect(collection.name).toBe("DATS CKS");
    expect(collection.baseUrl).toBe("https://api.example.test/v1");
    expect(productRequest.url).toBe("{{baseUrl}}/products");
    expect(productRequest.queryParams[0]).toMatchObject({ key: "limit", value: "10" });
    expect(productRequest.auth).toEqual({ type: "bearer", token: "{{bearerToken}}" });
    expect(productRequest.responseExamples[0]).toMatchObject({ status: 200, contentType: "application/json" });
    expect(tokenRequest.auth).toEqual({ type: "none" });
    expect(tokenRequest.body.mode).toBe("form");
    expect(tokenRequest.body.form?.map((item) => item.key)).toEqual(["grant_type", "username"]);
    expect(result.environments[0].variables).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "baseUrl", value: "https://api.example.test/v1" }),
      expect.objectContaining({ name: "bearerToken", secret: true })
    ]));
  });


  it("keeps multipart text fields editable and disables file placeholders", () => {
    const document = {
      info: {
        name: "Uploads",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
      },
      item: [{
        name: "Upload document",
        request: {
          method: "POST",
          url: "https://api.example.test/upload",
          body: {
            mode: "formdata",
            formdata: [
              { key: "title", value: "Report", type: "text" },
              { key: "file", type: "file", src: "C:/private/report.pdf" }
            ]
          }
        }
      }]
    };

    const result = importDocument(JSON.stringify(document), importOptions);
    const fields = result.collections[0].requests[0].body.form ?? [];
    expect(fields[0]).toMatchObject({ key: "title", value: "Report", enabled: true });
    expect(fields[1]).toMatchObject({ key: "file", value: "report.pdf", enabled: false });
    expect(result.warnings.join(" ")).toMatch(/multipart form-data.*file entries require manual review/i);
  });


  it("imports a Postman v3 multi-file YAML folder with metadata, hierarchy, and examples", () => {
    const result = importPostmanV3Folder({
      rootName: "fallback",
      skippedScriptCount: 1,
      files: [
        {
          path: ".resources/definition.yaml",
          content: `schemaVersion: "3.0"\nname: Store API\nvariables:\n  baseUrl: https://store.example.test\n`
        },
        {
          path: "Products/.resources/definition.yaml",
          content: `name: Products\norder: 10\n`
        },
        {
          path: "Products/List.request.yaml",
          content: `
name: List products
$kind: http-request
method: GET
url: "{{baseUrl}}/products?limit=5"
headers:
  - key: Accept
    value: application/json
order: 20
`
        },
        {
          path: "Products/List.resources/examples/OK.yaml",
          content: `name: OK\nstatusCode: 200\nheaders:\n  - key: Content-Type\n    value: application/json\nbody: '{"items":[]}'\n`
        }
      ]
    });
    const collection = result.collections[0];
    const request = collection.folders[0].requests[0];

    expect(result.preview).toMatchObject({ label: "Postman Collection folder", version: "3.0.0", format: "yaml" });
    expect(collection.name).toBe("Store API");
    expect(collection.folders[0].name).toBe("Products");
    expect(request).toMatchObject({ method: "GET", url: "{{baseUrl}}/products" });
    expect(request.queryParams[0]).toMatchObject({ key: "limit", value: "5" });
    expect(request.responseExamples[0]).toMatchObject({ name: "OK", status: 200, body: '{"items":[]}' });
    expect(result.environments[0].variables[0]).toMatchObject({ name: "baseUrl", value: "https://store.example.test" });
    expect(result.warnings.join(" ")).toMatch(/script file/i);
  });

  it("keeps valid v3 requests when another YAML file is malformed", () => {
    const result = importPostmanV3Folder({
      rootName: "Resilient",
      files: [
        { path: "broken.request.yaml", content: "name: [unterminated" },
        { path: "valid.request.yaml", content: "name: Valid\nmethod: GET\nurl: https://example.test" }
      ]
    });
    expect(result.preview.requestCount).toBe(1);
    expect(result.collections[0].requests[0].name).toBe("Valid");
    expect(result.warnings.join(" ")).toMatch(/Skipped broken\.request\.yaml/i);
  });
});
