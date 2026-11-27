import { describe, expect, it } from "vitest";
import { createCollection, createEmptyWorkspace, createRequest } from "@openapi-collection-studio/core";
import { prepareCollectionTokenCapture } from "./collectionTokenCapture";

function fixture() {
  const workspace = createEmptyWorkspace();
  const collection = createCollection("API");
  const origin = "https://api.example.test";
  collection.baseUrl = origin + "/proxy";
  const issuer = createRequest({ name: "Token", method: "POST", url: origin + "/auth/jwt" });
  const endpoint = createRequest({ name: "Records", method: "GET", url: "{{baseUrl}}/records" });
  endpoint.auth = { type: "apiKey", key: "X-Key", value: "{{existingKey}}", in: "header" };
  collection.requests.push(issuer, endpoint);
  const other = createCollection("Other");
  workspace.collections.push(collection, other);
  const environment = workspace.environments[0];
  const capture = (current = workspace, token = '[unused]', actualOrigin = origin, requestId = issuer.id) =>
    prepareCollectionTokenCapture(current, collection.id, environment.id, requestId, actualOrigin,
      token === '[unused]' ? '{"access_token":"synthetic.value1","token_type":"Bearer"}' : token);
  return { workspace, collection, environment, endpoint, other, issuer, origin, capture };
}

describe("automatic collection token", () => {
  it("creates a collection-specific Secret, leaves manual auth and other collections intact, and refreshes the same variable", () => {
    const { capture, workspace, origin, issuer, other, endpoint } = fixture();
    const first = capture()!;
    expect(first).toBeDefined();
    expect(first.collections[0].requests[1]).toEqual(endpoint);
    expect(first.collections[1]).toEqual(other);
    expect(workspace.environments[0].variables).toHaveLength(0);
    const metadata = first.collections[0].autoAccessToken!;
    expect(metadata).toMatchObject({ issuerRequestId: issuer.id, origin });
    expect(JSON.stringify(first.collections)).not.toContain("synthetic.value1");
    expect(first.environments[0].variables[0]).toMatchObject({ name: metadata.variableName, enabled: true, secret: true, value: "synthetic.value1" });

    const next = capture(first, '{"accessToken":"synthetic.value2"}')!;
    expect(next.environments[0].variables).toEqual([{ ...first.environments[0].variables[0], value: "synthetic.value2" }]);
    expect(next.collections[0].autoAccessToken).toEqual(metadata);
  });

  it("does not bind responses without a single valid Bearer token from the matching safe issuer", () => {
    const { capture, workspace, endpoint } = fixture();
    for (const body of [
      '{"token":"anything"}', '{"access_token":"one","accessToken":"another"}', '{"access_token":"{{reference}}"}',
      '{"access_token":"synthetic","token_type":"Basic"}', '{"access_token":"multi line"}', 'invalid json'
    ]) expect(capture(workspace, body)).toBeUndefined();
    expect(capture(workspace, undefined, "https://other.example.test")).toBeUndefined();
    expect(capture(workspace, undefined, undefined, endpoint.id)).toBeUndefined();
    workspace.collections[0].autoTokenCaptureDisabled = true;
    expect(capture()).toBeUndefined();
  });

  it("does not overwrite a token which was shared outside the owning collection", () => {
    const { capture } = fixture();
    const first = capture()!;
    const binding = first.collections[0].autoAccessToken!;
    const outside = createRequest({ name: "Other request", method: "GET", url: "https://else.example.test" });
    outside.auth = { type: "bearer", token: `{{ ${binding.variableName} }}` };
    first.collections[1].requests.push(outside);
    expect(capture(first, '{"access_token":"synthetic.value2"}')).toBeUndefined();
  });
});
