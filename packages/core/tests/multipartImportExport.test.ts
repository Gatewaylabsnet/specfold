import { describe, expect, it } from "vitest";
import {
  createCollection,
  createMultipartField,
  createRequest,
  exportCollectionToOpenApiResult,
  importDocument,
  parseCollectionJson,
  parseCurlCommand,
  requestToCurl,
  serializeCollectionJson,
  stripTransientUploadData,
  type MultipartField
} from "../src";

const importOptions = { grouping: "singleFolder" as const };
const exportOptions = {
  format: "json" as const,
  useFolderNamesAsTags: true,
  includeRequestExamples: true,
  includeResponseExamples: true,
  includeBearerJwtSecurityScheme: true,
  includeAllComponents: true,
  pruneUnusedComponents: false,
  preferSourceOperation: true
};

describe("multipart portable imports", () => {
  it("creates one disabled placeholder per Postman file in a src array", () => {
    const result = importDocument(JSON.stringify({
      info: {
        name: "Uploads",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
      },
      item: [{
        name: "Upload files",
        request: {
          method: "POST",
          url: "https://api.example.test/upload",
          body: {
            mode: "formdata",
            formdata: [{
              key: "files",
              type: "file",
              src: ["C:/private/first.pdf", "/home/user/second.pdf"]
            }]
          }
        }
      }]
    }), importOptions);

    expect(result.collections[0].requests[0].body.multipart).toEqual([
      expect.objectContaining({
        type: "file",
        key: "files",
        fileName: "first.pdf",
        value: "",
        enabled: false
      }),
      expect.objectContaining({
        type: "file",
        key: "files",
        fileName: "second.pdf",
        value: "",
        enabled: false
      })
    ]);
    expect(JSON.stringify(result.collections[0].requests[0].body)).not.toMatch(/C:\/private|\/home\/user/);
  });

  it("does not serialize non-string Postman file source payloads", () => {
    const result = importDocument(JSON.stringify({
      info: {
        name: "Untrusted uploads",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
      },
      item: [{
        name: "Upload",
        request: {
          method: "POST",
          url: "https://api.example.test/upload",
          body: {
            mode: "formdata",
            formdata: [{
              key: "file",
              type: "file",
              src: { path: "C:/private/report.pdf", content: "embedded-secret-content" }
            }]
          }
        }
      }]
    }), importOptions);

    const serialized = JSON.stringify(result.collections[0].requests[0].body);
    expect(serialized).not.toContain("C:/private");
    expect(serialized).not.toContain("embedded-secret-content");
    expect(result.collections[0].requests[0].body.multipart?.[0]).toMatchObject({
      type: "file",
      fileName: undefined,
      enabled: false
    });
  });

  it("imports Insomnia text fields and safe file placeholders", () => {
    const result = importDocument(JSON.stringify({
      _type: "export",
      __export_format: 5,
      resources: [
        { _id: "wrk", _type: "workspace", name: "Uploads" },
        {
          _id: "req",
          _type: "request",
          parentId: "wrk",
          name: "Upload",
          method: "POST",
          url: "https://api.example.test/upload",
          body: {
            mimeType: "multipart/form-data",
            params: [
              { name: "title", value: "{{ _.title }}", type: "text" },
              {
                name: "attachment",
                type: "file",
                fileName: "C:\\private\\report.pdf",
                contentType: "application/pdf"
              }
            ]
          }
        }
      ]
    }), importOptions);

    const body = result.collections[0].requests[0].body;
    expect(body.mode).toBe("multipart");
    expect(body.multipart?.[0]).toMatchObject({
      type: "text",
      key: "title",
      value: "{{title}}",
      enabled: true
    });
    expect(body.multipart?.[1]).toMatchObject({
      type: "file",
      key: "attachment",
      value: "",
      fileName: "report.pdf",
      contentType: "application/pdf",
      enabled: false
    });
    expect(body.multipart?.[1].uploadId).toBeUndefined();
  });

  it("imports HAR multipart parameters without retaining file paths", () => {
    const result = importDocument(JSON.stringify({
      log: {
        version: "1.2",
        entries: [{
          request: {
            method: "POST",
            url: "https://api.example.test/upload",
            headers: [{ name: "Content-Type", value: "multipart/form-data" }],
            postData: {
              mimeType: "multipart/form-data",
              params: [
                { name: "note", value: "hello" },
                {
                  name: "document",
                  value: "ignored-file-content",
                  fileName: "/home/user/private.txt",
                  contentType: "text/plain"
                }
              ]
            }
          },
          response: { status: 204 }
        }]
      }
    }), importOptions);

    const fields = result.collections[0].requests[0].body.multipart ?? [];
    expect(fields[0]).toMatchObject({ type: "text", key: "note", value: "hello" });
    expect(fields[1]).toMatchObject({
      type: "file",
      key: "document",
      value: "",
      fileName: "private.txt",
      enabled: false
    });
    expect(JSON.stringify(fields)).not.toContain("/home/user");
    expect(JSON.stringify(fields)).not.toContain("ignored-file-content");
  });
});

describe("OpenAPI multipart import and export", () => {
  it("maps binary schemas to disabled placeholders and exports schema only", () => {
    const result = importDocument(JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Upload API", version: "1.0.0" },
      paths: {
        "/upload": {
          post: {
            summary: "Upload document",
            requestBody: {
              required: true,
              content: {
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    properties: {
                      title: { type: "string", example: "Quarterly report" },
                      document: {
                        type: "string",
                        format: "binary",
                        description: "PDF document"
                      }
                    }
                  },
                  encoding: { document: { contentType: "application/pdf" } }
                }
              }
            },
            responses: { "204": { description: "Uploaded" } }
          }
        }
      }
    }), importOptions);

    const request = result.collections[0].folders[0].requests[0];
    expect(request.body.multipart?.[0]).toMatchObject({
      type: "text",
      key: "title",
      value: "Quarterly report",
      enabled: true
    });
    expect(request.body.multipart?.[1]).toMatchObject({
      type: "file",
      key: "document",
      value: "",
      contentType: "application/pdf",
      enabled: false
    });
    expect(request.headers.some((header) => header.key.toLowerCase() === "content-type"))
      .toBe(false);
    expect(result.warnings.join(" ")).toMatch(/select each file manually/i);

    request.body.multipart![1].uploadId = "upload-secret-token";
    request.body.multipart![1].value = "C:\\private\\report.pdf";
    const exported = exportCollectionToOpenApiResult(result.collections[0], exportOptions);
    const media = (exported.document.paths as any)["/upload"].post.requestBody
      .content["multipart/form-data"];

    expect(media.schema.properties).toEqual({
      title: { type: "string", description: undefined },
      document: { type: "string", format: "binary", description: "PDF document" }
    });
    expect(media.example).toEqual({ title: "Quarterly report" });
    expect(media.encoding).toEqual({ document: { contentType: "application/pdf" } });
    expect(exported.content).not.toContain("upload-secret-token");
    expect(exported.content).not.toContain("C:\\\\private");
  });

  it("exports repeated multipart names as arrays without losing file or text parts", () => {
    const collection = createCollection("Repeated fields");
    const request = createRequest({ name: "Upload many", method: "POST", url: "/upload" });
    const firstFile = createMultipartField("file", "files", "");
    firstFile.enabled = false;
    const secondFile = createMultipartField("file", "files", "");
    secondFile.enabled = true;
    const firstLabel = createMultipartField("text", "labels", "front");
    const secondLabel = createMultipartField("text", "labels", "back");
    request.body = {
      mode: "multipart",
      multipart: [firstFile, secondFile, firstLabel, secondLabel]
    };
    collection.requests.push(request);

    const exported = exportCollectionToOpenApiResult(collection, {
      ...exportOptions,
      preferSourceOperation: false
    });
    const media = (exported.document.paths as any)["/upload"].post.requestBody
      .content["multipart/form-data"];

    expect(media.schema.properties.files).toEqual({
      type: "array",
      items: { type: "string", format: "binary" },
      description: undefined
    });
    expect(media.schema.properties.labels).toEqual({
      type: "array",
      items: { type: "string" },
      description: undefined
    });
    expect(media.example.labels).toEqual(["front", "back"]);
    expect(media.example.files).toBeUndefined();
  });

  it("preserves multipart array and required semantics across an OpenAPI round trip", () => {
    const result = importDocument(JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Array upload API", version: "1.0.0" },
      paths: {
        "/upload-many": {
          post: {
            requestBody: {
              required: false,
              content: {
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    required: ["documents"],
                    properties: {
                      documents: {
                        type: "array",
                        items: { type: "string", format: "binary" }
                      },
                      labels: {
                        type: "array",
                        items: { type: "string" },
                        example: ["front", "back"]
                      }
                    }
                  }
                }
              }
            },
            responses: { "204": { description: "Uploaded" } }
          }
        }
      }
    }), importOptions);

    const request = result.collections[0].folders[0].requests[0];
    expect(request.body.required).toBe(false);
    expect(request.body.multipart?.[0]).toMatchObject({
      key: "documents",
      type: "file",
      isArray: true,
      required: true,
      enabled: false
    });
    expect(request.body.multipart?.filter((field) => field.key === "labels")).toEqual([
      expect.objectContaining({ value: "front", isArray: true }),
      expect.objectContaining({ value: "back", isArray: true })
    ]);

    const exported = exportCollectionToOpenApiResult(result.collections[0], exportOptions);
    const requestBody = (exported.document.paths as any)["/upload-many"].post.requestBody;
    expect(requestBody.required).toBe(false);
    expect(requestBody.content["multipart/form-data"].schema).toMatchObject({
      required: ["documents"],
      properties: {
        documents: {
          type: "array",
          items: { type: "string", format: "binary" }
        },
        labels: {
          type: "array",
          items: { type: "string" }
        }
      }
    });
  });

  it("prefers multipart file content over JSON alternatives during OpenAPI import", () => {
    const result = importDocument(JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Mixed upload API", version: "1.0.0" },
      paths: {
        "/upload": {
          post: {
            summary: "Upload with metadata",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      title: { type: "string", example: "JSON fallback" }
                    }
                  }
                },
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    properties: {
                      title: { type: "string", example: "Multipart title" },
                      document: { type: "string", format: "binary" }
                    }
                  }
                }
              }
            },
            responses: { "204": { description: "Uploaded" } }
          }
        }
      }
    }), importOptions);

    const request = result.collections[0].folders[0].requests[0];
    expect(request.body.mode).toBe("multipart");
    expect(request.body.multipart).toEqual([
      expect.objectContaining({
        key: "title",
        type: "text",
        value: "Multipart title",
        enabled: true
      }),
      expect.objectContaining({
        key: "document",
        type: "file",
        value: "",
        enabled: false
      })
    ]);
    expect(result.warnings.join(" ")).toMatch(/select each file manually/i);
  });
});

describe("Swagger 2 formData imports", () => {
  it("imports multipart text and repeated file parameters as safe placeholders", () => {
    const result = importDocument(JSON.stringify({
      swagger: "2.0",
      info: { title: "Legacy uploads", version: "1.0.0" },
      host: "api.example.test",
      consumes: ["multipart/form-data"],
      paths: {
        "/upload": {
          post: {
            summary: "Upload legacy files",
            parameters: [
              { name: "title", in: "formData", type: "string", default: "Report" },
              { name: "files", in: "formData", type: "file", description: "Front page" },
              { name: "files", in: "formData", type: "file", description: "Back page" }
            ],
            responses: { "204": { description: "Uploaded" } }
          }
        }
      }
    }), importOptions);

    const request = result.collections[0].folders[0].requests[0];
    expect(request.body).toMatchObject({ mode: "multipart", contentType: "multipart/form-data" });
    expect(request.body.multipart).toEqual([
      expect.objectContaining({
        type: "text",
        key: "title",
        value: "Report",
        enabled: true
      }),
      expect.objectContaining({
        type: "file",
        key: "files",
        value: "",
        enabled: false
      }),
      expect.objectContaining({
        type: "file",
        key: "files",
        value: "",
        enabled: false
      })
    ]);
    expect(request.headers.some((header) => header.key.toLowerCase() === "content-type"))
      .toBe(false);
    expect(result.warnings.join(" ")).toMatch(/without local paths or contents/i);
  });

  it("keeps Swagger formData urlencoded when multipart is not consumed", () => {
    const result = importDocument(JSON.stringify({
      swagger: "2.0",
      info: { title: "Legacy form", version: "1.0.0" },
      consumes: ["application/x-www-form-urlencoded"],
      paths: {
        "/token": {
          post: {
            parameters: [
              { name: "grant_type", in: "formData", type: "string", default: "password" },
              { name: "username", in: "formData", type: "string", example: "alice" }
            ],
            responses: { "200": { description: "OK" } }
          }
        }
      }
    }), importOptions);

    const body = result.collections[0].folders[0].requests[0].body;
    expect(body.mode).toBe("form");
    expect(body.contentType).toBe("application/x-www-form-urlencoded");
    expect(body.form).toEqual([
      expect.objectContaining({ key: "grant_type", value: "password", enabled: true }),
      expect.objectContaining({ key: "username", value: "alice", enabled: true })
    ]);
  });
});

describe("multipart cURL portability", () => {
  it("parses -F without retaining a local file path", () => {
    const request = parseCurlCommand(
      "curl -F 'title=Report' -F 'file=@C:/private/report.pdf;type=application/pdf' https://api.example.test/upload"
    );

    expect(request.method).toBe("POST");
    expect(request.body.mode).toBe("multipart");
    expect(request.body.multipart?.[0]).toMatchObject({
      type: "text",
      key: "title",
      value: "Report",
      enabled: true
    });
    expect(request.body.multipart?.[1]).toMatchObject({
      type: "file",
      key: "file",
      value: "",
      fileName: "report.pdf",
      contentType: "application/pdf",
      enabled: false
    });
    expect(JSON.stringify(request.body)).not.toContain("C:/private");
  });

  it("renders file parts as explicit placeholders, never local grants or paths", () => {
    const request = createRequest({
      name: "Upload",
      method: "POST",
      url: "https://api.example.test/upload"
    });
    const title = createMultipartField("text", "title", "Report");
    const file = createMultipartField("file", "file", "C:\\private\\secret.pdf");
    file.enabled = true;
    file.fileName = "secret.pdf";
    file.contentType = "application/pdf";
    file.uploadId = "opaque-secret-token";
    request.body = {
      mode: "multipart",
      contentType: "multipart/form-data",
      multipart: [title, file]
    };

    const command = requestToCurl(request);
    expect(command).toContain("--form-string 'title=Report'");
    expect(command).toContain("--form 'file=@<select-file>;filename=secret.pdf;type=application/pdf'");
    expect(command).not.toContain("C:\\private");
    expect(command).not.toContain("opaque-secret-token");
  });

  it("renders text parts with form-string and removes conflicting framing headers", () => {
    const request = createRequest({
      name: "Safe text upload",
      method: "POST",
      url: "https://api.example.test/upload"
    });
    request.headers.push({
      id: "content-type",
      key: "Content-Type",
      value: "application/json",
      enabled: true
    });
    request.headers.push({
      id: "content-length",
      key: "Content-Length",
      value: "123",
      enabled: true
    });
    request.body = {
      mode: "multipart",
      multipart: [createMultipartField("text", "literal", "@/etc/passwd")]
    };

    const command = requestToCurl(request);
    expect(command).toContain("--form-string 'literal=@/etc/passwd'");
    expect(command).not.toContain("Content-Type");
    expect(command).not.toContain("Content-Length");
    expect(parseCurlCommand(command).body.multipart?.[0]).toMatchObject({
      type: "text",
      value: "@/etc/passwd"
    });
  });
});

describe("transient upload sanitization", () => {
  it("returns a clone and strips upload grants, file values, paths, and unknown content", () => {
    const collection = createCollection("Uploads");
    const request = createRequest({ name: "Upload", method: "POST", url: "/upload" });
    const file = {
      ...createMultipartField("file", "file", "base64-file-content"),
      enabled: true,
      uploadId: "opaque-secret-token",
      fileName: "C:\\private\\report.pdf",
      path: "C:\\private\\report.pdf",
      content: "base64-file-content"
    } as MultipartField;
    request.body = { mode: "multipart", multipart: [file] };
    collection.requests.push(request);
    (collection as typeof collection & { collections: unknown[] }).collections = [];

    const sanitized = stripTransientUploadData(collection, { disableFileFields: true });
    const field = sanitized.requests[0].body.multipart![0] as MultipartField & Record<string, unknown>;
    expect(field).toMatchObject({
      type: "file",
      value: "",
      fileName: "report.pdf",
      enabled: false
    });
    expect(field.uploadId).toBeUndefined();
    expect(field.path).toBeUndefined();
    expect(field.content).toBeUndefined();
    expect(collection.requests[0].body.multipart![0].uploadId).toBe("opaque-secret-token");

    const serialized = serializeCollectionJson(collection);
    expect(serialized).not.toContain("opaque-secret-token");
    expect(serialized).not.toContain("base64-file-content");
    expect(serialized).not.toContain("C:\\\\private");
    expect(parseCollectionJson(serialized).requests[0].body.multipart![0].enabled).toBe(false);

    const importedUnsafeDocument = parseCollectionJson(JSON.stringify({
      schema: "specfold.collection.v1",
      exportedAt: new Date().toISOString(),
      collection
    }));
    const importedField = importedUnsafeDocument.requests[0].body.multipart![0];
    expect(importedField).toMatchObject({
      type: "file",
      value: "",
      fileName: "report.pdf",
      enabled: false
    });
    expect(importedField.uploadId).toBeUndefined();
  });
});
