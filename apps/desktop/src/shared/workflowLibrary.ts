/** Content-free persisted metadata: never add response/request text to these records. */
export type ResultStatus = "passed" | "failed" | "skipped" | "blocked";
export interface SavedScenario {
  id: string; workspace: string; profile: string; requests: string[]; createdAt: string;
}
export interface SafeRunSummary {
  id: string; workspace: string; profile: string; startedAt: string; completedAt: string;
  status: "completed" | "canceled" | "blocked";
  results: { request: string; status: ResultStatus; httpStatus?: number; durationMs?: number;
    assertions: { name: "status" | "schema" | "rule"; outcome: ResultStatus; rule?: string }[] }[];
  totals: Record<ResultStatus, number>;
}
export interface WorkflowLibrary { scenarios: SavedScenario[]; runs: SafeRunSummary[] }
/** Resolved from the current workspace for display only; never written to the library file. */
export interface WorkflowLibraryView extends WorkflowLibrary { requestLabels?: Record<string, string> }

export function compareSafeRuns(before: SafeRunSummary, after: SafeRunSummary) {
  if (before.workspace !== after.workspace || before.profile !== after.profile) throw new Error("Choose runs from the same test setup.");
  return [...new Set([...before.results.map((row) => row.request), ...after.results.map((row) => row.request)])].map((request) => {
    const previous = before.results.find((row) => row.request === request), current = after.results.find((row) => row.request === request);
    return { request, previous: previous?.status, current: current?.status,
      previousHttp: previous?.httpStatus, currentHttp: current?.httpStatus,
      durationChange: previous?.durationMs !== undefined && current?.durationMs !== undefined ? current.durationMs - previous.durationMs : undefined,
      assertionsChanged: JSON.stringify(previous?.assertions) !== JSON.stringify(current?.assertions) };
  });
}
