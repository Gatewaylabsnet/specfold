import { describe, expect, it } from "vitest";
import {
  checkOpenApiDocument,
  createCollection,
  createFolder,
  createRequest,
  findFolder,
  relocateFolder,
  relocateRequest
} from "../src";

describe("relocateRequest", () => {
  it("moves a request into a folder", () => {
    const collection = createCollection("C");
    const folder = createFolder("Target");
    collection.folders.push(folder);
    const request = createRequest({ name: "A" });
    collection.requests.push(request);

    const moved = relocateRequest(collection, request.id, folder.id, null);

    expect(moved).toBe(true);
    expect(collection.requests).toHaveLength(0);
    expect(folder.requests[0].id).toBe(request.id);
  });

  it("reorders a request before a sibling", () => {
    const collection = createCollection("C");
    const a = createRequest({ name: "A" });
    const b = createRequest({ name: "B" });
    const c = createRequest({ name: "C" });
    collection.requests.push(a, b, c);

    relocateRequest(collection, c.id, null, a.id);

    expect(collection.requests.map((request) => request.name)).toEqual(["C", "A", "B"]);
  });
});

describe("relocateFolder", () => {
  it("moves a folder under another folder", () => {
    const collection = createCollection("C");
    const parent = createFolder("Parent");
    const mover = createFolder("Mover");
    collection.folders.push(parent, mover);

    const moved = relocateFolder(collection, mover.id, parent.id, null);

    expect(moved).toBe(true);
    expect(collection.folders.map((folder) => folder.name)).toEqual(["Parent"]);
    expect(findFolder(collection, mover.id)).toBeDefined();
    expect(parent.folders[0].id).toBe(mover.id);
  });

  it("refuses to move a folder into its own descendant", () => {
    const collection = createCollection("C");
    const parent = createFolder("Parent");
    const child = createFolder("Child");
    parent.folders.push(child);
    collection.folders.push(parent);

    const moved = relocateFolder(collection, parent.id, child.id, null);

    expect(moved).toBe(false);
    // The tree is unchanged.
    expect(collection.folders[0].id).toBe(parent.id);
    expect(collection.folders[0].folders[0].id).toBe(child.id);
  });
});

describe("checkOpenApiDocument", () => {
  it("accepts a minimal valid document", () => {
    const result = checkOpenApiDocument({
      openapi: "3.0.3",
      info: { title: "T", version: "1.0.0" },
      paths: { "/x": { get: { responses: { "200": { description: "ok" } } } } }
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("flags missing fields, empty paths, and {{variables}}", () => {
    const result = checkOpenApiDocument({
      openapi: "3.0.3",
      info: { title: "T", version: "1.0.0" },
      servers: [{ url: "{{baseUrl}}" }],
      paths: { "/{{id}}": { get: {} } }
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.includes("server"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("{{variable}}"))).toBe(true);
    expect(result.issues.some((issue) => issue.includes("no responses"))).toBe(true);
  });
});
