import { useEffect, useRef } from "react";
import type { AgentPlanReview } from "../../shared/contracts";

export function AgentReviewDialog({ review, busy, error, onApply, onReject, onRefresh, onClose }: {
  review: AgentPlanReview; busy: boolean; error: string;
  onApply(): void; onReject(): void; onRefresh(): void; onClose(): void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key !== "Tab") return;
      const items = dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), summary, [tabindex='0']");
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); previous?.focus(); };
  }, [onClose, busy]);
  return <div className="modal-backdrop" role="presentation">
    <section ref={dialog} tabIndex={-1} className="about-dialog agent-review" role="dialog" aria-modal="true" aria-labelledby="agent-review-title">
      <div className="about-dialog__header"><h2 id="agent-review-title">Review agent changes</h2>
        <button className="icon-button" aria-label="Close review" disabled={busy} onClick={onClose} type="button">×</button></div>
      <h3>{review.collection.name}</h3>
      {review.collection.baseUrl && <p className="agent-route">{review.collection.baseUrl}</p>}
      <div className="agent-summary">
        <span><strong>{review.diff.added.length}</strong> new requests</span>
        <span><strong>{review.diff.changed.length}</strong> updated requests</span>
        <span><strong>{review.diff.retained}</strong> unchanged requests</span>
      </div>
      {review.intent.apinizer && <p>An Apinizer JWT request and bearer references are included.</p>}
      {(review.intent.tokenVariable || review.intent.variableName) && <p>Token variable: <code>{review.intent.tokenVariable ?? review.intent.variableName}</code>. Its value stays in Specfold.</p>}
      <p>No API request will be sent by applying this change.</p>
      {review.status === "stale" && <div className="status-box status-box--warning" role="alert">Your workspace changed. Refresh the preview and review it before applying.</div>}
      {review.warnings.length > 0 && <details open><summary>Warnings ({review.warnings.length})</summary><ul>{review.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
      <details><summary>Request changes</summary><ul>
        {review.diff.added.map((item) => <li key={`add-${item}`}>Add: <code>{item}</code></li>)}
        {review.diff.changed.map((item) => <li key={`change-${item}`}>Update: <code>{item}</code></li>)}
      </ul></details>
      {error && <div className="status-box status-box--warning" role="alert">{error}</div>}
      <div className="button-row agent-review__actions">
        <button className="secondary-button" disabled={busy} onClick={onReject} type="button">Cancel changes</button>
        {(review.status === "stale" || error) && <button className="secondary-button" disabled={busy} onClick={onRefresh} type="button">Refresh preview</button>}
        <button className="primary-button" disabled={busy || review.status !== "pending"} onClick={onApply} type="button">{busy ? "Working…" : "Apply changes"}</button>
      </div>
    </section>
  </div>;
}
