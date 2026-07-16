import { describe, expect, it } from "vitest";
import {
  importDocument,
  importPostmanV3Folder,
  previewImportDocument,
  serializeCollectionJson,
  createCollection
} from "../src";

const importOptions = { grouping: "tags" as const };

describe("portable document imports", () => {
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

  it("imports HAR 1.2 query, form body, and response examples", () => {
    const document = {
      log: {
        version: "1.2",
        pages: [{ id: "page_1", title: "Captured API" }],
        entries: [
          {
            request: {
              method: "POST",
              url: "https://api.example.test/search?q=wheat",
              headers: [{ name: "Content-Type", value: "application/x-www-form-urlencoded" }],
              queryString: [{ name: "q", value: "wheat" }],
              postData: {
                mimeType: "application/x-www-form-urlencoded",
                params: [{ name: "page", value: "1" }]
              }
            },
            response: {
              status: 200,
              statusText: "OK",
              headers: [{ name: "Content-Type", value: "application/json" }],
              content: {
                mimeType: "application/json",
                text: "eyJpdGVtcyI6W119",
                encoding: "base64"
              }
            }
          }
        ]
      }
    };

    const result = importDocument(JSON.stringify(document), importOptions);
    const request = result.collections[0].requests[0];

    expect(result.kind).toBe("har");
    expect(result.preview).toMatchObject({ label: "HAR", version: "1.2" });
    expect(request.url).toBe("https://api.example.test/search");
    expect(request.queryParams[0]).toMatchObject({ key: "q", value: "wheat" });
    expect(request.body.mode).toBe("form");
    expect(request.body.form?.[0]).toMatchObject({ key: "page", value: "1" });
    expect(request.responseExamples[0]).toMatchObject({ status: 200, body: "{\"items\":[]}" });
  });

  it("keeps OpenAPI and Specfold Collection JSON imports on the same dispatcher", () => {
    const openApi = {
      openapi: "3.0.3",
      info: { title: "Example API", version: "1.0.0" },
      paths: {
        "/health": { get: { responses: { "200": { description: "OK" } } } }
      }
    };
    const openApiResult = importDocument(JSON.stringify(openApi), importOptions);
    expect(openApiResult.kind).toBe("openapi3");
    expect(openApiResult.preview.requestCount).toBe(1);

    const collection = createCollection("Native collection");
    const nativeText = serializeCollectionJson(collection);
    const nativeResult = importDocument(nativeText, importOptions);
    expect(nativeResult.kind).toBe("collection-json");
    expect(nativeResult.collections[0].name).toBe("Native collection");
  });

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

  it("returns a format-specific message for unsupported Postman and unknown JSON", () => {
    const postmanV1 = JSON.stringify({ id: "old", name: "Old", requests: [] });
    expect(() => previewImportDocument(postmanV1)).toThrow(/Postman collection version/i);
    expect(() => previewImportDocument(JSON.stringify({ hello: "world" }))).toThrow(
      /Supported formats: OpenAPI 3\.x.*Postman Collection v2\.0\/v2\.1.*Insomnia JSON v4\/v5.*HAR 1\.2/i
    );
  });
});
