import { useEffect, useState } from "react";
import type { ResponseHistoryEntry, ResponseState, ResponseTab } from "../types";
import { Copy, Save } from "lucide-react";
import { formatBytes, formatHistoryTime, looksLikeJson, tabLabel } from "../helpers";

const RESPONSE_FONT_SIZES = [11, 12, 14, 16, 18] as const;
const DEFAULT_RESPONSE_FONT_SIZE = 12;
const RESPONSE_FONT_STORAGE_KEY = "specfold.responseFontSize";

export function ResponsePanel({
  response,
  history,
  onAssignResponseValue,
  onSaveResponseExample,
  environmentVariableNames,
  folderTokenTarget
}: {
  response?: ResponseState;
  history: ResponseHistoryEntry[];
  onAssignResponseValue(path: string, variableName: string, folderId?: string): void;
  onSaveResponseExample(response: ResponseState): void;
  environmentVariableNames: string[];
  folderTokenTarget?: { id: string; name: string; variableName?: string };
}) {
  const [responseTab, setResponseTab] = useState<ResponseTab>("body");
  const [assignPath, setAssignPath] = useState("access_token");
  const [assignVariable, setAssignVariable] = useState("accessToken");
  const [historyIndex, setHistoryIndex] = useState(0);
  const [responseFontSize, setResponseFontSize] = useState(readResponseFontSize);
  const folderTokenTargetId = folderTokenTarget?.id;
  const folderTokenTargetName = folderTokenTarget?.name;
  const folderTokenVariable = folderTokenTarget?.variableName;

  useEffect(() => {
    setResponseTab("body");
    // A fresh send resets the view to the latest response.
    setHistoryIndex(0);
  }, [response?.status, response?.body, response?.rawBody]);

  useEffect(() => {
    setAssignVariable(
      folderTokenVariable ??
      (folderTokenTargetName ? folderTokenVariableName(folderTokenTargetName) : "accessToken")
    );
  }, [folderTokenTargetId, folderTokenTargetName, folderTokenVariable]);

  // Show the selected history entry when browsing; otherwise the live response.
  const displayed = history[historyIndex]?.response ?? response;
  const isJsonResponse = Boolean(displayed && !displayed.error && looksLikeJson(displayed.rawBody));
  const displayedText = displayed
    ? responseTab === "headers"
      ? JSON.stringify(displayed.headers, null, 2)
      : responseTab === "raw"
        ? displayed.rawBody
        : displayed.body
    : "";
  const fontSizeIndex = RESPONSE_FONT_SIZES.indexOf(
    responseFontSize as (typeof RESPONSE_FONT_SIZES)[number]
  );
  const changeResponseFontSize = (direction: -1 | 1) => {
    const nextIndex = Math.min(
      RESPONSE_FONT_SIZES.length - 1,
      Math.max(0, fontSizeIndex + direction)
    );
    const nextSize = RESPONSE_FONT_SIZES[nextIndex];
    setResponseFontSize(nextSize);
    localStorage.setItem(RESPONSE_FONT_STORAGE_KEY, String(nextSize));
  };

  return (
    <aside className="response-panel">
      <div className="response-panel__head">
        <h2>Response</h2>
        <div className="response-panel__head-actions">
          <div className="response-font-controls" role="group" aria-label="Response text size">
            <button
              aria-label="Decrease response text size"
              disabled={fontSizeIndex <= 0}
              onClick={() => changeResponseFontSize(-1)}
              title="Decrease response text size"
              type="button"
            >
              A−
            </button>
            <span aria-live="polite">{responseFontSize}px</span>
            <button
              aria-label="Increase response text size"
              disabled={fontSizeIndex >= RESPONSE_FONT_SIZES.length - 1}
              onClick={() => changeResponseFontSize(1)}
              title="Increase response text size"
              type="button"
            >
              A+
            </button>
          </div>
          {displayed && !displayed.error && (
            <span className="status-pill">
              {displayed.status} | {displayed.durationMs} ms | {formatBytes(displayed.sizeBytes)}
            </span>
          )}
        </div>
      </div>
      {history.length > 1 && (
        <label className="history-row">
          <span>History</span>
          <select
            onChange={(event) => setHistoryIndex(Number(event.target.value))}
            value={historyIndex}
          >
            {history.map((entry, index) => (
              <option key={entry.at} value={index}>
                {index === 0 ? "Latest" : formatHistoryTime(entry.at)} — {entry.response.status} (
                {entry.response.durationMs} ms)
              </option>
            ))}
          </select>
        </label>
      )}
      {displayed?.error && <div className="status-box status-box--error">{displayed.error}</div>}
      {displayed?.truncated && (
        <div className="status-box status-box--warning">
          Response was larger than the size limit and has been truncated. Increase the limit in Settings if needed.
        </div>
      )}
      {displayed && !displayed.error ? (
        <>
          <div className="response-tabs">
            {(["body", "headers", "raw"] as ResponseTab[]).map((tab) => (
              <button
                className={responseTab === tab ? "tab is-active" : "tab"}
                key={tab}
                onClick={() => setResponseTab(tab)}
                type="button"
              >
                {tabLabel(tab)}
              </button>
            ))}
            <button
              className="secondary-button response-tabs__action"
              onClick={() => void navigator.clipboard.writeText(displayedText)}
              type="button"
            >
              <Copy size={14} />
              Copy
            </button>
            <button
              className="secondary-button response-tabs__action"
              onClick={() => onSaveResponseExample(displayed)}
              type="button"
            >
              <Save size={14} />
              Save example
            </button>
          </div>
          <pre style={{ fontSize: `${responseFontSize}px` }}>{displayedText}</pre>
          {isJsonResponse && (
            <div className="assign-row">
              <span className="assign-row__label">Save field to variable</span>
              <div className="assign-row__controls">
                <input
                  aria-label="Response field path"
                  onChange={(event) => setAssignPath(event.target.value)}
                  placeholder="access_token"
                  value={assignPath}
                />
                <input
                  aria-label="Target variable name"
                  list="known-variable-names"
                  onChange={(event) => setAssignVariable(event.target.value)}
                  placeholder="accessToken"
                  value={assignVariable}
                />
                <datalist id="known-variable-names">
                  {environmentVariableNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                <button
                  className="secondary-button"
                  disabled={!assignPath.trim() || !assignVariable.trim()}
                  onClick={() => onAssignResponseValue(assignPath, assignVariable)}
                  type="button"
                >
                  <Save size={16} />
                  Save
                </button>
                {folderTokenTarget && (
                  <button
                    className="secondary-button"
                    disabled={!assignPath.trim() || !assignVariable.trim()}
                    onClick={() =>
                      onAssignResponseValue(
                        assignPath,
                        assignVariable,
                        folderTokenTarget.id
                      )
                    }
                    title={`Save as the access token for ${folderTokenTarget.name}`}
                    type="button"
                  >
                    Save as folder token
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="empty-response">Status, timing, size, headers, and body appear after Send.</div>
      )}
    </aside>
  );
}

function readResponseFontSize(): number {
  const stored = Number(localStorage.getItem(RESPONSE_FONT_STORAGE_KEY));
  return RESPONSE_FONT_SIZES.includes(stored as (typeof RESPONSE_FONT_SIZES)[number])
    ? stored
    : DEFAULT_RESPONSE_FONT_SIZE;
}

function folderTokenVariableName(folderName: string): string {
  const words = folderName.match(/[A-Za-z0-9]+/g) ?? ["folder"];
  const [first, ...rest] = words;
  const base = [
    first.toLowerCase(),
    ...rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
  ].join("");
  const safeBase = /^[A-Za-z_]/.test(base) ? base : `folder${base}`;
  return `${safeBase}AccessToken`;
}
