import { describe, expect, it } from "vitest";
import { flattenRequests, importApiDocument, listOperations } from "../src";

const OPENAPI_TEXT = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Pick API", version: "1.0.0" },
  paths: {
    "/users": {
      get: { tags: ["Users"], summary: "List users", responses: { "200": { description: "ok" } } },
      post: { tags: ["Users"], summary: "Create user", responses: { "201": { description: "ok" } } }
    },
    "/auth/token": {
      post: { tags: ["Auth"], summary: "Get token", responses: { "200": { description: "ok" } } }
    }
  }
});

const SWAGGER_TEXT = JSON.stringify({
  swagger: "2.0",
  info: { title: "Pick API v2", version: "1.0.0" },
  paths: {
    "/pets": {
      get: { summary: "List pets", responses: { "200": { description: "ok" } } },
      post: { summary: "Create pet", responses: { "201": { description: "ok" } } }
    }
  }
});

describe("listOperations", () => {
  it("lists every operation with key, method, path, and summary", () => {
    const operations = listOperations(OPENAPI_TEXT);
    expect(operations).toHaveLength(3);
    expect(operations.map((operation) => operation.key)).toEqual([
      "get /users",
      "post /users",
      "post /auth/token"
    ]);
    expect(operations[0]).toMatchObject({
      method: "GET",
      path: "/users",
      summary: "List users",
      tags: ["Users"]
    });
  });

  it("works for Swagger 2.0 documents", () => {
    const operations = listOperations(SWAGGER_TEXT);
    expect(operations.map((operation) => operation.key)).toEqual(["get /pets", "post /pets"]);
  });
});

describe("selective import via operationKeys", () => {
  it("imports only the selected OpenAPI operations", () => {
    const result = importApiDocument(OPENAPI_TEXT, {
      grouping: "tags",
      operationKeys: ["get /users", "post /auth/token"]
    });
    const names = flattenRequests(result.collection).map(({ request }) => request.name);
    expect(names.sort()).toEqual(["Get token", "List users"]);
    // The folder for the deselected-only tag still comes from selected ops only.
    expect(result.collection.folders.map((folder) => folder.name).sort()).toEqual([
      "Auth",
      "Users"
    ]);
  });

  it("imports only the selected Swagger operations", () => {
    const result = importApiDocument(SWAGGER_TEXT, {
      grouping: "singleFolder",
      operationKeys: ["post /pets"]
    });
    const requests = flattenRequests(result.collection);
    expect(requests).toHaveLength(1);
    expect(requests[0].request.method).toBe("POST");
  });

  it("imports everything when operationKeys is undefined", () => {
    const result = importApiDocument(OPENAPI_TEXT, { grouping: "tags" });
    expect(flattenRequests(result.collection)).toHaveLength(3);
  });
});
