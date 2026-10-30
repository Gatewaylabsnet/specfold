import { useEffect, useState } from "react";
import type { WorkflowRunReport, WorkflowTestPlan } from "@openapi-collection-studio/core";
import { compareSafeRuns, type WorkflowLibraryView } from "../../../shared/workflowLibrary";

export function LibraryPanel({ profileId, plan, report, busy, onOpen }: {
  profileId: string; plan?: WorkflowTestPlan; report?: WorkflowRunReport; busy: boolean;
  onOpen(scenarioId: string): Promise<void>;
}) {
  const [library, setLibrary] = useState<WorkflowLibraryView>({ scenarios: [], runs: [] });
  const [working, setWorking] = useState(false), [message, setMessage] = useState("");
  const [baselineId, setBaselineId] = useState("");
  useEffect(() => {
    let current = true;
    setLibrary({ scenarios: [], runs: [] }); setBaselineId(""); setMessage("");
    void window.studio.getWorkflowLibrary?.(profileId).then((value) => { if (current) setLibrary(value); })
      .catch(() => { if (current) setMessage("Saved scenarios and history could not be read. Existing records were kept."); });
    return () => { current = false; };
  }, [profileId, plan?.id, report?.id]);
  const perform = async (operation: () => Promise<void>, success: string) => {
    setWorking(true); setMessage("");
    try { await operation(); setLibrary(await window.studio.getWorkflowLibrary(profileId)); setMessage(success); }
    catch (error) { setMessage(error instanceof Error && error.message === "CANCELED" ? "Action canceled. Saved data was kept." : "Could not complete this action. A scenario may be stale, storage may be unavailable, or the library limit was reached. Review the setup and preview again."); }
    finally { setWorking(false); }
  };
  const disabled = busy || working;
  const latest = library.runs.at(-1), baseline = library.runs.find((item) => item.id === baselineId);
  const comparison = baseline && latest && baseline.id !== latest.id ? compareSafeRuns(baseline, latest) : undefined;
  return <details className="workflow-library"><summary>Saved scenarios &amp; safe history</summary>
    <p>For this test setup only. Saved selections require a fresh preview and approval every time.</p>
    {plan && <button type="button" className="secondary-button" disabled={disabled || !plan.rows.some((row) => row.selected && row.status === "ready")}
      onClick={() => void perform(() => window.studio.saveWorkflowScenario(plan.id), "Selection saved. It grants no run permission.")}>Save selected scenario</button>}
    <ul>{library.scenarios.map((scenario, index) => <li key={scenario.id}>
      Scenario {index + 1}: {scenario.requests.length} requests · {new Date(scenario.createdAt).toLocaleString()}
      <button type="button" className="secondary-button" disabled={disabled} onClick={() => void perform(() => onOpen(scenario.id), "Fresh preview prepared. Review it before running.")}>Preview scenario {index + 1}</button>
      <button type="button" className="secondary-button" disabled={disabled} onClick={() => void perform(() => window.studio.deleteWorkflowLibraryItem("scenarios", scenario.id), "Scenario deleted.")}>Delete scenario {index + 1}</button>
    </li>)}</ul>
    {!library.scenarios.length && <p>No saved selections for this setup.</p>}
    <p>History is off by default. Saving a summary stores outcomes, HTTP status numbers and timing only. No bodies, headers, URLs, names or diagnostic text are saved. Up to 50 summaries and 32 scenarios are kept locally, outside workspace backups.</p>
    {report && <button type="button" className="secondary-button" disabled={disabled}
      onClick={() => void perform(() => window.studio.saveWorkflowSummary(report.id), "Safe summary saved without API content.")}>Save safe summary</button>}
    <ul>{library.runs.map((run, index) => <li key={run.id}>Run {index + 1} · {new Date(run.completedAt).toLocaleString()} · {run.status}: {run.totals.passed} passed, {run.totals.failed} failed, {run.totals.blocked} blocked, {run.totals.skipped} skipped
      <button type="button" className="secondary-button" disabled={disabled} onClick={() => void perform(() => window.studio.deleteWorkflowLibraryItem("runs", run.id), "Summary deleted.")}>Delete run {index + 1}</button>
    </li>)}</ul>
    {library.runs.length > 1 && <>
      <label className="field"><span>Compare earlier run with latest</span><select aria-label="History baseline" value={baselineId} disabled={disabled} onChange={(event) => setBaselineId(event.target.value)}>
        <option value="">Choose an earlier run</option>{library.runs.slice(0, -1).map((run, index) => <option key={run.id} value={run.id}>Run {index + 1} · {new Date(run.completedAt).toLocaleString()}</option>)}
      </select></label>
      <p>Matching request identities do not prove identical inputs, credentials or contract versions. Request labels come from the current workspace and are not stored in history. Duration differences are observations, not performance guarantees.</p>
      {comparison && <table aria-label="Saved result comparison"><thead><tr><th>Request</th><th>Earlier → latest</th><th>HTTP</th><th>Assertions</th><th>Duration change</th></tr></thead><tbody>{comparison.map((row, index) => <tr key={row.request}>
        <td>{library.requestLabels?.[row.request] ?? `Request ${index + 1} (definition unavailable)`}</td><td>{row.previous ?? "absent"} → {row.current ?? "absent"}</td><td>{row.previousHttp ?? "—"} → {row.currentHttp ?? "—"}</td><td>{row.assertionsChanged ? "Changed" : "Unchanged"}</td><td>{row.durationChange !== undefined ? `${row.durationChange} ms` : "Unavailable"}</td>
      </tr>)}</tbody></table>}
    </>}
    {message && <p role="status">{message}</p>}
    <button type="button" className="secondary-button" disabled={disabled} onClick={() => void perform(async () => {
      if (!await window.studio.clearWorkflowLibrary()) throw new Error("CANCELED");
    }, "Testing library cleared on this device.")}>Clear testing library on this device</button>
  </details>;
}
