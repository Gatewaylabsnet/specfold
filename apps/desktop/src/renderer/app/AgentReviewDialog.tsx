import { useEffect, useRef, useState } from "react";
import type { AgentPlanReview } from "../../shared/contracts";

export function AgentReviewDialog({ review, busy, error, onApply, onReject, onRefresh, onClose }: {
  review: AgentPlanReview; busy: boolean; error: string;
  onApply(approvedAffectedRequestIds?: string[]): void; onReject(): void; onRefresh(): void; onClose(): void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const schema = review.schemaUpdate;
  const requestUpdate = review.requestUpdate;
  const noChange = (schema || requestUpdate) && !schema?.changed && !requestUpdate?.changed;
  const approvalRequired = (schema?.affectedRequestIds.length ?? 0) > 0;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key !== "Tab") return;
      const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>("*") ?? []).filter((item) => {
        if (!item.matches("button:not(:disabled), input:not(:disabled), summary, [tabindex='0']")) return false;
        const closed = item.closest("details:not([open])");
        return !closed || (item.tagName === "SUMMARY" && item.parentElement === closed);
      });
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose, busy]);
  return <div className="modal-backdrop" role="presentation">
    <section ref={dialog} tabIndex={-1} className="about-dialog agent-review" role="dialog" aria-modal="true" aria-labelledby="agent-review-title">
      <div className="about-dialog__header"><h2 id="agent-review-title">{requestUpdate && schema ? "Review request and schema updates"
        : requestUpdate ? "Review request updates" : schema ? "Review OpenAPI schema update" : "Review agent changes"}</h2>
        <button className="icon-button" aria-label="Close review" disabled={busy} onClick={onClose} type="button">×</button></div>
      <h3>{review.collection.name}</h3>
      {review.collection.baseUrl && <p className="agent-route">{review.collection.baseUrl}</p>}
      {!schema && !requestUpdate && <div className="agent-summary">
        <span><strong>{review.diff.added.length}</strong> new requests</span>
        <span><strong>{review.diff.changed.length}</strong> updated requests</span>
        <span><strong>{review.diff.retained}</strong> unchanged requests</span>
      </div>}
      {requestUpdate && <section aria-label="Saved request changes">
        <p>Body fields and HTTP headers are separate. Only the listed edits will be applied. No request is added or removed.</p>
        {!requestUpdate.changed && <p>No saved body or HTTP header changes are needed.</p>}
        {requestUpdate.requests.map(({ requestId, operation, changes, warnings }) => <details key={requestId} open>
          <summary>{operation} · {changes.length} request edits</summary>
          <ul>{changes.map(({ scope, message }, index) => <li key={index}><strong>{scope}:</strong> {message}</li>)}</ul>
          {warnings.length > 0 && <ul className="muted">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        </details>)}
      </section>}
      {schema && <div>
        <p><strong>Kept as saved:</strong> request and folder identities and order, {requestUpdate ? "unlisted body and header data, " : "bodies, headers, "}
          URLs, methods, parameters, auth, environments, and saved response examples.</p>
        <p>No operation is added or removed. Source schemas and examples can change independently of saved request data.</p>
        <details open><summary>Selected operations ({schema.selectedOperations.length})</summary>
          <ul>{schema.selectedOperations.map((item) => <li key={item.id}>{item.operation}</li>)}</ul>
        </details>
        {approvalRequired && <details open><summary>Other operations affected by shared schemas ({schema.affectedRequestIds.length})</summary>
          <ul>{schema.affectedOperations.map((item) => <li key={item.id}>{item.operation}</li>)}</ul>
          <label className="check-row"><input type="checkbox" checked={acknowledged} disabled={busy || review.status !== "pending"}
            onChange={(event) => setAcknowledged(event.target.checked)} />I approve the shared schema changes affecting these other operations.</label>
        </details>}
        <details open><summary>Schema changes ({schema.changes.length})</summary>
          {schema.changes.length > 0 ? <ul>{schema.changes.map(({ scope, message }, index) => <li key={index}><strong>{scope}</strong>: {message}</li>)}</ul>
            : <p>{schema.changed ? "Source metadata changed." : "No schema changes are needed."}</p>}
        </details>
        {schema.warnings.length > 0 && <details open><summary>Preserved data and contract warnings ({schema.warnings.length})</summary>
          <ul>{schema.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
        </details>}
      </div>}
      {review.intent.apinizer && <p>An Apinizer JWT request and bearer references are included.</p>}
      {(review.intent.tokenVariable || review.intent.variableName) && <p>Token variable: <code>{review.intent.tokenVariable ?? review.intent.variableName}</code>. Its value stays in Specfold.</p>}
      <p>No API request will be sent by applying this change.</p>
      {review.status === "stale" && <div className="status-box status-box--warning" role="alert">{requestUpdate
        ? "Your workspace changed. Ask the MCP client for a fresh preview using the new revision."
        : "Your workspace changed. Refresh the preview and review it before applying."}</div>}
      {review.warnings.length > 0 && <details open><summary>Warnings ({review.warnings.length})</summary><ul>{review.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
      {!schema && !requestUpdate && <details><summary>Request changes</summary><ul>
        {review.diff.added.map((item) => <li key={`add-${item}`}>Add: <code>{item}</code></li>)}
        {review.diff.changed.map((item) => <li key={`change-${item}`}>Update: <code>{item}</code></li>)}
      </ul></details>}
      {error && <div className="status-box status-box--warning" role="alert">{error}</div>}
      <div className="button-row agent-review__actions">
        <button className="secondary-button" disabled={busy} onClick={onReject} type="button">Cancel changes</button>
        {!requestUpdate && (review.status === "stale" || error) && <button className="secondary-button" disabled={busy}
          onClick={() => { setAcknowledged(false); onRefresh(); }} type="button">Refresh preview</button>}
        <button className="primary-button"
          disabled={busy || review.status !== "pending" || !!noChange || (approvalRequired && !acknowledged)}
          onClick={() => onApply(approvalRequired ? schema?.affectedRequestIds : undefined)} type="button">
          {busy ? "Working…" : requestUpdate && schema ? "Apply request and schema updates" : requestUpdate ? "Apply request updates"
            : schema ? "Apply schema update" : "Apply changes"}
        </button>
      </div>
    </section>
  </div>;
}
