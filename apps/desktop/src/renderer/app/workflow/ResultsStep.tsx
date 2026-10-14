import type { WorkflowRunReport } from "@openapi-collection-studio/core";

export function ResultsStep({ report, busy, onPreview, onExport, onReload }: {
  report: WorkflowRunReport; busy: boolean; onPreview(): void; onExport(): void; onReload(): void;
}) {
  return <section aria-labelledby="workflow-results-title">
    <h2 id="workflow-results-title">Results</h2>
    <p>Run {report.status}. Secret values are masked in this report. Review response content before sharing it; API data can still be sensitive.</p>
    <dl className="workflow-facts"><div><dt>Report ID</dt><dd><code>{report.id}</code></dd></div><div><dt>Plan ID</dt><dd><code>{report.planId}</code></dd></div></dl>
    <div className="workflow-totals">{(["passed", "failed", "skipped", "blocked"] as const).map((status) => <div key={status}><strong>{report.totals[status]}</strong><span>{status}</span></div>)}</div>
    {report.authentication && <p className="workflow-note">Authentication {report.authentication.status}: {report.authentication.message}</p>}
    <div className="workflow-results">{report.results.map((result) => <article key={result.requestId}>
      <div className="workflow-result-title"><h3>{result.name}</h3><span className={`workflow-status workflow-status--${result.status}`}>{result.status}</span></div>
      <code>{result.method} {result.route}</code>
      <p>{result.httpStatus !== undefined && `HTTP ${result.httpStatus}`}{result.durationMs !== undefined && ` · ${result.durationMs} ms`}{result.reason && ` · ${result.reason}`}</p>
      {!!result.assertions.length && <ul>{result.assertions.map((assertion, index) => <li key={index}><strong>{assertion.name}: {assertion.outcome}</strong> — {assertion.message}</li>)}</ul>}
      {result.response && <details><summary>Masked response{result.response.truncated ? " (truncated)" : ""}</summary><pre>{JSON.stringify(result.response.headers, null, 2)}</pre><pre>{result.response.body}</pre></details>}
    </article>)}</div>
    <div className="workflow-actions"><button type="button" className="primary-button" disabled={busy} onClick={onPreview}>Preview again</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={onExport}>Export JSON report</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={onReload}>Reload report</button></div>
  </section>;
}
