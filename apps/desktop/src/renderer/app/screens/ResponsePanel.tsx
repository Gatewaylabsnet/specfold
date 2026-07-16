import { useEffect, useState } from "react";
import type { ResponseHistoryEntry, ResponseState, ResponseTab } from "../types";
import { Save } from "lucide-react";
import { formatBytes, formatHistoryTime, looksLikeJson, tabLabel } from "../helpers";

export function ResponsePanel({
  response,
  history,
  onAssignResponseValue,
  environmentVariableNames
}: {
  response?: ResponseState;
  history: ResponseHistoryEntry[];
  onAssignResponseValue(path: string, variableName: string): void;
  environmentVariableNames: string[];
}) {
  const [responseTab, setResponseTab] = useState<ResponseTab>("body");
  const [assignPath, setAssignPath] = useState("access_token");
  const [assignVariable, setAssignVariable] = useState("accessToken");
  const [historyIndex, setHistoryIndex] = useState(0);

  useEffect(() => {
    setResponseTab("body");
    // A fresh send resets the view to the latest response.
    setHistoryIndex(0);
  }, [response?.status, response?.body, response?.rawBody]);

  // Show the selected history entry when browsing; otherwise the live response.
  const displayed = history[historyIndex]?.response ?? response;
  const isJsonResponse = Boolean(displayed && !displayed.error && looksLikeJson(displayed.rawBody));

  return (
    <aside className="response-panel">
      <div className="response-panel__head">
        <h2>Response</h2>
        {displayed && !displayed.error && (
          <span className="status-pill">
            {displayed.status} | {displayed.durationMs} ms | {formatBytes(displayed.sizeBytes)}
          </span>
        )}
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
          </div>
          <pre>
            {responseTab === "headers"
              ? JSON.stringify(displayed.headers, null, 2)
              : responseTab === "raw"
                ? displayed.rawBody
                : displayed.body}
          </pre>
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
