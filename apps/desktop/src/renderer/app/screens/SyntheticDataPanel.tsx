import { useState } from "react";
import { syntheticBodyDraft, type ApiRequest, type Collection, type RequestBody, type SyntheticDraft } from "@openapi-collection-studio/core";

export function SyntheticDataPanel({ request, collection, onApply }: { request: ApiRequest; collection: Collection; onApply(body: RequestBody): void }) {
  const [seed, setSeed] = useState("1"), [reviewed, setReviewed] = useState(false);
  const [draft, setDraft] = useState<{ value: SyntheticDraft; request: ApiRequest; collection: Collection }>();
  const current = draft?.request === request && draft.collection === collection;
  return <details className="workflow-advanced"><summary>Synthetic JSON test data</summary>
    <p>Generate locally from supported schema constraints. Examples, defaults and sensitive properties are not copied. No request is sent.</p>
    <label className="field"><span>Synthetic seed</span><input aria-label="Synthetic seed" type="number" min="0" max="4294967295" step="1" value={seed} onChange={(event) => { setSeed(event.target.value); setDraft(undefined); setReviewed(false); }} /></label>
    <button type="button" className="secondary-button" onClick={() => { setDraft({ value: syntheticBodyDraft(request, collection, seed.trim() ? Number(seed) : NaN), request, collection }); setReviewed(false); }}>Generate synthetic draft</button>
    {draft && !current && <p role="status">The request changed. Generate a new draft before applying.</p>}
    {current && draft && <>
      {draft.value.warnings.map((warning, index) => <p role="status" key={index}>{warning}</p>)}
      {draft.value.status === "ready" && <>
        <pre aria-label="Synthetic JSON draft">{draft.value.json}</pre>
        <p>This remains generated data. Applying it changes the saved request body for manual testing; it does not turn it into a documented example or bypass guided-workflow input checks.</p>
        <label className="check-row"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />I reviewed the generated body and approve replacing this request body.</label>
        <button type="button" className="secondary-button" disabled={!reviewed} onClick={() => {
          if (!current || !reviewed || !draft.value.json) return;
          onApply({ ...request.body, mode: "json", contentType: "application/json", raw: draft.value.json }); setDraft(undefined); setReviewed(false);
        }}>Apply reviewed synthetic body</button>
      </>}
      <button type="button" className="secondary-button" onClick={() => { setDraft(undefined); setReviewed(false); }}>Discard synthetic draft</button>
    </>}
  </details>;
}
