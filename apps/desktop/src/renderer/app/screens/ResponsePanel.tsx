import { useEffect, useState } from "react";
import type { ResponseHistoryEntry, ResponseState, ResponseTab } from "../types";
import { Copy, Search, Save } from "lucide-react";
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
  const [responseSearch, setResponseSearch] = useState("");
  const [prettyJson, setPrettyJson] = useState(true);
  const [copyStatus, setCopyStatus] = useState("");
  const folderTokenTargetId = folderTokenTarget?.id;
  const folderTokenTargetName = folderTokenTarget?.name;
  const folderTokenVariable = folderTokenTarget?.variableName;

  useEffect(() => {
    setResponseTab("body");
    // A fresh send resets the view to the latest response.
    setHistoryIndex(0);
    setResponseSearch("");
    setPrettyJson(true);
    setCopyStatus("");
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
  const selectedText = displayed
    ? responseTab === "headers"
      ? JSON.stringify(displayed.headers, null, 2)
      : responseTab === "raw"
        ? displayed.rawBody
        : displayed.body
    : "";
  const jsonSource = displayed && responseTab === "body" ? displayed.rawBody || displayed.body : selectedText;
  const canFormatJson = responseTab !== "headers" && looksLikeJson(jsonSource);
  const displayedText = canFormatJson ? (prettyJson ? formatJson(jsonSource) : jsonSource) : selectedText;
  const searchMatchCount = countMatches(displayedText, responseSearch);
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
  const copyText = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(message);
    } catch {
      setCopyStatus("Could not copy to the clipboard.");
    }
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
              <option key={`${entry.at}-${index}`} value={index}>
                {index === 0 ? "Latest" : formatHistoryTime(entry.at)} — {entry.response.status} (
                {entry.response.durationMs} ms)
              </option>
            ))}
          </select>
        </label>
      )}
      {displayed?.error && (
        <div className="status-box status-box--error response-error" role="alert">
          <span>{displayed.error}</span>
          <button
            className="secondary-button"
            onClick={() => void copyText(responseErrorDetails(displayed), "Copied error details.")}
            type="button"
          >
            <Copy size={14} />
            Copy error details
          </button>
        </div>
      )}
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
              onClick={() => void copyText(displayedText, "Copied response content.")}
              type="button"
            >
              <Copy size={14} />
              Copy
            </button>
            {canFormatJson && (
              <button
                aria-pressed={prettyJson}
                className="secondary-button response-tabs__action"
                onClick={() => setPrettyJson((current) => !current)}
                type="button"
              >
                {prettyJson ? "Raw JSON" : "Pretty JSON"}
              </button>
            )}
            <button
              className="secondary-button response-tabs__action"
              onClick={() => onSaveResponseExample(displayed)}
              type="button"
            >
              <Save size={14} />
              Save example
            </button>
          </div>
          <div className="response-find">
            <Search size={14} />
            <input
              aria-label="Find in response"
              onChange={(event) => setResponseSearch(event.target.value)}
              placeholder="Find in response"
              type="search"
              value={responseSearch}
            />
            {responseSearch && <span>{searchMatchCount > 500 ? "500+ matches" : `${searchMatchCount} match${searchMatchCount === 1 ? "" : "es"}`}</span>}
          </div>
          <pre style={{ fontSize: `${responseFontSize}px` }}>
            <ResponseText text={displayedText} query={responseSearch} />
          </pre>
          {copyStatus && <div className="response-copy-status" role="status">{copyStatus}</div>}
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

function formatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function countMatches(text: string, query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  const source = text.toLowerCase();
  let from = 0;
  let count = 0;
  while (count <= 500) {
    const index = source.indexOf(needle, from);
    if (index < 0) return count;
    count += 1;
    from = index + needle.length;
  }
  return count;
}

function ResponseText({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (!needle || countMatches(text, needle) > 500) return text;
  const pattern = new RegExp(`(${escapeRegExp(needle)})`, "gi");
  return text.split(pattern).map((part, index) =>
    part.toLowerCase() === needle.toLowerCase()
      ? <mark key={index}>{part}</mark>
      : part
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function responseErrorDetails(response: ResponseState): string {
  return [
    `Status: ${response.statusText}${response.status ? ` (${response.status})` : ""}`,
    `Error: ${response.error ?? "Unknown error"}`,
    response.rawBody ? `Response body:\n${response.rawBody}` : ""
  ].filter(Boolean).join("\n\n");
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
