import { useEffect, useState } from "react";
import { Copy, Plus, Send, Terminal, Wand2 } from "lucide-react";
import { flattenFolders, folderAccessTokenVariable, type ApiRequest, type AuthConfig, type Collection, type Environment, type Folder, type HttpMethod } from "@openapi-collection-studio/core";
import { KeyValueEditor } from "../../components/KeyValueEditor";
import { HorizontalSplitPane } from "../../components/HorizontalSplitPane";
import { methods } from "../types";
import { activeRequestFolderId, authForType, tabLabel } from "../helpers";
import { baseUrlRouting, inheritedBaseUrl, resolveRoutePreview } from "../routing";
import type { RequestTab, ResponseHistoryEntry, ResponseState } from "../types";
import { RequestBodyEditor } from "./RequestBodyEditor";
import { RequestAuthFields } from "./RequestAuthFields";
import { ResponsePanel } from "./ResponsePanel";

export function RequestWorkspace({
  activeCollection,
  activeEnvironmentBaseUrl,
  activeEnvironment,
  activeEnvironmentName,
  activeFolder,
  activeRequest,
  requestTab,
  response,
  folderOptions,
  isSending,
  onAddRequest,
  onAddJwtRequest,
  onUpdateRequest,
  onUpdateCollection,
  onUpdateFolder,
  onUpdateFolderTokenVariable,
  onMoveRequest,
  onRequestTabChange,
  onSend,
  onCopyCurl,
  onAssignResponseValue,
  onSaveResponseExample,
  environmentVariableNames,
  responseHistory
}: {
  activeCollection?: Collection;
  activeEnvironmentBaseUrl?: string;
  activeEnvironment?: Environment;
  activeEnvironmentName?: string;
  activeFolder?: Folder;
  activeRequest?: ApiRequest;
  requestTab: RequestTab;
  response?: ResponseState;
  folderOptions: ReturnType<typeof flattenFolders>;
  isSending: boolean;
  responseHistory: ResponseHistoryEntry[];
  onAddRequest(): void;
  onAddJwtRequest(): void;
  onUpdateRequest(recipe: (request: ApiRequest) => void): void;
  onUpdateCollection(recipe: (collection: Collection) => void): void;
  onUpdateFolder(recipe: (folder: Folder) => void): void;
  onUpdateFolderTokenVariable(folderId: string, variableName: string): void;
  onMoveRequest(folderId: string): void;
  onRequestTabChange(tab: RequestTab): void;
  onSend(): void;
  onCopyCurl(): void;
  onAssignResponseValue(path: string, variableName: string, folderId?: string): void;
  onSaveResponseExample(response: ResponseState): void;
  environmentVariableNames: string[];
}) {
  const requestFolderId = activeRequest ? activeRequestFolderId(activeCollection, activeRequest.id) : undefined;
  const requestFolder = requestFolderId
    ? folderOptions.find((option) => option.folder.id === requestFolderId)?.folder
    : undefined;
  // Tree selection may change while a request stays open. The preview must use
  // the request's own folder chain, not the incidental selected row.
  const routingFolder = activeRequest ? requestFolder : activeFolder;
  const routingFolderPath = routingFolder
    ? folderOptions.find((option) => option.folder.id === routingFolder.id)?.path ?? [routingFolder]
    : [];
  const inheritedTokenVariable = folderAccessTokenVariable(routingFolderPath);
  const activeFolderPath = activeFolder
    ? folderOptions.find((option) => option.folder.id === activeFolder.id)?.path ?? [activeFolder]
    : [];
  const parentTokenVariable = folderAccessTokenVariable(activeFolderPath.slice(0, -1));
  const routing = activeCollection
    ? baseUrlRouting(
        activeCollection,
        routingFolder,
        folderOptions,
        activeEnvironmentBaseUrl,
        activeEnvironmentName
      )
    : undefined;
  const routePreview = activeRequest
    ? resolveRoutePreview(activeRequest, activeEnvironment, activeCollection, routingFolder, folderOptions)
    : undefined;

  return (
    <HorizontalSplitPane
      top={<div className="request-panel">
        {activeCollection && (
          <div className="base-url-panel">
            <div className="base-url-panel__fields">
              <label className="field collection-base-url">
              <span>{activeFolder ? "Folder base URL" : "Collection base URL"}</span>
              {activeFolder ? (
                <input
                  aria-label="Folder base URL"
                  onChange={(event) =>
                    onUpdateFolder((folder) => {
                      const value = event.target.value.trim();
                      folder.baseUrl = value || undefined;
                    })
                  }
                  placeholder={inheritedBaseUrl(
                    activeCollection,
                    activeFolder,
                    folderOptions,
                    activeEnvironmentBaseUrl
                  )}
                  value={activeFolder.baseUrl ?? ""}
                />
              ) : (
                <input
                  aria-label="Collection base URL"
                  onChange={(event) =>
                    onUpdateCollection((collection) => {
                      const value = event.target.value.trim();
                      collection.baseUrl = value || undefined;
                    })
                  }
                  placeholder="https://api.example.com/service"
                  value={activeCollection.baseUrl ?? ""}
                />
              )}
              <small>
                {activeFolder
                  ? "Applies to this folder and its children. Clear it to inherit the resolved route above."
                  : "Used by this collection unless a folder overrides it."}
              </small>
              </label>
              {activeFolder && (
                <label className="field">
                  <span>Folder access token variable</span>
                  <input
                    aria-label="Folder access token variable"
                    onChange={(event) =>
                      onUpdateFolderTokenVariable(activeFolder.id, event.target.value.trim())
                    }
                    pattern="[A-Za-z_][A-Za-z0-9_.-]*"
                    placeholder={parentTokenVariable ?? "ordersAccessToken"}
                    title="Use a valid environment variable name, such as ordersAccessToken."
                    value={activeFolder.accessTokenVariable ?? ""}
                  />
                  <small>
                    Bearer requests can use this secret variable. Clear it to inherit from the parent folder.
                  </small>
                </label>
              )}
            </div>
            <div className="base-url-panel__summary" role="note">
              <span>Resolved route</span>
              <code title={routing?.effective}>{routing?.effective || "Not configured"}</code>
              <small>{routing?.source}</small>
            </div>
          </div>
        )}
        {activeRequest ? (
          <>
            <div className="request-line">
              <select
                aria-label="Method"
                onChange={(event) =>
                  onUpdateRequest((request) => {
                    request.method = event.target.value as HttpMethod;
                  })
                }
                value={activeRequest.method}
              >
                {methods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
              <input
                aria-label="Request URL"
                onChange={(event) =>
                  onUpdateRequest((request) => {
                    request.url = event.target.value;
                  })
                }
                value={activeRequest.url}
              />
              <button className="primary-button" disabled={isSending} onClick={onSend} type="button">
                <Send size={16} />
                {isSending ? "Sending" : "Send"}
              </button>
            </div>
            {routePreview && (
              <div className={routePreview.missing.length ? "request-route request-route--warning" : "request-route"} role="status">
                <span>{routePreview.missing.length ? "Needs values" : "Will send"}</span>
                <code title={routePreview.url}>{routePreview.url}</code>
                {routePreview.missing.length > 0 && <small>Missing: {routePreview.missing.join(", ")}</small>}
                {!routePreview.missing.length && (
                  <button
                    aria-label="Copy resolved URL"
                    className="secondary-button"
                    onClick={() => void navigator.clipboard.writeText(routePreview.url)}
                    title="Copy resolved URL"
                    type="button"
                  >
                    <Copy size={14} />
                    Copy
                  </button>
                )}
              </div>
            )}
            <div className="request-meta">
              <RequestNameInput
                key={activeRequest.id}
                name={activeRequest.name}
                onCommit={(name) =>
                  onUpdateRequest((request) => {
                    request.name = name;
                  })
                }
              />
              <select
                aria-label="Move request"
                onChange={(event) => onMoveRequest(event.target.value)}
                value={activeRequestFolderId(activeCollection, activeRequest.id) ?? ""}
              >
                <option value="">Collection root</option>
                {folderOptions.map(({ folder, path }) => (
                  <option key={folder.id} value={folder.id}>
                    {path.map((item) => item.name).join(" / ")}
                  </option>
                ))}
              </select>
              <button className="secondary-button" onClick={onCopyCurl} title="Copy as cURL" type="button">
                <Terminal size={16} />
                cURL
              </button>
            </div>
            <div className="request-tabs">
              {(["params", "auth", "headers", "body"] as RequestTab[]).map((tab) => (
                <button
                  className={requestTab === tab ? "tab is-active" : "tab"}
                  key={tab}
                  onClick={() => onRequestTabChange(tab)}
                  type="button"
                >
                  {tabLabel(tab)}
                </button>
              ))}
            </div>
            <RequestTabPanel
              activeRequest={activeRequest}
              folderAccessTokenVariable={inheritedTokenVariable}
              onUpdateRequest={onUpdateRequest}
              tab={requestTab}
            />
          </>
        ) : (
          <div className="empty-state">
            <h2>No request selected</h2>
            <div className="button-row">
              <button className="primary-button" disabled={!activeCollection} onClick={onAddRequest} type="button">
                <Plus size={16} />
                New request
              </button>
              <button className="secondary-button" disabled={!activeCollection} onClick={onAddJwtRequest} type="button">
                <Wand2 size={16} />
                JWT request
              </button>
            </div>
          </div>
        )}
      </div>}
      bottom={<ResponsePanel
        response={response}
        history={responseHistory}
        onAssignResponseValue={onAssignResponseValue}
        onSaveResponseExample={onSaveResponseExample}
        environmentVariableNames={environmentVariableNames}
        folderTokenTarget={routingFolder ? {
          id: routingFolder.id,
          name: routingFolder.name,
          variableName: routingFolder.accessTokenVariable
        } : undefined}
      />}
    />
  );
}

function RequestNameInput({ name, onCommit }: { name: string; onCommit(name: string): void }) {
  const [draft, setDraft] = useState(name);

  useEffect(() => {
    setDraft(name);
  }, [name]);

  const commit = () => {
    if (draft !== name) {
      onCommit(draft);
    }
  };

  return (
    <input
      aria-label="Request name"
      onBlur={commit}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      value={draft}
    />
  );
}

export function RequestTabPanel({
  activeRequest,
  folderAccessTokenVariable,
  tab,
  onUpdateRequest
}: {
  activeRequest: ApiRequest;
  folderAccessTokenVariable?: string;
  tab: RequestTab;
  onUpdateRequest(recipe: (request: ApiRequest) => void): void;
}) {
  if (tab === "params") {
    return (
      <div className="tab-panel">
        <h3>Query parameters</h3>
        <KeyValueEditor
          onChange={(values) =>
            onUpdateRequest((request) => {
              request.queryParams = values;
            })
          }
          values={activeRequest.queryParams}
        />
        <h3>Path parameters</h3>
        <KeyValueEditor
          onChange={(values) =>
            onUpdateRequest((request) => {
              request.pathParams = values;
            })
          }
          values={activeRequest.pathParams}
        />
      </div>
    );
  }

  if (tab === "headers") {
    return (
      <div className="tab-panel">
        <h3>Headers</h3>
        <KeyValueEditor
          onChange={(values) =>
            onUpdateRequest((request) => {
              request.headers = values;
            })
          }
          values={activeRequest.headers}
        />
      </div>
    );
  }

  if (tab === "auth") {
    return (
      <div className="tab-panel tab-panel--narrow">
        <label className="field">
          <span>Auth type</span>
          <select
            onChange={(event) =>
              onUpdateRequest((request) => {
                request.auth = authForType(event.target.value as AuthConfig["type"]);
              })
            }
            value={activeRequest.auth.type}
          >
            <option value="none">None</option>
            <option value="bearer">Bearer token</option>
            <option value="basic">Basic</option>
            <option value="apiKey">API key</option>
          </select>
        </label>
        <RequestAuthFields
          auth={activeRequest.auth}
          folderAccessTokenVariable={folderAccessTokenVariable}
          onChange={(auth) =>
            onUpdateRequest((request) => {
              request.auth = auth;
            })
          }
        />
      </div>
    );
  }

  return (
    <RequestBodyEditor
      body={activeRequest.body}
      onChange={(body) =>
        onUpdateRequest((request) => {
          request.body = body;
        })
      }
    />
  );
}
