import { useEffect, useState } from "react";
import { Activity, Plus } from "lucide-react";
import { type Collection, type Environment, type EnvironmentVariable, type Folder, flattenFolders } from "@openapi-collection-studio/core";
import type { ConnectionTestResult } from "../../../shared/contracts";
import { createEnvironmentVariable, environmentBaseUrl, isBaseUrlVariable, replaceEnvironmentCustomVariables } from "../helpers";
import { baseUrlRouting, inheritedBaseUrl } from "../routing";

export function EnvironmentScreen({
  environments,
  activeEnvironmentId,
  activeCollection,
  selectedFolderId,
  folderOptions,
  onSelectEnvironment,
  onCreateEnvironment,
  onDeleteEnvironment,
  onUpdateEnvironmentBaseUrl,
  onUpdateCollection,
  onUpdateFolder,
  onUpdateEnvironment,
  onTestConnection
}: {
  environments: Environment[];
  activeEnvironmentId?: string;
  activeCollection?: Collection;
  selectedFolderId?: string;
  folderOptions: ReturnType<typeof flattenFolders>;
  onSelectEnvironment(environmentId: string): void;
  onCreateEnvironment(): void;
  onDeleteEnvironment(environmentId: string): void;
  onUpdateEnvironmentBaseUrl(environmentId: string, value: string): boolean;
  onUpdateCollection(recipe: (collection: Collection) => void): void;
  onUpdateFolder(folderId: string, recipe: (folder: Folder) => void): void;
  onUpdateEnvironment(environmentId: string, recipe: (environment: Environment) => void): void;
  onTestConnection(url: string): Promise<ConnectionTestResult>;
}) {
  const active = environments.find((environment) => environment.id === activeEnvironmentId) ?? environments[0];
  const currentBaseUrl = active ? environmentBaseUrl(active) : "";
  const [baseUrlDraft, setBaseUrlDraft] = useState(currentBaseUrl);
  const [connectionTest, setConnectionTest] = useState<ConnectionTestResult>();
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const selectedFolder = selectedFolderId
    ? folderOptions.find(({ folder }) => folder.id === selectedFolderId)?.folder
    : undefined;
  const routing = activeCollection
    ? baseUrlRouting(activeCollection, selectedFolder, folderOptions, currentBaseUrl, active?.name)
    : undefined;
  const customVariables = active?.variables.filter((variable) => !isBaseUrlVariable(variable)) ?? [];
  useEffect(() => {
    setBaseUrlDraft(currentBaseUrl);
    setConnectionTest(undefined);
  }, [active?.id, currentBaseUrl]);

  const commitBaseUrl = () => {
    if (!active) {
      return;
    }
    if (baseUrlDraft.trim() === currentBaseUrl.trim()) {
      setBaseUrlDraft(currentBaseUrl);
      return;
    }
    const accepted = onUpdateEnvironmentBaseUrl(active.id, baseUrlDraft);
    if (!accepted) {
      setBaseUrlDraft(currentBaseUrl);
    }
  };

  const testConnection = async () => {
    const value = baseUrlDraft.trim();
    if (!value) {
      setConnectionTest({ ok: false, url: "", error: "Set an environment base URL before testing it." });
      return;
    }
    if (active && value !== currentBaseUrl.trim()) {
      const accepted = onUpdateEnvironmentBaseUrl(active.id, value);
      if (!accepted) {
        setBaseUrlDraft(currentBaseUrl);
        return;
      }
    }
    setIsTestingConnection(true);
    setConnectionTest(undefined);
    try {
      setConnectionTest(await onTestConnection(value));
    } catch (error) {
      setConnectionTest({
        ok: false,
        url: value,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  return (
    <section className="environment-layout">
      <aside className="side-panel">
        <div className="pane__header">
          <h2>Connection profiles</h2>
          <button className="icon-button" onClick={onCreateEnvironment} title="New environment" type="button">
            <Plus size={16} />
          </button>
        </div>
        {environments.map((environment) => (
          <button
            className={environment.id === active?.id ? "list-button is-active" : "list-button"}
            key={environment.id}
            onClick={() => onSelectEnvironment(environment.id)}
            type="button"
          >
            {environment.name}
          </button>
        ))}
      </aside>
      <div className="pane">
        {active ? (
          <>
            <div className="pane__header">
              <input
                aria-label="Environment name"
                className="title-input"
                onBlur={() =>
                  onUpdateEnvironment(active.id, (environment) => {
                    environment.name = environment.name.trim() || "Environment";
                  })
                }
                onChange={(event) =>
                  onUpdateEnvironment(active.id, (environment) => {
                    environment.name = event.target.value;
                  })
                }
                value={active.name}
              />
              <button
                className="secondary-button"
                disabled={environments.length <= 1}
                onClick={() => onDeleteEnvironment(active.id)}
                title={environments.length <= 1 ? "At least one environment is required" : "Delete environment"}
                type="button"
              >
                Delete
              </button>
            </div>
            <p className="connection-profile-help">
              A named profile keeps a base URL and variables together. Switch profiles from the top bar without changing your collections.
            </p>
            <label className="field environment-base-url">
              <span>Environment base URL</span>
              <span className="environment-base-url__row">
                <input
                  aria-label="Environment base URL"
                  onBlur={commitBaseUrl}
                  onChange={(event) => {
                    setBaseUrlDraft(event.target.value);
                    setConnectionTest(undefined);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void testConnection();
                    }
                    if (event.key === "Escape") {
                      setBaseUrlDraft(currentBaseUrl);
                    }
                  }}
                  placeholder="https://api.example.com"
                  value={baseUrlDraft}
                />
                <button
                  className="secondary-button"
                  disabled={!baseUrlDraft.trim() || isTestingConnection}
                  onClick={() => void testConnection()}
                  type="button"
                >
                  <Activity size={16} />
                  {isTestingConnection ? "Testing..." : "Test connection"}
                </button>
              </span>
              <small>Sends a lightweight HEAD request. A 401 or 405 still confirms the API is reachable.</small>
            </label>
            {connectionTest && (
              <div
                className={connectionTest.ok ? "status-box status-box--success" : "status-box status-box--error"}
                role="status"
              >
                {connectionTest.ok
                  ? `Reachable: HTTP ${connectionTest.status} ${connectionTest.statusText} (${connectionTest.durationMs} ms)`
                  : `Could not reach this base URL: ${connectionTest.error ?? "Unknown error"}`}
              </div>
            )}
            <EnvironmentRoutingEditor
              activeCollection={activeCollection}
              activeEnvironmentBaseUrl={currentBaseUrl}
              activeFolder={selectedFolder}
              folderOptions={folderOptions}
              onUpdateCollection={onUpdateCollection}
              onUpdateFolder={onUpdateFolder}
              routing={routing}
            />
            <EnvironmentVariableEditor
              variables={customVariables}
              onChange={(variables) =>
                onUpdateEnvironment(active.id, (environment) => {
                  replaceEnvironmentCustomVariables(environment, variables);
                })
              }
            />
          </>
        ) : (
          <div className="empty-state">
            <h2>No environment yet</h2>
            <button className="primary-button" onClick={onCreateEnvironment} type="button">
              <Plus size={16} />
              Create environment
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function EnvironmentRoutingEditor({
  activeCollection,
  activeEnvironmentBaseUrl,
  activeFolder,
  folderOptions,
  onUpdateCollection,
  onUpdateFolder,
  routing
}: {
  activeCollection?: Collection;
  activeEnvironmentBaseUrl: string;
  activeFolder?: Folder;
  folderOptions: ReturnType<typeof flattenFolders>;
  onUpdateCollection(recipe: (collection: Collection) => void): void;
  onUpdateFolder(folderId: string, recipe: (folder: Folder) => void): void;
  routing?: { effective: string; source: string };
}) {
  if (!activeCollection) {
    return null;
  }

  return (
    <section className="environment-routing" aria-label="Base URL routing">
      <div className="environment-routing__header">
        <div>
          <h3>Base URL routing</h3>
          <p>Environment is the default. Collections and selected folders can override it when a proxy needs a different route.</p>
        </div>
        <div className="base-url-panel__summary" role="note">
          <span>Resolved route</span>
          <code title={routing?.effective}>{routing?.effective || "Not configured"}</code>
          <small>{routing?.source}</small>
        </div>
      </div>
      <div className="environment-routing__fields">
        <label className="field">
          <span>Collection base URL</span>
          <input
            aria-label="Collection base URL"
            onChange={(event) =>
              onUpdateCollection((collection) => {
                const value = event.target.value.trim();
                collection.baseUrl = value || undefined;
              })
            }
            placeholder={activeEnvironmentBaseUrl || "https://api.example.com/service"}
            value={activeCollection.baseUrl ?? ""}
          />
          <small>Overrides the environment default for this collection. Empty means use the environment base URL.</small>
        </label>
        {activeFolder && (
          <label className="field">
            <span>Selected folder base URL</span>
            <input
              aria-label="Folder base URL"
              onChange={(event) =>
                onUpdateFolder(activeFolder.id, (folder) => {
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
            <small>{activeFolder.name} and its children use this route. Empty restores inheritance.</small>
          </label>
        )}
      </div>
    </section>
  );
}

export function EnvironmentVariableEditor({
  variables,
  onChange
}: {
  variables: EnvironmentVariable[];
  onChange(variables: EnvironmentVariable[]): void;
}) {
  const update = (id: string, patch: Partial<EnvironmentVariable>) => {
    onChange(variables.map((variable) => (variable.id === id ? { ...variable, ...patch } : variable)));
  };

  return (
    <div className="env-table">
      <div className="env-table__head">
        <span>Enabled</span>
        <span>Name</span>
        <span>Value</span>
        <span>Secret</span>
        <span />
      </div>
      {variables.map((variable) => (
        <div className="env-table__row" key={variable.id}>
          <input
            checked={variable.enabled}
            onChange={(event) => update(variable.id, { enabled: event.target.checked })}
            type="checkbox"
          />
          <input
            onChange={(event) => update(variable.id, { name: event.target.value })}
            value={variable.name}
          />
          <input
            onChange={(event) => update(variable.id, { value: event.target.value })}
            type={variable.secret ? "password" : "text"}
            value={variable.value}
          />
          <input
            checked={Boolean(variable.secret)}
            onChange={(event) => update(variable.id, { secret: event.target.checked })}
            type="checkbox"
          />
          <button
            className="icon-button"
            onClick={() => onChange(variables.filter((candidate) => candidate.id !== variable.id))}
            title="Remove variable"
            type="button"
          >
            x
          </button>
        </div>
      ))}
      <button
        className="secondary-button"
        onClick={() => onChange([...variables, createEnvironmentVariable("", "")])}
        type="button"
      >
        <Plus size={16} />
        Add variable
      </button>
    </div>
  );
}
