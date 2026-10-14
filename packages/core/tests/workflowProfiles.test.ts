import { describe, expect, it } from "vitest";
import { createCollection, createEmptyWorkspace, createRequest } from "../src/model/factory";
import { profileAuthVariables, upsertProfile, validateConnectionProfile } from "../src/workflow/profiles";
import type { ConnectionProfile, WorkflowAuth } from "../src/workflow/types";

function profile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: "profile_test", name: "TarımKredi test", provider: "openapi",
    collectionId: "collection_test", environmentId: "environment_test",
    baseUrl: "https://api.example.test/service/v1",
    source: { kind: "file", label: "openapi.yaml" }, auth: { kind: "none" }, ...overrides
  };
}

function apinizerAuth(): Extract<WorkflowAuth, { kind: "apinizer" }> {
  return {
    kind: "apinizer", endpoint: "https://gateway.example.test/auth/jwt",
    usernameVariable: "apinizer.username", passwordVariable: "apinizer.password",
    clientIdVariable: "apinizer.client-id", tokenVariable: "apinizer.accessToken"
  };
}

function workspace() {
  const result = createEmptyWorkspace();
  result.updatedAt = "2020-01-01T00:00:00.000Z";
  result.environments[0].id = "environment_test";
  result.activeEnvironmentId = "environment_test";
  const collection = createCollection("Existing collection");
  collection.id = "collection_test";
  collection.requests.push(createRequest({ name: "Do not rewrite", url: "{{baseUrl}}/orders" }));
  result.collections.push(collection);
  return result;
}

describe("connection profile validation", () => {
  it.each<WorkflowAuth>([
    { kind: "none" },
    { kind: "bearer", tokenVariable: "accessToken" },
    { kind: "basic", usernameVariable: "user_name", passwordVariable: "password" },
    { kind: "apiKey", key: "X-Credential", in: "header", valueVariable: "apiKey" },
    { kind: "apiKey", key: "api_key", in: "query", valueVariable: "apiKey" }
  ])("accepts the generic $kind authentication contract", (auth) => {
    const input = profile({ auth });
    const output = validateConnectionProfile(input);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    expect(output.auth).not.toBe(input.auth);
    expect(output.source).not.toBe(input.source);
    expect(validateConnectionProfile({ ...input, provider: "apinizer" }).auth).toEqual(auth);
  });

  it("accepts Apinizer references with an optional client secret name", () => {
    const input = profile({ provider: "apinizer", auth: { ...apinizerAuth(), clientSecretVariable: "clientSecret" } });
    expect(validateConnectionProfile(input)).toEqual(input);
    expect(profileAuthVariables(input)).toEqual([
      "apinizer.username", "apinizer.password", "apinizer.client-id", "clientSecret", "apinizer.accessToken"
    ]);
  });

  it.each(["usernameVariable", "passwordVariable", "clientIdVariable", "clientSecretVariable"] as const)(
    "rejects an Apinizer token destination that would overwrite %s", (field) => {
      const auth = { ...apinizerAuth(), clientSecretVariable: "apinizer.clientSecret" };
      const input = profile({ provider: "apinizer", auth: { ...auth, tokenVariable: auth[field] } });
      expect(() => validateConnectionProfile(input)).toThrow(new Error("INVALID_CONNECTION_PROFILE: auth.tokenVariable"));
      expect(() => profileAuthVariables(input)).toThrow(new Error("INVALID_CONNECTION_PROFILE: auth.tokenVariable"));
      const original = workspace();
      const snapshot = structuredClone(original);
      expect(() => upsertProfile(original, input)).toThrow(new Error("INVALID_CONNECTION_PROFILE: auth.tokenVariable"));
      expect(original).toEqual(snapshot);
    }
  );

  it("requires the Apinizer provider for its JWT preset", () => {
    expect(() => validateConnectionProfile(profile({ auth: apinizerAuth() }))).toThrow("provider/auth");
    expect(() => validateConnectionProfile({ ...profile(), provider: "unknown" })).toThrow("provider");
  });

  it.each([
    { kind: "bearer" }, { kind: "basic", usernameVariable: "username" },
    { kind: "apiKey", key: "X-Key", in: "header", valueVariable: 42 },
    { ...apinizerAuth(), clientSecretVariable: "" }, { ...apinizerAuth(), clientSecretVariable: undefined },
    { ...apinizerAuth(), tokenVariable: null }, { kind: "oauth" }
  ])("requires the exact fields and types of each auth variant", (auth) => {
    expect(() => validateConnectionProfile({ ...profile(), provider: auth.kind === "apinizer" ? "apinizer" : "openapi", auth })).toThrow("INVALID_CONNECTION_PROFILE");
  });

  it("rejects unsupported source kinds and accepts the documented text boundaries", () => {
    expect(() => validateConnectionProfile({ ...profile(), source: { kind: "inline", label: "text" } })).toThrow("source.kind");
    const input = profile({ id: "a".repeat(128), name: "a".repeat(160), auth: { kind: "bearer", tokenVariable: "a".repeat(128) } });
    expect(validateConnectionProfile(input)).toEqual(input);
  });

  it.each([
    { ...profile(), password: "SYNTHETIC_SECRET" },
    profile({ source: { kind: "file", label: "openapi.yaml", content: "SYNTHETIC_SECRET" } as ConnectionProfile["source"] }),
    profile({ auth: { kind: "bearer", tokenVariable: "accessToken", token: "SYNTHETIC_SECRET" } as WorkflowAuth }),
    profile({ auth: { kind: "none", tokenVariable: "accessToken" } as WorkflowAuth }),
    profile({ auth: { kind: "basic", usernameVariable: "username", passwordVariable: "password", endpoint: "https://example.test" } as WorkflowAuth }),
    profile({ provider: "apinizer", auth: { ...apinizerAuth(), clientSecret: "SYNTHETIC_SECRET" } as WorkflowAuth })
  ])("rejects unknown fields at every level without echoing values", (input) => {
    expect(() => validateConnectionProfile(input)).toThrow("INVALID_CONNECTION_PROFILE");
    try { validateConnectionProfile(input); } catch (error) {
      expect(String(error)).not.toContain("SYNTHETIC_SECRET");
    }
  });

  it.each([null, [], "profile", {}, new Date(), Object.create({ ...profile() })])("rejects malformed records", (input) => {
    expect(() => validateConnectionProfile(input)).toThrow("INVALID_CONNECTION_PROFILE");
  });

  it("rejects unknown symbols, prototype keys, and getters without invoking them", () => {
    const getter = { ...profile() };
    let invoked = false;
    Object.defineProperty(getter, "name", { enumerable: true, get: () => { invoked = true; return "hidden"; } });
    expect(() => validateConnectionProfile(getter)).toThrow("INVALID_CONNECTION_PROFILE");
    expect(invoked).toBe(false);
    expect(() => validateConnectionProfile({ ...profile(), [Symbol("hidden")]: "value" })).toThrow();
    expect(() => validateConnectionProfile({ ...profile(), ["__proto__"]: {} })).toThrow();
  });

  it.each(["", "{{accessToken}}", "Bearer token", "name=value", "1token", "a".repeat(129), "secret\nheader"])("rejects invalid variable references: %s", (tokenVariable) => {
    expect(() => validateConnectionProfile(profile({ auth: { kind: "bearer", tokenVariable } }))).toThrow("auth.tokenVariable");
  });

  it.each([
    { id: "a".repeat(129) }, { id: "profile name" }, { name: "a".repeat(161) }, { name: " " },
    { collectionId: "" }, { environmentId: "environment\nother" },
    { source: { kind: "file", label: "a".repeat(2_049) } },
    { auth: { kind: "apiKey", key: "X-Key\r\nInjected", in: "header", valueVariable: "key" } },
    { auth: { kind: "apiKey", key: "key&extra", in: "query", valueVariable: "key" } },
    { auth: { kind: "apiKey", key: "X-Key", in: "cookie", valueVariable: "key" } }
  ])("rejects unbounded or invalid metadata", (overrides) => {
    expect(() => validateConnectionProfile({ ...profile(), ...overrides })).toThrow("INVALID_CONNECTION_PROFILE");
  });

  it.each([
    "https://user:SYNTHETIC_SECRET@example.test/api", "https://@example.test/api", "https://example.test/api#",
    "ftp://example.test/api", "https:example.test", "/relative", "{{baseUrl}}/api", "https://{{host}}/api",
    "https://example.test/%7B%7Bsecret%7D%7D", "https://example.test/white space", "https://example.test\\other",
    "https://example.test/" + "a".repeat(2_048)
  ])("rejects unsafe URLs in all URL locations", (url) => {
    expect(() => validateConnectionProfile(profile({ baseUrl: url }))).toThrow("baseUrl");
    expect(() => validateConnectionProfile(profile({ source: { kind: "url", label: url } }))).toThrow("source.label");
    expect(() => validateConnectionProfile(profile({ provider: "apinizer", auth: { ...apinizerAuth(), endpoint: url } }))).toThrow("auth.endpoint");
  });

  it.each(["access_token", "API-KEY", "X-Credential", "client_secret", "%70assword", "X-Amz-Signature", "sig", "code"])("rejects credential query field %s", (key) => {
    const url = `https://example.test/openapi?${key}=SYNTHETIC_SECRET`;
    expect(() => validateConnectionProfile(profile({ source: { kind: "url", label: url } }))).toThrow("source.label");
    expect(() => validateConnectionProfile(profile({ provider: "apinizer", auth: { ...apinizerAuth(), endpoint: url } }))).toThrow("auth.endpoint");
  });

  it("allows noncredential source/endpoint queries but no base URL query", () => {
    expect(validateConnectionProfile(profile({
      source: { kind: "url", label: "https://example.test/openapi?format=json&version=2" }
    })).source.label).toContain("format=json");
    expect(validateConnectionProfile(profile({ provider: "apinizer", auth: {
      ...apinizerAuth(), endpoint: "http://localhost:8080/auth/jwt?tenant=demo"
    } })).auth.kind).toBe("apinizer");
    for (const suffix of ["?", "?format=json"]) {
      expect(() => validateConnectionProfile(profile({ baseUrl: `https://example.test/api${suffix}` }))).toThrow("baseUrl");
    }
  });

  it("returns only unique auth references, including the generated token destination", () => {
    expect(profileAuthVariables(profile())).toEqual([]);
    expect(profileAuthVariables(profile({ auth: { kind: "bearer", tokenVariable: "token" } }))).toEqual(["token"]);
    expect(profileAuthVariables(profile({ auth: { kind: "apiKey", key: "X-Key", in: "header", valueVariable: "key" } }))).toEqual(["key"]);
    expect(profileAuthVariables(profile({ auth: { kind: "basic", usernameVariable: "shared", passwordVariable: "shared" } }))).toEqual(["shared"]);
    expect(profileAuthVariables(profile({ provider: "apinizer", auth: {
      ...apinizerAuth(), usernameVariable: "shared", passwordVariable: "shared"
    } }))).toEqual(["shared", "apinizer.client-id", "apinizer.accessToken"]);
  });
});

describe("connection profile upsert", () => {
  it("adds a profile to schema 1 while preserving legacy requests, secrets, and extension fields", () => {
    const original = Object.assign(workspace(), { extension: { keep: ["legacy"] } });
    Object.assign(original.collections[0].requests[0], { extension: { source: "legacy" } });
    original.environments[0].variables.push({ id: "v1", name: "token", value: "enc:v1:TEST", enabled: true, secret: true });
    const snapshot = structuredClone(original);
    const input = profile({ auth: { kind: "bearer", tokenVariable: "notConfiguredYet" } });
    const next = upsertProfile(original, input);
    expect(next.schemaVersion).toBe(1);
    expect(next.collections).toEqual(original.collections);
    expect(next.environments).toEqual(original.environments);
    expect(next.activeEnvironmentId).toBe(original.activeEnvironmentId);
    expect((next as typeof original).extension).toEqual(original.extension);
    expect(next.connectionProfiles).toEqual([input]);
    expect(next.updatedAt).not.toBe(original.updatedAt);
    next.collections[0].requests[0].name = "changed copy";
    (next as typeof original).extension.keep.push("new");
    next.connectionProfiles![0].name = "changed copy";
    expect(original).toEqual(snapshot);
    expect(input.name).toBe("TarımKredi test");
  });

  it("replaces an existing id in place and keeps other profiles independent", () => {
    const original = workspace();
    original.connectionProfiles = [profile(), profile({ id: "other", name: "Other" })];
    const next = upsertProfile(original, profile({ name: "Edited", source: { kind: "existing", label: "Imported collection" } }));
    expect(next.connectionProfiles?.map((item) => item.name)).toEqual(["Edited", "Other"]);
    expect(original.connectionProfiles[0].name).toBe("TarımKredi test");
    next.connectionProfiles![1].source.label = "new label";
    expect(original.connectionProfiles[1].source.label).toBe("openapi.yaml");
  });

  it("rejects missing collection/environment without mutating the workspace", () => {
    const original = workspace();
    const before = structuredClone(original);
    expect(() => upsertProfile(original, profile({ collectionId: "missing" }))).toThrow("COLLECTION_NOT_FOUND");
    expect(() => upsertProfile(original, profile({ environmentId: "missing" }))).toThrow("ENVIRONMENT_NOT_FOUND");
    expect(original).toEqual(before);
  });

  it("caps profiles while allowing edits at capacity", () => {
    const original = workspace();
    original.connectionProfiles = Array.from({ length: 64 }, (_, index) => profile({ id: `profile_${index}` }));
    expect(() => upsertProfile(original, profile())).toThrow("CONNECTION_PROFILE_LIMIT");
    const next = upsertProfile(original, profile({ id: "profile_32", name: "Edited at capacity" }));
    expect(next.connectionProfiles).toHaveLength(64);
    expect(next.connectionProfiles?.[32].name).toBe("Edited at capacity");
    expect(original.connectionProfiles[32].name).toBe("TarımKredi test");
    original.connectionProfiles.push(profile({ id: "overflow" }));
    expect(() => upsertProfile(original, profile({ id: "profile_32" }))).toThrow("CONNECTION_PROFILE_LIMIT");
  });

  it("rejects duplicate persisted profile IDs instead of updating an ambiguous record", () => {
    const original = workspace();
    original.connectionProfiles = [profile(), profile()];
    expect(() => upsertProfile(original, profile({ name: "Edited" }))).toThrow("DUPLICATE_CONNECTION_PROFILE_ID");
    expect(original.connectionProfiles[0].name).toBe("TarımKredi test");
  });
});
