import { isCredentialName, isCredentialReference, REDACTED, workspaceSecrets, type Workspace } from "@openapi-collection-studio/core";
import { AgentError } from "./errors";

/** Existing encrypted values remain opaque. Refuse copying legacy plaintext into a safety backup. */
export function assertOpaqueCredentialStorage(workspace: Workspace): void {
  for (const value of workspaceSecrets(workspace)) {
    if (value && !value.startsWith("enc:v1:") && value !== REDACTED && !isCredentialReference(value)) throw new AgentError("UNPROTECTED_SECRET");
  }
  const check = (input: unknown, sensitive = false, depth = 0): void => {
    if (depth > 80) throw new AgentError("INVALID_WORKSPACE");
    if (typeof input === "number" && sensitive) throw new AgentError("UNPROTECTED_SECRET");
    if (typeof input === "string") {
      if (sensitive && input && input !== REDACTED && !input.startsWith("enc:v1:") && !isCredentialReference(input)) {
        throw new AgentError("UNPROTECTED_SECRET");
      }
      if (!sensitive && /^\s*[{[]/.test(input)) {
        try { const parsed = JSON.parse(input); check(parsed, false, depth + 1); }
        catch (error) { if (error instanceof AgentError) throw error; }
      }
      return;
    }
    if (Array.isArray(input)) { input.forEach((item) => check(item, sensitive, depth + 1)); return; }
    if (!input || typeof input !== "object") return;
    const record = input as Record<string, unknown>;
    const field = typeof record.key === "string" ? record.key : typeof record.name === "string" ? record.name : "";
    for (const [key, value] of Object.entries(record)) check(value,
      isCredentialName(key) || (key === "value" && (record.secret === true || isCredentialName(field))) ||
      (sensitive && ["example", "default", "value", "examples"].includes(key)), depth + 1);
  };
  check(workspace);
}
