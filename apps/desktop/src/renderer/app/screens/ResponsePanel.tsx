import { useEffect, useMemo, useRef, useState } from "react";
import { isCredentialName, redactAgentValue, REDACTED } from "@openapi-collection-studio/core";
import type { ResponseHistoryEntry, ResponseState, ResponseTab } from "../types";
import { Copy, Search, Save } from "lucide-react";
import { formatBytes, formatHistoryTime, looksLikeJson, tabLabel } from "../helpers";
import { ResponseTokenBinding, type TokenBindingContext } from "./ResponseTokenBinding";
import type { TokenBindingReview } from "../responseTokenBinding";
import { responseTokenFields } from "../responseTokenBinding";

const RESPONSE_FONT_SIZES = [11, 12, 14, 16, 18] as const;
const DEFAULT_RESPONSE_FONT_SIZE = 12;
const RESPONSE_FONT_STORAGE_KEY = "specfold.responseFontSize";

export function ResponsePanel({
  response,
  history,
  onAssignResponseValue,
  onSaveResponseExample,
  environmentVariableNames,
  folderTokenTarget,
  tokenBindingContext,
  tokenIssuer = false,
  onBindToken
}: {
  response?: ResponseState;
  history: ResponseHistoryEntry[];
  onAssignResponseValue(path: string, variableName: string, folderId?: string): void;
  onSaveResponseExample(response: ResponseState): void;
  environmentVariableNames: string[];
  folderTokenTarget?: { id: string; name: string; variableName?: string };
  tokenBindingContext?: TokenBindingContext;
  tokenIssuer?: boolean;
  onBindToken?(review: TokenBindingReview): void;
}) {
  const [responseTab, setResponseTab] = useState<ResponseTab>("body");
  const [assignPath, setAssignPath] = useState("access_token");
  const [assignVariable, setAssignVariable] = useState("accessToken");
  const [historyIndex, setHistoryIndex] = useState(0);
  const [responseFontSize, setResponseFontSize] = useState(readResponseFontSize);
  const [responseSearch, setResponseSearch] = useState("");
  const [prettyJson, setPrettyJson] = useState(true);
  const [copyStatus, setCopyStatus] = useState("");
  const [revealedResponse, setRevealedResponse] = useState<ResponseState>();
  const bodyView = useRef<HTMLDetailsElement>(null);
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
    setRevealedResponse(undefined);
  }, [response?.status, response?.body, response?.rawBody]);

  useEffect(() => {
    setAssignVariable(
      folderTokenVariable ??
      (folderTokenTargetName ? folderTokenVariableName(folderTokenTargetName) : "accessToken")
    );
  }, [folderTokenTargetId, folderTokenTargetName, folderTokenVariable]);

  // Show the selected history entry when browsing; otherwise the live response.
  const displayed = history[historyIndex]?.response ?? response;
  const originalBody = displayed?.rawBody || displayed?.body || "";
  const isJsonResponse = Boolean(displayed && !displayed.error && looksLikeJson(originalBody));
  const hasToken = useMemo(() => isJsonResponse && responseTokenFields(originalBody).length > 0, [originalBody, isJsonResponse]);
  const sensitive = tokenIssuer || hasToken || Boolean(displayed?.collectionTokenCapture);
  const masked = sensitive && revealedResponse !== displayed;
  const shown = useMemo(() => masked && displayed ? maskAuthResponse(displayed) : displayed, [displayed, masked]);
  useEffect(() => {
    if (bodyView.current) bodyView.current.open = true;
  }, [displayed]);
  const selectedText = shown
    ? responseTab === "headers"
      ? JSON.stringify(shown.headers, null, 2)
      : responseTab === "raw"
        ? shown.rawBody
        : shown.body
    : "";
  const jsonSource = shown && responseTab === "body" ? shown.rawBody || shown.body : selectedText;
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
            onChange={(event) => {
              setHistoryIndex(Number(event.target.value));
              setRevealedResponse(undefined);
              setCopyStatus("");
            }}
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
          <span>{shown?.error}</span>
          <button
            className="secondary-button"
            onClick={() => { if (shown) void copyText(responseErrorDetails(shown), "Copied error details."); }}
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
          <details className="response-body-view" ref={bodyView} open>
          <summary>Response content</summary>
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
              disabled={masked}
              onClick={() => onSaveResponseExample(displayed)}
              title={masked ? "Reveal the original response before saving it as an example." : undefined}
              type="button"
            >
              <Save size={14} />
              Save example
            </button>
          </div>
          {sensitive && <div className="response-copy-status">
            <span>{masked ? "Credentials are hidden from the response and clipboard." : "Original response is visible and may contain credentials."}</span>
            {" "}
            <button className="secondary-button" onClick={() => {
              setRevealedResponse(masked ? displayed : undefined);
              setCopyStatus("");
            }} type="button">{masked ? "Reveal sensitive response" : "Hide credentials"}</button>
          </div>}
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
          </details>
          {displayed.collectionTokenCapture === "saved" && <p className="response-copy-status" role="status">Collection token set. Eligible requests use it automatically.</p>}
          {displayed.collectionTokenCapture === "skipped" && <p className="response-copy-status" role="status">The collection token was not set automatically. Check the Auth settings or save it manually below.</p>}
          {isJsonResponse && tokenBindingContext && onBindToken && (
            <details className="response-advanced"><summary>Use a response field as a token</summary>
              <ResponseTokenBinding body={originalBody} context={tokenBindingContext} onApply={onBindToken} />
            </details>
          )}
          {isJsonResponse && (
            <>
            <details className="response-advanced"><summary>Advanced: save any response field to a variable</summary>
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
            </details>
            </>
          )}
        </>
      ) : (
        <div className="empty-response">Status, timing, size, headers, and body appear after Send.</div>
      )}
    </aside>
  );
}

function maskAuthResponse(response: ResponseState): ResponseState {
  const original = response.rawBody || response.body;
  const secrets = new Set<string>();
  const credential = (name: string) => !/^token[_-]?type$/i.test(name) &&
    (isCredentialName(name) || /^(?:auth|credentials?|jwt|bearer|session[_-]?id|signature)$/i.test(name));
  let seen = 0;
  let body = original ? "[Non-object or incomplete response hidden. Reveal the original to inspect it.]" : "";
  let parsed: unknown;
  try {
    // Opening an authorization response should never display an opaque,
    // malformed or incomplete token by default.
    if (original.length <= 1024 * 1024 && !response.truncated) {
      const value: unknown = JSON.parse(original);
      if (value && typeof value === "object" && !Array.isArray(value)) parsed = value;
    }
  } catch { /* Keep the safe placeholder, never fall back to raw text. */ }
  function collect(value: unknown, hide = false, depth = 0): void {
    if (++seen > 10_000 || depth > 32) throw new Error("Auth response is too complex to mask.");
    if (typeof value === "string" || typeof value === "number") {
      if (hide && String(value).trim()) {
        secrets.add(String(value));
        if (secrets.size > 100) throw new Error("Too many credential fields to mask.");
      }
    } else if (value && typeof value === "object") {
      for (const [name, child] of Object.entries(value)) collect(child, hide || credential(name), depth + 1);
    }
  }
  function cleanText(value: string): string {
    let text = value;
    for (const secret of secrets) {
      text = text.replaceAll(secret, REDACTED);
      if (text.length > 1024 * 1024) return REDACTED;
    }
    return redactAgentValue(text);
  }
  function cleanJson(value: unknown): unknown {
    if (typeof value === "string") return cleanText(value);
    if (typeof value === "number") return redactAgentValue(secrets.has(String(value)) ? REDACTED : value);
    if (Array.isArray(value)) return value.map(cleanJson);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([name, child]) =>
      [cleanText(name), credential(name) ? REDACTED : cleanJson(child)]));
  }
  let headers: Record<string, string>;
  try {
    collect(response.headers);
    if (parsed) {
      collect(parsed);
      body = JSON.stringify(cleanJson(parsed), null, 2);
    }
    // Location and custom response headers can echo credentials from the
    // token response. Reveal all original headers only on explicit intent.
    headers = Object.fromEntries(Object.entries(response.headers).map(([name, value]) => [
      cleanText(name), /^(?:content-type|cache-control)$/i.test(name) ? cleanText(value) : REDACTED
    ]));
  } catch {
    headers = {};
  }
  // These errors are constructed locally, before credentials can reach a remote
  // response; preserving the variable names helps the user fill in Auth inputs.
  const localError = response.status === 0 && !original &&
    /^(?:Missing variables|Request timed out|Request canceled)$/.test(response.statusText);
  return {
    ...response, rawBody: body, body, headers,
    statusText: cleanText(response.statusText),
    error: response.error && (localError ? cleanText(response.error)
      : "Authentication request failed. Inspect the request URL, credentials and secure connection settings.")
  };
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
