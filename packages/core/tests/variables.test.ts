import { describe, expect, it } from "vitest";
import {
  createCollection,
  createEnvironment,
  createKeyValue,
  createRequest,
  prepareHttpRequest,
  resolveVariablesInText
} from "../src";

describe("variable resolver", () => {
  it("resolves known variables and reports missing variables", () => {
    const result = resolveVariablesInText("{{baseUrl}}/users/{{id}}", {
      baseUrl: "https://api.example.com"
    });

    expect(result.value).toBe("https://api.example.com/users/{{id}}");
    expect(result.missing).toEqual(["id"]);
  });

  it("prepares HTTP requests with environment values", () => {
    const request = createRequest({ name: "Get user", url: "{{baseUrl}}/users/{id}" });
    request.pathParams = [createKeyValue("id", "42")];
    request.queryParams = [createKeyValue("expand", "posts")];
    request.auth = { type: "bearer", token: "{{accessToken}}" };

    const environment = createEnvironment("Local");
    environment.variables = [
      { id: "var_baseUrl", name: "baseUrl", value: "https://api.example.com", enabled: true },
      { id: "var_accessToken", name: "accessToken", value: "secret", enabled: true, secret: true }
    ];

    const prepared = prepareHttpRequest(request, environment);

    expect(prepared.url).toBe("https://api.example.com/users/42?expand=posts");
    expect(prepared.headers.Authorization).toBe("Bearer secret");
  });

  it("uses the collection base URL when no environment override exists", () => {
    const collection = createCollection("Orders API");
    collection.baseUrl = "https://collection.example.com";
    const request = createRequest({ name: "List orders", url: "{{baseUrl}}/orders" });

    const prepared = prepareHttpRequest(request, undefined, collection);

    expect(prepared.url).toBe("https://collection.example.com/orders");
  });

  it("lets an environment base URL override the collection base URL", () => {
    const collection = createCollection("Orders API");
    collection.baseUrl = "https://collection.example.com";
    const request = createRequest({ name: "List orders", url: "{{baseUrl}}/orders" });
    const environment = createEnvironment("Production");
    environment.variables = [
      { id: "var_baseUrl", name: "baseUrl", value: "https://prod.example.com", enabled: true }
    ];

    const prepared = prepareHttpRequest(request, environment, collection);

    expect(prepared.url).toBe("https://prod.example.com/orders");
  });

  it("does not let an empty environment base URL hide the collection base URL", () => {
    const collection = createCollection("Orders API");
    collection.baseUrl = "https://collection.example.com";
    const request = createRequest({ name: "List orders", url: "{{baseUrl}}/orders" });
    const environment = createEnvironment("Local");
    environment.variables = [{ id: "var_baseUrl", name: "baseUrl", value: "", enabled: true }];

    const prepared = prepareHttpRequest(request, environment, collection);

    expect(prepared.url).toBe("https://collection.example.com/orders");
  });
});
