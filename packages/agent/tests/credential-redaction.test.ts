import { describe, expect, it, vi } from "vitest";
import {
  createCollection, createEmptyWorkspace, createRequest, redactAgentValue,
  type AuthConfig
} from "@openapi-collection-studio/core";
import { documentationContext, documentationMarkdown } from "../src/documentation";
import { executeApprovedNetwork } from "../src/networkPolicy";

const apiCredential = "SYNTHETIC_PRIVATE_CREDENTIAL";

function fixture(auth: AuthConfig) {
  const workspace = createEmptyWorkspace();
  const collection = createCollection("Synthetic credential test");
  collection.baseUrl = "https://example.test/api";
  const request = createRequest({ name: "Echo", url: "{{baseUrl}}/echo" });
  request.auth = auth;
  collection.requests.push(request);
  workspace.collections.push(collection);
  return { workspace, collection, request };
}

describe("API-key credential boundaries", () => {
  it.each(["header", "query"] as const)("redacts %s API-key auth by its type regardless of the key name", (location) => {
    const auth: AuthConfig = { type: "apiKey", key: "X-Credential", value: apiCredential, in: location };
    expect(redactAgentValue({ auth })).toEqual({
      auth: { ...auth, value: "[REDACTED]" }
    });
    expect(auth.value).toBe(apiCredential);
  });

  it.each(["header", "query"] as const)("masks a decrypted %s API key in documentation and observed echoes", (location) => {
    // The desktop supplies a decrypted workspace to documentationContext.
    const { workspace, collection, request } = fixture({
      type: "apiKey", key: "X-Credential", value: apiCredential, in: location
    });
    const evidence = [{
      requestId: request.id, method: "GET", route: "https://example.test/api/echo",
      environmentName: "Synthetic", observedAt: "2026-10-13T00:00:00Z",
      result: { status: 200, body: JSON.stringify({ echo: apiCredential, ordinary: "visible" }) }
    }];
    const context = documentationContext(workspace, collection.id, evidence);
    expect(context.operations[0].auth).toEqual({ ...request.auth, value: "[REDACTED]" });
    expect(JSON.stringify(context)).not.toContain(apiCredential);
    expect(documentationMarkdown(workspace, collection.id, evidence)).not.toContain(apiCredential);
    expect(JSON.stringify(context)).toContain("visible");
  });

  it.each(["header", "query"] as const)("masks a literal %s API key echoed under unrelated response names", async (location) => {
    const { workspace, collection, request } = fixture({
      type: "apiKey", key: "X-Credential", value: apiCredential, in: location
    });
    const execute = vi.fn(async () => ({
      status: 200, headers: { "X-Echo": apiCredential },
      body: JSON.stringify({ echo: apiCredential, ordinary: "visible" })
    }));
    const result = await executeApprovedNetwork({ collectionId: collection.id, requestId: request.id }, {
      enabled: async () => true,
      snapshot: async () => ({ workspace, revision: "unchanged" }),
      confirm: async () => true,
      execute
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain(apiCredential);
    expect(JSON.stringify(result)).toContain("[REDACTED]");
    expect(JSON.stringify(result)).toContain("visible");
  });

  it("preserves API-key variable references while masking their values and leaving the workspace intact", async () => {
    const { workspace, collection, request } = fixture({
      type: "apiKey", key: "X-Credential", value: "{{credential}}", in: "query"
    });
    workspace.environments[0].variables.push({
      id: "synthetic-credential", name: "credential", value: apiCredential, enabled: true
    });
    expect(redactAgentValue(request).auth).toEqual(request.auth);
    expect(documentationContext(workspace, collection.id, []).operations[0].auth).toEqual(request.auth);
    const result = await executeApprovedNetwork({ collectionId: collection.id, requestId: request.id }, {
      enabled: async () => true,
      snapshot: async () => ({ workspace, revision: "unchanged" }),
      confirm: async () => true,
      execute: async () => ({ body: JSON.stringify({ echo: apiCredential }) })
    });
    expect(JSON.stringify(result)).not.toContain(apiCredential);
    expect(request.auth).toEqual({ type: "apiKey", key: "X-Credential", value: "{{credential}}", in: "query" });
    expect(workspace.environments[0].variables.find((variable) => variable.name === "credential")?.value).toBe(apiCredential);
  });
});

describe("literal authentication echoes", () => {
  it.each([
    { type: "bearer", token: "SYNTHETIC_BEARER_CREDENTIAL" },
    { type: "basic", username: "SYNTHETIC_PRIVATE_USER", password: "SYNTHETIC_PRIVATE_PASSWORD" }
  ] satisfies AuthConfig[])("masks $type credentials reflected in documentation and network results", async (auth) => {
    const { workspace, collection, request } = fixture(auth);
    const credentials = auth.type === "bearer" ? [auth.token] : [auth.username, auth.password];
    const body = JSON.stringify({ echoes: credentials, ordinary: "visible" });
    const context = documentationContext(workspace, collection.id, [{
      requestId: request.id, method: "GET", route: "https://example.test/api/echo",
      environmentName: "Synthetic", observedAt: "2026-10-13T00:00:00Z", result: { status: 200, body }
    }]);
    for (const credential of credentials) expect(JSON.stringify(context)).not.toContain(credential);
    const result = await executeApprovedNetwork({ collectionId: collection.id, requestId: request.id }, {
      enabled: async () => true,
      snapshot: async () => ({ workspace, revision: "unchanged" }),
      confirm: async () => true,
      execute: async () => ({ status: 200, body })
    });
    for (const credential of credentials) expect(JSON.stringify(result)).not.toContain(credential);
    expect(JSON.stringify(result)).toContain("visible");
  });
});
