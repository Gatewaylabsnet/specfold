import { Download, FolderPlus, Import, Play } from "lucide-react";
import type { GroupingStrategy, ImportOperationSummary } from "@openapi-collection-studio/core";

export function ImportScreen({
  importText,
  importUrl,
  isFetchingUrl,
  grouping,
  importSummary,
  importError,
  operations,
  selectedOperationKeys,
  onToggleOperation,
  onSelectAllOperations,
  onTextChange,
  onImportUrlChange,
  onFetchUrl,
  onOpenFile,
  onOpenPostmanFolder,
  onGroupingChange,
  onPreview,
  onImport,
  postmanFolderPath
}: {
  importText: string;
  importUrl: string;
  isFetchingUrl: boolean;
  grouping: GroupingStrategy;
  importSummary: string;
  importError: string;
  operations: ImportOperationSummary[];
  selectedOperationKeys: Set<string>;
  onToggleOperation(key: string, index: number, shiftKey: boolean): void;
  onSelectAllOperations(selectAll: boolean): void;
  onTextChange(value: string): void;
  onImportUrlChange(value: string): void;
  onFetchUrl(): void;
  onOpenFile(): void;
  onOpenPostmanFolder(): void;
  onGroupingChange(value: GroupingStrategy): void;
  onPreview(): void;
  onImport(): void;
  postmanFolderPath: string;
}) {
  const importDisabled =
    (!importText.trim() && !postmanFolderPath) ||
    (operations.length > 0 && selectedOperationKeys.size === 0);

  return (
    <section className="import-layout">
      <div className="pane">
        <div className="pane__header">
          <h2>Import</h2>
          <div className="button-row">
            <button className="secondary-button" onClick={onOpenFile} type="button">
              <FolderPlus size={16} />
              Open file
            </button>
            <button className="secondary-button" onClick={onOpenPostmanFolder} type="button">
              <FolderPlus size={16} />
              Postman v3 folder
            </button>
            <button className="secondary-button" onClick={onPreview} type="button">
              <Play size={16} />
              Preview
            </button>
            <button className="primary-button" disabled={importDisabled} onClick={onImport} type="button">
              <Import size={16} />
              Import
              {operations.length > 0 && ` (${selectedOperationKeys.size})`}
            </button>
          </div>
        </div>
        <div className="import-url-row">
          <input
            aria-label="Import from URL"
            onChange={(event) => onImportUrlChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && importUrl.trim() && !isFetchingUrl) {
                onFetchUrl();
              }
            }}
            placeholder="https://example.com/openapi.json — fetch a document by URL"
            value={importUrl}
          />
          <button
            className="secondary-button"
            disabled={!importUrl.trim() || isFetchingUrl}
            onClick={onFetchUrl}
            type="button"
          >
            <Download size={16} />
            {isFetchingUrl ? "Fetching..." : "Fetch"}
          </button>
        </div>
        {postmanFolderPath && (
          <div className="status-box import-folder-status">
            Postman v3 folder: {postmanFolderPath}
          </div>
        )}
        <textarea
          className="source-textarea"
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="Paste OpenAPI 3.x, Swagger 2.0, Postman v2, Insomnia JSON, HAR, .http/.rest, Specfold Collection JSON, or a curl command — or load a file, URL, or Postman v3 folder above"
          spellCheck={false}
          value={importText}
        />
      </div>
      <aside className="side-panel">
        <h3>Grouping</h3>
        <label className="radio-row">
          <input
            checked={grouping === "tags"}
            onChange={() => onGroupingChange("tags")}
            type="radio"
          />
          <span>Tags</span>
        </label>
        <label className="radio-row">
          <input
            checked={grouping === "firstPathSegment"}
            onChange={() => onGroupingChange("firstPathSegment")}
            type="radio"
          />
          <span>First path segment</span>
        </label>
        <label className="radio-row">
          <input
            checked={grouping === "singleFolder"}
            onChange={() => onGroupingChange("singleFolder")}
            type="radio"
          />
          <span>Single folder</span>
        </label>
        {operations.length > 0 && (
          <>
            <div className="ops-header">
              <h3>Operations</h3>
              <span className="ops-count">
                {selectedOperationKeys.size}/{operations.length} selected
              </span>
            </div>
            <div className="button-row ops-actions">
              <button
                className="secondary-button"
                disabled={selectedOperationKeys.size === operations.length}
                onClick={() => onSelectAllOperations(true)}
                type="button"
              >
                Select all
              </button>
              <button
                className="secondary-button"
                disabled={selectedOperationKeys.size === 0}
                onClick={() => onSelectAllOperations(false)}
                type="button"
              >
                Deselect all
              </button>
            </div>
            <p className="ops-hint">Tip: Shift-click to select a range.</p>
            <div className="ops-list">
              {operations.map((operation, index) => (
                <label
                  className="check-row ops-row"
                  key={operation.key}
                  title={operation.summary ?? operation.path}
                >
                  <input
                    checked={selectedOperationKeys.has(operation.key)}
                    onChange={() => {}}
                    onClick={(event) =>
                      onToggleOperation(operation.key, index, event.shiftKey)
                    }
                    type="checkbox"
                  />
                  <span className={`method method--${operation.method.toLowerCase()}`}>
                    {operation.method}
                  </span>
                  <span className="ops-path">{operation.path}</span>
                </label>
              ))}
            </div>
          </>
        )}
        <div className={importError ? "status-box status-box--error" : "status-box"}>
          {importError || importSummary || "Preview results appear here."}
        </div>
      </aside>
    </section>
  );
}
