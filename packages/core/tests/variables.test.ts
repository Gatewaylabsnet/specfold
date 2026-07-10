import { describe, expect, it } from "vitest";
import {
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
});

