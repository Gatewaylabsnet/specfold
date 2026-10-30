import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkflowRunReport } from "@openapi-collection-studio/core";
import type { ResultStatus, SafeRunSummary, WorkflowLibrary } from "../shared/workflowLibrary";
import { atomicWriteFile } from "./storageService";

export const workflowLibraryPath = (root: string) => join(root, "workflow-library.json");
export const fingerprint = (...values: string[]) => createHash("sha256").update(JSON.stringify(values)).digest("hex");
const statuses: ResultStatus[] = ["passed", "failed", "skipped", "blocked"];
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const count = (value: unknown, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
const status = (value: unknown): value is ResultStatus => statuses.includes(value as ResultStatus);
const record = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
const invalid = (): never => { throw new Error("WORKFLOW_LIBRARY_INVALID"); };

/** Strict allowlist, including data read from disk. Unknown text fields are never propagated. */
export function validateLibrary(value: unknown): WorkflowLibrary {
  if (!record(value, ["version", "scenarios", "runs"]) || value.version !== 1 || !Array.isArray(value.scenarios) || value.scenarios.length > 32 || !Array.isArray(value.runs) || value.runs.length > 50) return invalid();
  for (const item of value.scenarios) {
    if (!record(item, ["id", "workspace", "profile", "requests", "createdAt"]) || !uuid(item.id) || !digest(item.workspace) || !digest(item.profile) || !timestamp(item.createdAt) || !Array.isArray(item.requests) || !item.requests.length || item.requests.length > 500 || !item.requests.every(digest) || new Set(item.requests).size !== item.requests.length) return invalid();
  }
  for (const item of value.runs) {
    if (!record(item, ["id", "workspace", "profile", "startedAt", "completedAt", "status", "results", "totals"]) || !uuid(item.id) || !digest(item.workspace) || !digest(item.profile) || !timestamp(item.startedAt) || !timestamp(item.completedAt) || !["completed", "canceled", "blocked"].includes(item.status as string) || !Array.isArray(item.results) || item.results.length > 500 || !record(item.totals, statuses)) return invalid();
    const totals = { passed: 0, failed: 0, skipped: 0, blocked: 0 };
    for (const row of item.results) {
      if (!record(row, ["request", "status", "httpStatus", "durationMs", "assertions"]) || !digest(row.request) || !status(row.status) || (row.httpStatus !== undefined && (!count(row.httpStatus, 599) || row.httpStatus < 100)) || (row.durationMs !== undefined && !count(row.durationMs, 86_400_000)) || !Array.isArray(row.assertions) || row.assertions.length > 18) return invalid();
      totals[row.status]++;
      for (const assertion of row.assertions) if (!record(assertion, ["name", "outcome", "rule"]) || !["status", "schema", "rule"].includes(assertion.name as string) || !status(assertion.outcome) || (assertion.name === "rule" ? !digest(assertion.rule) : assertion.rule !== undefined)) return invalid();
    }
    const storedTotals = item.totals as Record<string, unknown>;
    if (new Set(item.results.map((row) => row.request)).size !== item.results.length || statuses.some((key) => storedTotals[key] !== totals[key])) return invalid();
  }
  if (new Set(value.scenarios.map((item) => item.id)).size !== value.scenarios.length || new Set(value.runs.map((item) => item.id)).size !== value.runs.length) return invalid();
  return { scenarios: value.scenarios, runs: value.runs } as WorkflowLibrary;
}

export async function readWorkflowLibrary(root: string): Promise<WorkflowLibrary> {
  const path = workflowLibraryPath(root);
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
  if (!info) return { scenarios: [], runs: [] };
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) return invalid();
  try {
    const content = await readFile(path, "utf8");
    if (Buffer.byteLength(content) > 1024 * 1024) return invalid();
    return validateLibrary(JSON.parse(content));
  } catch { return invalid(); }
}

export async function writeWorkflowLibrary(root: string, library: WorkflowLibrary): Promise<void> {
  const document = { version: 1, ...library };
  validateLibrary(document);
  const serialized = JSON.stringify(document);
  if (Buffer.byteLength(serialized) > 1024 * 1024) return invalid();
  await atomicWriteFile(workflowLibraryPath(root), serialized, 0o600);
}

/** Omit all free text and API content, including already masked samples/messages. */
export function safeRunSummary(workspaceId: string, report: WorkflowRunReport): SafeRunSummary {
  const summary: SafeRunSummary = {
    id: randomUUID(), workspace: fingerprint(workspaceId), profile: fingerprint(workspaceId, report.profileId),
    startedAt: report.startedAt, completedAt: report.completedAt, status: report.status,
    results: report.results.map((row) => ({ request: fingerprint(workspaceId, row.requestId), status: row.status,
      ...(row.httpStatus !== undefined ? { httpStatus: row.httpStatus } : {}),
      ...(row.durationMs !== undefined ? { durationMs: Math.min(86_400_000, Math.max(0, Math.round(row.durationMs))) } : {}),
      assertions: row.assertions.map((assertion) => ({ name: assertion.name, outcome: assertion.outcome,
        ...(assertion.name === "rule" && typeof assertion.ruleId === "string" ? { rule: fingerprint(workspaceId, assertion.ruleId) } : {}) })) })),
    totals: { passed: 0, failed: 0, skipped: 0, blocked: 0 }
  };
  for (const row of summary.results) summary.totals[row.status]++;
  validateLibrary({ version: 1, scenarios: [], runs: [summary] });
  return summary;
}
