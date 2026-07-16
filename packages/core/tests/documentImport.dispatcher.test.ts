import { describe, expect, it } from "vitest";
import {
  importDocument,
  importPostmanV3Folder,
  previewImportDocument,
  serializeCollectionJson,
  createCollection
} from "../src";

const importOptions = { grouping: "tags" as const };

describe("document import dispatcher", () => {
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


  it("returns a format-specific message for unsupported Postman and unknown JSON", () => {
    const postmanV1 = JSON.stringify({ id: "old", name: "Old", requests: [] });
    expect(() => previewImportDocument(postmanV1)).toThrow(/Postman collection version/i);
    expect(() => previewImportDocument(JSON.stringify({ hello: "world" }))).toThrow(
      /Supported formats: OpenAPI 3\.x.*Postman Collection v2\.0\/v2\.1.*Insomnia JSON v4\/v5.*HAR 1\.2/i
    );
  });
  it("rejects malformed text after trying JSON, YAML, and supported portable formats", () => {
    expect(() => previewImportDocument("{ definitely not valid json")).toThrow(/Could not parse|YAML/i);
  });
});
