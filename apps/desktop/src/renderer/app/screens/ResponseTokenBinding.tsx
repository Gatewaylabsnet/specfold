import { useEffect, useRef, useState } from "react";
import { flattenFolders, type Workspace } from "@openapi-collection-studio/core";
import { prepareTokenBinding, responseTokenFields, tokenBindingTargets, type TokenBindingIntent, type TokenBindingReview } from "../responseTokenBinding";

export interface TokenBindingContext {
  workspace: Workspace; collectionId: string; environmentId: string; sourceRequestId: string;
  folderId?: string; secureStorageAvailable: boolean;
}
export function ResponseTokenBinding({ body, context, onApply }: {
  body: string; context: TokenBindingContext; onApply(review: TokenBindingReview): void;
}) {
  const fields = responseTokenFields(body);
  const collection = context.workspace.collections.find((item) => item.id === context.collectionId);
  const environment = context.workspace.environments.find((item) => item.id === context.environmentId);
  const [path, setPath] = useState(fields[0] ?? "access_token");
  const [scope, setScope] = useState(() => {
    if (!context.folderId) return "collection";
    const candidates = tokenBindingTargets(context.workspace, { collectionId: context.collectionId, environmentId: context.environmentId,
      sourceRequestId: context.sourceRequestId, folderId: context.folderId, path: fields[0] ?? "access_token", variableName: "token", requestIds: [] }, body);
    return candidates.some((row) => !row.excluded) ? context.folderId : "collection";
  });
  const [variableName, setVariableName] = useState(() => {
    const stem = `${collection?.name ?? "api"}AccessToken`.replace(/[^A-Za-z0-9_]/g, "").slice(0, 90) || "apiAccessToken";
    const safe = /^[A-Za-z_]/.test(stem) ? stem : `api${stem}`;
    let name = safe, index = 2;
    while (environment?.variables.some((item) => item.name === name)) name = `${safe}${index++}`;
    return name;
  });
  const [selected, setSelected] = useState<string[] | undefined>();
  const [review, setReview] = useState<TokenBindingReview>();
  const reviewedBody = useRef<string>();
  const [error, setError] = useState("");
  const intent: TokenBindingIntent = { collectionId: context.collectionId, environmentId: context.environmentId,
    sourceRequestId: context.sourceRequestId, folderId: scope === "collection" ? undefined : scope,
    path, variableName, requestIds: [] };
  const rows = tokenBindingTargets(context.workspace, intent, body);
  const ids = selected ?? rows.filter((row) => row.recommended).map((row) => row.id);
  useEffect(() => { setReview(undefined); setSelected(undefined); setError(""); }, [body, context.workspace]);
  function prepare() {
    try { setReview(prepareTokenBinding(context.workspace, body, { ...intent, requestIds: ids })); reviewedBody.current = body; setError(""); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not prepare token binding."); }
  }
  return <section className="response-token-binding" aria-label="Use response token">
    <h3>Use this token</h3>
    <p>Save it securely and choose which requests will use it. No request is sent.</p>
    <div className="workflow-grid">
      <label className="field"><span>Token field</span><select aria-label="Token field" value={fields.includes(path) ? path : ""}
        onChange={(event) => { setPath(event.target.value); setReview(undefined); }}>
        {!fields.includes(path) && <option value="">Choose a field or use Advanced</option>}
        {fields.map((field) => <option key={field} value={field}>{field}</option>)}
      </select></label>
      <label className="field"><span>Use in</span><select aria-label="Token scope" value={scope}
        onChange={(event) => { setScope(event.target.value); setSelected(undefined); setReview(undefined); }}>
        <option value="collection">Selected collection</option>
        {collection && flattenFolders(collection).map(({ folder, path: folderPath }) => <option key={folder.id} value={folder.id}>
          Folder: {folderPath.map((item) => item.name).join(" / ")} (including subfolders)
        </option>)}
      </select></label>
    </div>
    <p>Collection: {collection?.name}. Environment: {environment?.name}. {ids.length} requests selected.</p>
    {!rows.some((row) => !row.excluded) && <p role="status">No service requests in this scope. Choose another folder or the collection.</p>}
    <details><summary>Choose requests ({ids.length})</summary>
      <div className="token-request-list">{rows.map((row) => <label className="check-row" key={row.id}>
        <input type="checkbox" aria-label={`Bind token to ${row.name}`} checked={ids.includes(row.id)} disabled={row.excluded}
          onChange={(event) => { setSelected(event.target.checked ? [...ids, row.id] : ids.filter((id) => id !== row.id)); setReview(undefined); }} />
        <span>{row.method} {row.name} — {row.excluded ? "Token request excluded" : `Current auth: ${row.previousAuth}`}</span>
      </label>)}</div>
      <p>Existing Basic/API-key or Authorization headers need explicit selection. Selected requests will use Bearer authentication.</p>
    </details>
    <details><summary>Advanced: token path and variable</summary>
      <label className="field"><span>JSON field path</span><input aria-label="Token JSON path" value={path}
        onChange={(event) => { setPath(event.target.value); setReview(undefined); }} /></label>
      <label className="field"><span>Token variable name</span><input aria-label="Token variable name" value={variableName}
        onChange={(event) => { setVariableName(event.target.value); setReview(undefined); }} /></label>
    </details>
    {!context.secureStorageAvailable && <p role="alert">OS secure storage is required before saving a token.</p>}
    {error && <p role="alert">{error}</p>}
    <button type="button" className="primary-button" disabled={!ids.length || !context.secureStorageAvailable} onClick={prepare}>Review token use</button>
    {review && <TokenUseDialog review={review} disabled={!review.matches(context.workspace) || reviewedBody.current !== body || !context.secureStorageAvailable}
      onCancel={() => setReview(undefined)} onApply={() => {
        if (reviewedBody.current !== body) { setReview(undefined); setError("The response changed. Review token use again."); return; }
        onApply(review); setReview(undefined);
      }} />}
  </section>;
}

function TokenUseDialog({ review, disabled, onCancel, onApply }: {
  review: TokenBindingReview; disabled: boolean; onCancel(): void; onApply(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element?.showModal) element.showModal(); else element?.setAttribute("open", "");
    return () => { element?.close?.(); };
  }, []);
  return <dialog ref={dialog} aria-label="Confirm token use" className="token-binding-review"
    onCancel={(event) => { event.preventDefault(); onCancel(); }}>
      <h3>Confirm token use</h3>
      <p>{review.scopeName} · {review.environmentName}. {review.rows.length} requests will use the saved token.</p>
      <ul>{review.rows.map((row) => <li key={row.id}>{row.method} {row.name} <code>{row.route}</code> — {row.previousAuth} → Bearer</li>)}</ul>
      <p>{review.replacesVariable ? "The selected variable will be updated." : "A new encrypted token variable will be created."} Selected authentication and its old Authorization/API-key headers or query fields will be replaced. No requests are sent.</p>
      <button type="button" className="secondary-button" autoFocus onClick={onCancel}>Cancel token use</button>
      <button type="button" className="primary-button" disabled={disabled}
        onClick={onApply}>Save token and bind {review.rows.length} requests</button>
    </dialog>;
}
