import { describe, expect, it } from "vitest";
import {
  cloneFolder,
  cloneRequest,
  countFolderRequests,
  createCollection,
  createFolder,
  createKeyValue,
  createRequest,
  findFolder,
  removeFolder
} from "../src";

describe("model helpers", () => {
  it("clones a request with fresh ids everywhere", () => {
    const request = createRequest({ name: "Original", method: "POST", url: "{{baseUrl}}/x" });
    request.headers.push(createKeyValue("X-Test", "1"));

    const copy = cloneRequest(request);

    expect(copy.id).not.toBe(request.id);
    expect(copy.name).toBe("Original copy");
    expect(copy.headers[0].id).not.toBe(request.headers[0].id);
    expect(copy.headers[0].key).toBe("X-Test");
  });

  it("clones a folder subtree with fresh ids", () => {
    const folder = createFolder("Parent");
    const child = createFolder("Child");
    child.requests.push(createRequest({ name: "Nested" }));
    folder.folders.push(child);

    const copy = cloneFolder(folder);

    expect(copy.id).not.toBe(folder.id);
    expect(copy.name).toBe("Parent copy");
    expect(copy.folders[0].id).not.toBe(child.id);
    expect(copy.folders[0].requests[0].id).not.toBe(child.requests[0].id);
    expect(copy.folders[0].requests[0].name).toBe("Nested");
  });

  it("removes a nested folder and reports subtree request counts", () => {
    const collection = createCollection("Test");
    const parent = createFolder("Parent");
    const child = createFolder("Child");
    child.requests.push(createRequest({ name: "A" }), createRequest({ name: "B" }));
    parent.requests.push(createRequest({ name: "C" }));
    parent.folders.push(child);
    collection.folders.push(parent);

    expect(countFolderRequests(parent)).toBe(3);

    const removed = removeFolder(collection, child.id);
    expect(removed?.id).toBe(child.id);
    expect(findFolder(collection, child.id)).toBeUndefined();
    expect(countFolderRequests(parent)).toBe(1);
  });
});
