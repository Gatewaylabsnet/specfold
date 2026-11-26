import { useState } from "react";
import { FolderPlus, Play } from "lucide-react";
import { flattenRequests, type Collection } from "@openapi-collection-studio/core";

export type PreviewSchemaUpdate = (targetCollectionId: string, openApiText: string, requestIds: string[]) => Promise<void>;

export function SchemaUpdateScreen({ collections, initialCollectionId, onPreview, onBack }: {
  collections: Collection[];
  initialCollectionId: string;
  onPreview: PreviewSchemaUpdate;
  onBack(): void;
}) {
  const [collectionId, setCollectionId] = useState(initialCollectionId);
  const [source, setSource] = useState("");
  const [requestIds, setRequestIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const candidates = collections.filter((collection) => collection.openApi?.sourceFormat === "openapi3");
  const target = candidates.find((collection) => collection.id === collectionId);
  const requests = target ? flattenRequests(target).filter(({ request }) => request.openApi?.sourceFormat === "openapi3") : [];
  const selectedIds = requests.filter(({ request }) => requestIds.includes(request.id)).map(({ request }) => request.id);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not prepare the schema update."); }
    finally { setBusy(false); }
  };
  const openFile = () => run(async () => {
    const result = await window.studio.openImportFile();
    if (result.error) throw new Error(result.error);
    if (!result.canceled && result.content !== undefined) setSource(result.content);
  });

  const preview = () => {
    if (busy || !target || !source.trim() || selectedIds.length === 0) return;
    void run(() => onPreview(target.id, source, selectedIds));
  };

  return (
    <section className="import-layout schema-update-layout" aria-label="OpenAPI schema update">
      <div className="pane">
        <div className="pane__header">
          <h2>Update OpenAPI schemas</h2>
          <div className="button-row">
            <button className="secondary-button" disabled={busy} onClick={onBack} type="button">Back to import</button>
            <button className="secondary-button" disabled={busy} onClick={() => void openFile()} type="button">
              <FolderPlus size={16} /> Open file
            </button>
            <button className="primary-button" disabled={busy || !target || !source.trim() || !selectedIds.length} onClick={preview} type="button">
              <Play size={16} /> {busy ? "Working…" : "Preview schema update"}
            </button>
          </div>
        </div>
        <textarea
          aria-label="Updated OpenAPI document"
          className="source-textarea"
          disabled={busy}
          onChange={(event) => { setSource(event.target.value); setError(""); }}
          placeholder="Paste the updated OpenAPI 3.x JSON or YAML, or choose a local file."
          spellCheck={false}
          value={source}
        />
      </div>
      <aside className="side-panel">
        <h3>Keep request data</h3>
        <p className="ops-hint">
          Only source contract information changes. Saved bodies, URLs, params, headers, auth, environments, and response examples stay unchanged. No requests are sent, added, or deleted.
        </p>
        <label className="field">
          <span>Existing OpenAPI collection</span>
          <select disabled={busy} value={target?.id ?? ""} onChange={(event) => {
            setCollectionId(event.target.value); setRequestIds([]); setError("");
          }}>
            <option value="">Choose a collection</option>
            {candidates.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
          </select>
        </label>
        {!candidates.length && <p className="ops-hint">Import an OpenAPI 3.x collection before using schema updates.</p>}
        {!!requests.length && <>
          <div className="ops-header">
            <h3>Requests to update</h3>
            <span className="ops-count">{selectedIds.length}/{requests.length} selected</span>
          </div>
          <p className="ops-hint">Select requests that exist in the updated document. Shared schemas may affect other requests in this collection; review those effects before applying.</p>
          <div className="ops-list">
            {requests.map(({ request, folderPath }) => {
              const method = (request.openApi?.method ?? request.method).toUpperCase();
              const path = request.openApi?.path ?? request.url;
              const label = [...folderPath.map((folder) => folder.name), request.name].join(" / ");
              return <label key={request.id} className="check-row ops-row" title={`${label} · ${method} ${path}`}>
                <input
                  disabled={busy}
                  checked={selectedIds.includes(request.id)}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setRequestIds((previous) => checked ? [...previous, request.id] : previous.filter((id) => id !== request.id));
                    setError("");
                  }}
                  type="checkbox"
                />
                <span className={`method method--${method.toLowerCase()}`}>{method}</span>
                <span className="ops-path">{label} · {path}</span>
              </label>;
            })}
          </div>
        </>}
        {error && <div className="status-box status-box--error" role="alert">{error}</div>}
      </aside>
    </section>
  );
}
