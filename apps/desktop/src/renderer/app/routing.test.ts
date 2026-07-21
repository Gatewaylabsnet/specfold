import { describe, expect, it } from "vitest";
import { createCollection, createEnvironment, createFolder, createRequest } from "@openapi-collection-studio/core";
import { createEnvironmentVariable } from "./helpers";
import { resolveRoutePreview } from "./routing";

describe("resolveRoutePreview", () => {
  it("uses the nearest folder base URL and resolves variables before Send", () => {
    const collection = createCollection("Gateway");
    collection.baseUrl = "https://collection.example";
    const folder = createFolder("Proxy");
    folder.baseUrl = "https://proxy.example/service";
    const request = createRequest({ name: "Get", method: "GET", url: "/users/{id}" });
    request.pathParams.push({ id: "path_1", key: "id", value: "42", enabled: true });
    request.queryParams.push({ id: "query_1", key: "page", value: "2", enabled: true });
    folder.requests.push(request);
    collection.folders.push(folder);
    const environment = createEnvironment("Dev");
    environment.variables = [createEnvironmentVariable("baseUrl", "https://environment.example")];

    expect(resolveRoutePreview(request, environment, collection, folder, [{ folder, path: [folder] }])).toEqual({
      url: "https://proxy.example/service/users/42?page=2",
      missing: []
    });
  });

  it("names missing variables without preventing the editor from rendering", () => {
    const request = createRequest({ name: "Get", method: "GET", url: "{{baseUrl}}/users/{{id}}" });

    expect(resolveRoutePreview(request, undefined, undefined, undefined, [])).toEqual({
      url: "{{baseUrl}}/users/{{id}}",
      missing: ["baseUrl", "id"]
    });
  });
});
