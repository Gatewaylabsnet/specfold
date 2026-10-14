import type { WorkflowTestPlan } from "@openapi-collection-studio/core";
import { statusSummary } from "./model";

export function PreviewStep({ plan, baseUrl, maxTests, busy, running, canceling, onToggle, onBack, onRetry, onRun, onCancel }: {
  plan?: WorkflowTestPlan; baseUrl: string; maxTests: number; busy: boolean; running: boolean; canceling: boolean;
  onToggle(id: string, selected: boolean): void; onBack(): void; onRetry(): void; onRun(): void; onCancel(): void;
}) {
  const selected = plan?.rows.filter((row) => row.selected && row.status === "ready").length ?? 0;
  return <section aria-labelledby="workflow-preview-title">
    <h2 id="workflow-preview-title">Test preview</h2>
    <p>Review the inputs and destinations before sending requests. Ready GET, HEAD and OPTIONS requests are selected by default; every other method requires your selection.</p>
    <p className="workflow-note">Native confirmation is required for this exact plan. Tests run one at a time. Cancel stops pending work; requests already sent may have changed server data.</p>
    <dl className="workflow-facts"><div><dt>Target</dt><dd>{baseUrl}</dd></div>{plan && <><div><dt>Environment</dt><dd>{plan.environmentName}</dd></div>
      <div><dt>Plan ID</dt><dd><code>{plan.id}</code></dd></div></>}</dl>
    {plan?.authentication && <p>{plan.authentication}</p>}
    {!!plan?.warnings.length && <ul className="workflow-note">{plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    {plan ? <div className="workflow-table-scroll"><table className="workflow-table"><thead><tr><th>Run</th><th>Request</th><th>Effect</th><th>Inputs</th><th>Readiness</th></tr></thead>
      <tbody>{plan.rows.map((row) => <tr key={row.requestId}>
        <td><input type="checkbox" aria-label={`Select ${row.name}`} checked={row.selected && row.status === "ready"}
          disabled={busy || row.status !== "ready"} onChange={(event) => onToggle(row.requestId, event.target.checked)} /></td>
        <td><strong>{row.name}</strong><code>{row.method} {row.route}</code><small>Expected status: {statusSummary(row.expectedStatuses)}</small></td>
        <td>{row.effect === "read" ? "Read" : <strong className="workflow-risk">May change data</strong>}</td>
        <td>{row.provenance.length ? <ul>{row.provenance.map((input, index) => <li key={index}>{input.location}{input.field ? `: ${input.field}` : ""} — {input.source}{input.reason && <small>{input.reason}</small>}</li>)}</ul> : "No test input required"}</td>
        <td><span className={`workflow-status workflow-status--${row.status}`}>{row.status}</span>{row.reason && <small>{row.reason}</small>}</td>
      </tr>)}</tbody></table>{!plan.rows.length && <p>No requests were found in this collection.</p>}</div> : <p role="status">{busy ? "Preparing the test preview..." : "A fresh preview is required before running tests."}</p>}
    <div className="workflow-actions"><button className="secondary-button" type="button" disabled={busy} onClick={onBack}>Back to authentication</button>
      {!plan && !busy && <button className="secondary-button" type="button" onClick={onRetry}>Retry preview</button>}
      {running ? <button className="secondary-button" type="button" disabled={canceling} onClick={onCancel}>{canceling ? "Canceling..." : "Cancel run"}</button>
        : <button className="primary-button" type="button" disabled={busy || !plan || !selected || selected > maxTests} onClick={onRun}>Run selected tests</button>}
    </div>
    <p className={selected > maxTests ? "workflow-error" : undefined}>Select at most {maxTests} tests per run. The limit is 20 network sends including authentication{maxTests === 19 ? " (one send is reserved for the Apinizer token)" : ""}.</p>
    <p role="status">{running ? canceling ? "Cancellation requested. Waiting for the run to stop." : "Waiting for native approval or running selected tests..." : busy ? "Updating selection; the previous plan cannot run." : `${selected} ready request${selected === 1 ? "" : "s"} selected.`}</p>
  </section>;
}
