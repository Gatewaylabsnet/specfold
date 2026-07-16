import { describe, expect, it } from "vitest";
import {
  importDocument,
  importPostmanV3Folder,
  previewImportDocument,
  serializeCollectionJson,
  createCollection
} from "../src";

const importOptions = { grouping: "tags" as const };

describe("HAR imports", () => {
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

  it("skips malformed entries without aborting valid HAR requests", () => {
    const result = importDocument(JSON.stringify({
      log: {
        version: "1.2",
        entries: [
          { request: { method: "GET" }, response: {} },
          { request: { method: "TRACE", url: "https://example.test/trace" }, response: {} },
          { request: { method: "GET", url: "https://example.test/ok" }, response: { status: 204 } }
        ]
      }
    }), importOptions);
    expect(result.collections[0].requests).toHaveLength(1);
    expect(result.collections[0].requests[0].url).toBe("https://example.test/ok");
    expect(result.warnings.join(" ")).toMatch(/without a request URL.*unsupported HTTP method/is);
  });
});
