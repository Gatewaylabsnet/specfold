import { assertBoundedWorkflowValue, isCredentialName, isCredentialReference,
  redactAgentValue, type AgentMutation } from "@openapi-collection-studio/core";
import { AgentError } from "./errors";

type RequestUpdate = Extract<AgentMutation, { kind: "update-request" }>;
const credentialName = (key: string) =>
  isCredentialName(key) || /credential|session[-_ ]?id|(?:private|encryption|signing)[-_ ]?key/i.test(key);
const recognizableLiteral = /enc:v1:|-----BEGIN[^\r\n]*(?:PRIVATE KEY|PKCS12)-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{16,})\b/;

/** Fail closed on unsafe edit inputs, including values overwritten by later edits.
 * Signed plans store the approved data exactly, not a silently redacted mutation. */
export function assertSafeRequestUpdateInput(action: RequestUpdate, secrets: readonly string[]): void {
  try {
    assertBoundedWorkflowValue(action.updates);
    if (Buffer.byteLength(JSON.stringify(action.updates)) > 1024 * 1024) throw new Error();
  } catch { throw new AgentError("REQUEST_UPDATE_INVALID"); }

  let count = 0;
  const invalid = () => { throw new AgentError("REQUEST_UPDATE_CREDENTIAL_LITERAL"); };
  const safeText = (value: string, sensitive: boolean, depth: number): void => {
    if (!value) return;
    // References are symbolic, not credentials or arbitrary path lookups.
    if (isCredentialReference(value)) return;
    if (sensitive || recognizableLiteral.test(value) || /\bbasic\s+(?!\{\{)[A-Za-z0-9+/=]{12,}/i.test(value)) invalid();
    if (/^\s*[{[]/.test(value)) {
      let parsed: unknown;
      try { parsed = JSON.parse(value); }
      catch { /* Treat malformed raw text as text, not a parser error to return. */ }
      if (parsed !== undefined) { visit(parsed, false, depth + 1); return; }
    }
    if (redactAgentValue(value, secrets) !== value) invalid();
  };
  function visit(input: unknown, sensitive = false, depth = 0): void {
    if (++count > 20_000 || depth > 38) throw new AgentError("REQUEST_UPDATE_INVALID");
    if (typeof input === "string") return safeText(input, sensitive, depth);
    if (input === null || input === undefined) return;
    if (typeof input !== "object") { if (sensitive) invalid(); return; }
    if (Array.isArray(input)) { input.forEach((child) => visit(child, sensitive, depth + 1)); return; }
    const record = input as Record<string, unknown>;
    const field = typeof record.key === "string" ? record.key : typeof record.name === "string" ? record.name : "";
    for (const [key, value] of Object.entries(record)) {
      safeText(key, false, depth + 1);
      visit(value, sensitive || credentialName(key) || (key === "value" && credentialName(field)), depth + 1);
    }
  }
  visit(action.updates);
}
