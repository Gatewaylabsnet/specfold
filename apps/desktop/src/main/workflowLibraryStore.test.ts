import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { WorkflowRunReport } from "@openapi-collection-studio/core";
import { compareSafeRuns } from "../shared/workflowLibrary";
import { fingerprint, readWorkflowLibrary, safeRunSummary, validateLibrary, workflowLibraryPath, writeWorkflowLibrary } from "./workflowLibraryStore";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function root() { const path = await mkdtemp(join(tmpdir(), "specfold-safe-library-")); roots.push(path); return path; }
function report(): WorkflowRunReport {
  const sensitive = "SYNTHETIC_PRIVATE customer@example.invalid credential-value";
  return { id: sensitive, planId: sensitive, profileId: sensitive, status: "completed", startedAt: "2026-10-30T10:00:00.000Z", completedAt: "2026-10-30T10:00:01.000Z",
    authentication: { status: "passed", message: sensitive }, totals: { passed: 99, failed: 0, skipped: 0, blocked: 0 },
    results: [{ requestId: sensitive, name: sensitive, route: `https://${sensitive}/patient/123?token=private`, method: "GET", status: "passed", httpStatus: 200, durationMs: 17.3,
      reason: sensitive, assertions: [{ name: "schema", outcome: "passed", message: sensitive }], response: { headers: { authorization: sensitive }, body: sensitive } }] };
}
it("omits all API/free-text content and recomputes totals before atomically persisting", async () => {
  const path = await root(), summary = safeRunSummary("SYNTHETIC_PRIVATE", report());
  await writeWorkflowLibrary(path, { scenarios: [], runs: [summary] });
  const bytes = await readFile(workflowLibraryPath(path), "utf8");
  for (const forbidden of ["SYNTHETIC_PRIVATE", "customer@", "credential", "https:", "authorization", "patient", "message", "response", "planId"]) expect(bytes.includes(forbidden)).toBe(false);
  expect(summary.totals.passed).toBe(1); expect(summary.results[0].durationMs).toBe(17);
  expect(await readWorkflowLibrary(path)).toEqual({ scenarios: [], runs: [summary] });
});
it("rejects extra fields, mismatched totals, invalid enums, duplicate rows and oversized collections", () => {
  const summary = safeRunSummary("workspace", report()), valid = { version: 1, scenarios: [], runs: [summary] };
  expect(() => validateLibrary({ ...valid, response: "private" })).toThrow("WORKFLOW_LIBRARY_INVALID");
  expect(() => validateLibrary({ ...valid, runs: [{ ...summary, message: "private" }] })).toThrow();
  expect(() => validateLibrary({ ...valid, runs: [{ ...summary, totals: { ...summary.totals, passed: 2 } }] })).toThrow();
  expect(() => validateLibrary({ ...valid, runs: [{ ...summary, status: "secret" }] })).toThrow();
  expect(() => validateLibrary({ ...valid, runs: [{ ...summary, results: [...summary.results, ...summary.results] }] })).toThrow();
  expect(() => validateLibrary({ ...valid, runs: Array(51).fill(summary) })).toThrow();
  expect(() => validateLibrary({ ...valid, scenarios: Array(33).fill({}) })).toThrow();
});
it("fails closed on corrupt or oversized storage without replacing it", async () => {
  const path = await root(); expect(await readWorkflowLibrary(path)).toEqual({ scenarios: [], runs: [] });
  await writeFile(workflowLibraryPath(path), '{"secret":"do-not-import"}');
  await expect(readWorkflowLibrary(path)).rejects.toThrow("WORKFLOW_LIBRARY_INVALID");
  expect(await readFile(workflowLibraryPath(path), "utf8")).toContain("do-not-import");
  await writeFile(workflowLibraryPath(path), " ".repeat(1024 * 1024 + 1));
  await expect(readWorkflowLibrary(path)).rejects.toThrow("WORKFLOW_LIBRARY_INVALID");
});
it("compares status, assertions, HTTP and timing without content, and rejects unrelated setups", () => {
  const before = safeRunSummary("workspace", report()), after = structuredClone(before);
  after.results[0] = { ...after.results[0], status: "failed", httpStatus: 500, durationMs: 27, assertions: [{ name: "schema", outcome: "failed" }] };
  expect(compareSafeRuns(before, after)[0]).toMatchObject({ previous: "passed", current: "failed", previousHttp: 200, currentHttp: 500, durationChange: 10, assertionsChanged: true });
  after.results = []; expect(compareSafeRuns(before, after)[0].current).toBeUndefined();
  after.profile = fingerprint("other"); expect(() => compareSafeRuns(before, after)).toThrow("same test setup");
});
it("stores only opaque rule identity/outcome and omits rule paths, definitions and messages", () => {
  const value = report(); value.results[0].assertions = [{ name: "rule", ruleId: "SENSITIVE_RULE_ID", outcome: "failed", message: "PRIVATE_PATH_AND_EXPECTED_VALUE" }];
  const summary = safeRunSummary("workspace", value);
  expect(summary.results[0].assertions[0]).toEqual({ name: "rule", rule: fingerprint("workspace", "SENSITIVE_RULE_ID"), outcome: "failed" });
  expect(JSON.stringify(summary)).not.toMatch(/SENSITIVE_RULE_ID|PRIVATE_PATH|expected|value/);
});
