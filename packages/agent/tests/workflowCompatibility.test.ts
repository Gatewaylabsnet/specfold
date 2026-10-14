import { expect, it } from "vitest";
import { createCollection, createEmptyWorkspace, createId, redactAgentValue, workspaceSecrets, type ConnectionProfile } from "@openapi-collection-studio/core";
import { validateAgentWorkspace } from "../src/validation";

it("keeps legacy workspaces unchanged and retains reference-only profile metadata", () => {
  const workspace = createEmptyWorkspace();
  const legacy = JSON.stringify(workspace);
  expect(validateAgentWorkspace(workspace)).toBe(workspace);
  expect(JSON.stringify(workspace)).toBe(legacy);
  const collection = createCollection("Existing collection"); workspace.collections.push(collection);
  const profile: ConnectionProfile = { id: "profile", name: "Generic API", provider: "openapi", collectionId: collection.id,
    environmentId: workspace.environments[0].id, baseUrl: "https://api.example.test/v1",
    source: { kind: "existing", label: "Existing collection" }, auth: { kind: "bearer", tokenVariable: "sessionValue" } };
  workspace.connectionProfiles = [profile];
  expect(validateAgentWorkspace(workspace).connectionProfiles).toEqual([profile]);
  expect(validateAgentWorkspace(JSON.parse(JSON.stringify(workspace))).collections).toEqual([collection]);
  expect(() => validateAgentWorkspace({ ...workspace, connectionProfiles: [{ ...profile, token: "LITERAL_SECRET" }] })).toThrow("INVALID_WORKSPACE");
  expect(() => validateAgentWorkspace({ ...workspace, connectionProfiles: [profile, profile] })).toThrow("INVALID_WORKSPACE");
});

it("treats every profile auth reference as credential evidence even for legacy unmarked custom names", () => {
  const workspace = createEmptyWorkspace();
  const auths: ConnectionProfile["auth"][] = [
    { kind: "bearer", tokenVariable: "a" },
    { kind: "basic", usernameVariable: "b", passwordVariable: "c" },
    { kind: "apiKey", key: "X-Custom", in: "header", valueVariable: "d" },
    { kind: "apinizer", endpoint: "https://api.example.test/auth/jwt", usernameVariable: "e", passwordVariable: "f",
      clientIdVariable: "g", clientSecretVariable: "h", tokenVariable: "i" }
  ];
  workspace.connectionProfiles = auths.map((auth, index) => ({ id: `profile-${index}`, name: "Fixture", provider: "openapi",
    collectionId: "collection", environmentId: workspace.environments[0].id, baseUrl: "https://api.example.test",
    source: { kind: "existing", label: "Fixture" }, auth }));
  for (const name of "abcdefghi") workspace.environments[0].variables.push({ id: createId("var"), name,
    value: `SYNTHETIC_${name}_VALUE`, enabled: true, secret: false });
  const secrets = workspaceSecrets(workspace);
  expect(secrets).toHaveLength(9);
  const masked = redactAgentValue({ label: secrets.join(" ") }, secrets);
  for (const secret of secrets) expect(JSON.stringify(masked)).not.toContain(secret);
});
