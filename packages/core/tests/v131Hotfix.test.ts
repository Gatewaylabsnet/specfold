import { describe, expect, it } from "vitest";
import { collectCollectionSecretWarnings, createCollection, createKeyValue, createRequest, requestToCurl } from "../src";

describe("v1.3.1 hotfixes", () => {
  it("keeps enabled URL-encoded values in copied cURL", () => {
    const request = createRequest({ name: "Token", method: "POST", url: "https://example.test/token" });
    request.body = {
      mode: "form",
      form: [createKeyValue("grant_type", "password"), createKeyValue("client_secret", "literal")]
    };

    expect(requestToCurl(request)).toContain("--data-urlencode 'client_secret=literal'");
  });

  it("warns before native collection output carries literal request auth", () => {
    const collection = createCollection("Sensitive");
    const request = createRequest({ name: "Users" });
    request.auth = { type: "bearer", token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature" };
    collection.requests.push(request);

    expect(collectCollectionSecretWarnings(collection).some((warning) => warning.kind === "secret")).toBe(true);
  });
});
