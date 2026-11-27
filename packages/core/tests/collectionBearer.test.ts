import { describe, expect, it } from "vitest";
import {
  collectionBearerForRequest, collectionTokenOrigin, createApinizerJwtRequest, createCollection, createEnvironment,
  createFolder, createJwtRequest, createKeyValue, createOAuthTokenRequest, createRequest, isCollectionBearerToken,
  isCollectionTokenIssuer, parseCollectionJson, prepareHttpRequest, resolveCollectionTokenRequestUrl, serializeCollectionJson
} from "../src";

const prepareEditorSend = (request: Parameters<typeof prepareHttpRequest>[0], env: Parameters<typeof prepareHttpRequest>[1],
  collection: Parameters<typeof prepareHttpRequest>[2], folderPath: Parameters<typeof prepareHttpRequest>[3] = []) =>
  prepareHttpRequest(request, env, collection, folderPath, { allowCollectionToken: true });

function fixture() {
  const collection = createCollection("Example API");
  collection.baseUrl = "https://api.example.test/v1";
  const issuer = createRequest({ name: "Fixture issuer", method: "POST", url: "/auth/jwt" });
  collection.autoAccessToken = { variableName: "exampleToken", origin: "https://api.example.test", issuerRequestId: issuer.id };
  const env = createEnvironment("Test");
  env.variables = [
    { id: "tok", name: "exampleToken", value: "synthetic.opaque-token", enabled: true, secret: true },
    { id: "base", name: "baseUrl", value: "https://environment.example.test/other", enabled: true }
  ];
  const service = createRequest({ name: "Example", method: "GET", url: "/items/{id}" });
  service.pathParams.push(createKeyValue("id", "test item"));
  return { collection, issuer, env, service };
}

describe("automatic collection bearer policy", () => {
  it("inherits for the exact effective origin with no explicit auth and does not mutate the request", () => {
    const { collection, env, service } = fixture();
    expect(resolveCollectionTokenRequestUrl(service, env, collection)).toBe("https://api.example.test/v1/items/test%20item");
    expect(collectionBearerForRequest(service, env, collection)).toBe("exampleToken");
    expect(prepareEditorSend(service, env, collection)).toMatchObject({
      url: "https://api.example.test/v1/items/test%20item",
      headers: { Authorization: "Bearer synthetic.opaque-token" },
      collectionTokenApplied: true
    });
    expect(service.auth).toEqual({ type: "none" });
    expect(service.headers).toHaveLength(0);
    expect(prepareHttpRequest(service, env, collection).headers).toEqual({});
  });

  it("uses folder routing but never inherits across an origin, protocol or port change", () => {
    const { collection, env, service } = fixture();
    const folder = createFolder("Proxy");
    folder.baseUrl = "https://api.example.test/proxy";
    expect(prepareEditorSend(service, env, collection, [folder])).toMatchObject({
      url: "https://api.example.test/proxy/items/test%20item",
      collectionTokenApplied: true
    });
    for (const route of ["https://api.example.test:7443/proxy", "https://other.example.test/proxy", "http://api.example.test/proxy"]) {
      folder.baseUrl = route;
      expect(collectionBearerForRequest(service, env, collection, [folder])).toBeUndefined();
      expect(prepareEditorSend(service, env, collection, [folder]).headers).toEqual({});
    }
    service.url = "https://other.example.test/external";
    expect(prepareEditorSend(service, env, collection).collectionTokenApplied).toBeUndefined();
    expect(prepareEditorSend(service, env, collection).headers).toEqual({});
  });

  it("does not override explicit auth, resolved manual Authorization or a configured folder token", () => {
    const { collection, env, service } = fixture();
    service.auth = { type: "bearer", token: "explicit" };
    expect(prepareEditorSend(service, env, collection)).toMatchObject({ headers: { Authorization: "Bearer explicit" } });
    expect(collectionBearerForRequest(service, env, collection)).toBeUndefined();
    service.auth = { type: "none" };
    env.variables.push({ id: "header", name: "headerName", value: "aUtHoRiZaTiOn", enabled: true });
    service.headers.push(createKeyValue("{{headerName}}", "Manual fixture"));
    expect(prepareEditorSend(service, env, collection).headers).toEqual({ aUtHoRiZaTiOn: "Manual fixture" });
    expect(collectionBearerForRequest(service, env, collection)).toBeUndefined();
    service.headers[0].enabled = false;
    expect(collectionBearerForRequest(service, env, collection)).toBe("exampleToken");
    expect(prepareEditorSend(service, env, collection, [{ accessTokenVariable: "folderToken" }]).headers).toEqual({});
    service.headers[0] = createKeyValue("Host", "alternate-virtual-host.example.test");
    expect(collectionBearerForRequest(service, env, collection)).toBeUndefined();
    expect(prepareEditorSend(service, env, collection).collectionTokenApplied).toBeUndefined();
  });

  it("excludes issuer requests, recognized auth routes and explicit automatic-capture opt-outs", () => {
    const { collection, issuer, env, service } = fixture();
    for (const tokenRequest of [issuer, createJwtRequest(), createApinizerJwtRequest(), createOAuthTokenRequest()]) {
      expect(isCollectionTokenIssuer(tokenRequest)).toBe(true);
      expect(prepareEditorSend({ ...tokenRequest, body: { mode: "none" } }, env, collection).collectionTokenApplied)
        .toBeUndefined();
    }
    expect(isCollectionTokenIssuer({ ...service, method: "POST" })).toBe(false);
    expect(isCollectionTokenIssuer({ ...issuer, method: "GET" })).toBe(false);
    expect(prepareEditorSend({ ...issuer, url: "/changed" }, env, collection).headers).toEqual({});
    collection.autoTokenCaptureDisabled = true;
    expect(collectionBearerForRequest(service, env, collection)).toBeUndefined();
    expect(prepareEditorSend(service, env, collection).headers).toEqual({});
  });

  it("requires exactly one enabled, valid secret in the active environment", () => {
    const { collection, env, service } = fixture();
    for (const envState of [
      undefined,
      { ...env, variables: [{ ...env.variables[0], secret: false }] },
      { ...env, variables: [{ ...env.variables[0], enabled: false }] },
      { ...env, variables: [{ ...env.variables[0], value: "enc:v1:YXNk" }] },
      { ...env, variables: [{ ...env.variables[0], value: "{{another}}" }] },
      { ...env, variables: [...env.variables, { ...env.variables[0], id: "different", enabled: false }] }
    ]) {
      expect(prepareEditorSend(service, envState, collection).headers).toEqual({});
    }
    expect(isCollectionBearerToken("synthetic-token.with~allowed+/=")).toBe(true);
    expect(isCollectionBearerToken("secret\r\nX-Line: forged")).toBe(false);
    expect(isCollectionBearerToken("Bearer secret")).toBe(false);
    expect(isCollectionBearerToken("*".repeat(16_385))).toBe(false);
  });

  it("requires HTTPS or HTTP loopback and excludes userinfo from the token scope", () => {
    expect(collectionTokenOrigin("https://API.EXAMPLE.TEST:443/v1?x=7")).toBe("https://api.example.test");
    expect(collectionTokenOrigin("http://127.0.0.1:1234/")).toBe("http://127.0.0.1:1234");
    expect(collectionTokenOrigin("http://localhost:1234/")).toBe("http://localhost:1234");
    expect(collectionTokenOrigin("http://[::1]:1234/")).toBe("http://[::1]:1234");
    for (const url of ["http://api.example.test", "http://192.168.0.1", "https://user:password@api.example.test", "/relative", "file:///root"]) {
      expect(collectionTokenOrigin(url)).toBeUndefined();
    }
  });

  it("does not export or accept a collection-only bearer binding in portable collection JSON", () => {
    const { collection } = fixture();
    collection.autoTokenCaptureDisabled = true;
    const exported = JSON.parse(serializeCollectionJson(collection));
    expect(exported.collection).not.toHaveProperty("autoAccessToken");
    expect(exported.collection).not.toHaveProperty("autoTokenCaptureDisabled");
    expect(parseCollectionJson(JSON.stringify({ ...exported, collection }))).not.toHaveProperty("autoAccessToken");
    expect(collection.autoAccessToken).toBeDefined();
  });
});
