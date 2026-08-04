import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Settings } from "lucide-react";
import type { LocalDataInfo } from "../shared/contracts";
import { findFolder, flattenFolders } from "@openapi-collection-studio/core";
import { environmentBaseUrl, saveStatusLabel } from "./app/helpers";
import { CollectionsSidebar, WelcomeMain } from "./app/screens/CollectionsSidebar";
import { RequestWorkspace } from "./app/screens/RequestEditor";
import { useStudioController } from "./app/useStudioController";
import { useEditorShortcuts, useUnsavedExitWarning } from "./app/useEditorShortcuts";

const AboutDialog = lazy(() =>
  import("./app/AboutDialog").then((module) => ({ default: module.AboutDialog }))
);
const EnvironmentScreen = lazy(() =>
  import("./app/screens/EnvironmentScreen").then((module) => ({ default: module.EnvironmentScreen }))
);
const ExportScreen = lazy(() =>
  import("./app/screens/ExportScreen").then((module) => ({ default: module.ExportScreen }))
);
const ImportScreen = lazy(() =>
  import("./app/screens/ImportScreen").then((module) => ({ default: module.ImportScreen }))
);
const SettingsScreen = lazy(() =>
  import("./app/screens/SettingsScreen").then((module) => ({ default: module.SettingsScreen }))
);

export function App() {
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [updateCheckRequestId, setUpdateCheckRequestId] = useState(0);
  const [localDataInfo, setLocalDataInfo] = useState<LocalDataInfo>();
  const closeAbout = useCallback(() => {
    setIsAboutOpen(false);
    setUpdateCheckRequestId(0);
  }, []);
  const { workspace, setWorkspace, loaded, setLoaded, screen, setScreen,
    activeCollectionId, setActiveCollectionId, selectedFolderId, setSelectedFolderId,
    selectedRequestId, setSelectedRequestId, requestTab, setRequestTab, response, setResponse,
    responseHistory, setResponseHistory, isSending, setIsSending, importText, setImportText,
    postmanFolderSource, setPostmanFolderSource, postmanFolderPath, setPostmanFolderPath,
    importUrl, setImportUrl, isFetchingImport, setIsFetchingImport, importOperations,
    setImportOperations, selectedImportKeys, setSelectedImportKeys, lastImportIndexRef,
    grouping, setGrouping, importError, setImportError, importSummary, setImportSummary, importWarnings, setImportWarnings,
    importTargetCollectionId, setImportTargetCollectionId, importDiff, setImportDiff,
    exportFormat, setExportFormat, exportFolderIds, setExportFolderIds, includeAllComponents,
    setIncludeAllComponents, includeExamples, setIncludeExamples, pruneUnusedComponents,
    setPruneUnusedComponents, preferSourceOperation, setPreferSourceOperation, savedExportPath,
    setSavedExportPath, savedBackupPath, setSavedBackupPath, saveStatus, setSaveStatus,
    settings, setSettings, notice, setNotice, activeCollection, activeRequestLocation,
    activeRequest, activeEnvironment, exportResult, exportContent, mutateWorkspace,
    secureStorageAvailable,
    createNewWorkspace, addCollection, addFolder, addRequest, updateActiveRequest, moveActiveRequest,
    mutateCollection, openImportFile, openPostmanFolder, fetchImportUrl,
    toggleImportOperation, handlePreviewImport, handleImport, copyActiveRequestAsCurl,
    sendActiveRequest, updateEnvironment, updateEnvironmentBaseUrl, createNewEnvironment,
    updateSettings, assignResponseValue, saveResponseAsExample, saveExport, copyExportToClipboard, exportFullBackup,
    restoreFullBackup, deleteAllData, treeActions
  } = useStudioController();
  const activeFolder =
    activeRequestLocation?.folder ??
    (activeCollection && selectedFolderId
      ? findFolder(activeCollection, selectedFolderId)
      : undefined);
  const routingFolderId = activeFolder?.id ?? selectedFolderId;
  const refreshLocalDataInfo = useCallback(() => {
    void window.studio.getLocalDataInfo().then(setLocalDataInfo).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (loaded) refreshLocalDataInfo();
  }, [loaded, refreshLocalDataInfo]);
  useEffect(
    () =>
      window.studio.onAppMenuAction((action) => {
        if (action === "about" || action === "check-for-updates") {
          setUpdateCheckRequestId((requestId) =>
            action === "check-for-updates" ? requestId + 1 : 0
          );
          setIsAboutOpen(true);
          return;
        }
        setScreen(action);
      }),
    [setScreen]
  );
  useEditorShortcuts(() => {
    setScreen("editor");
    window.setTimeout(() => document.getElementById("request-search")?.focus(), 0);
  });
  useUnsavedExitWarning(saveStatus);
  if (!loaded) {
    return <div className="loading">Loading workspace...</div>;
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div>
            <h1>{workspace.name || "Workspace"}</h1>
          </div>
        </div>
        <div className="topbar__actions">
          <label className="topbar__environment">
            <span>Environment</span>
            <select
              onChange={(event) =>
                mutateWorkspace((draft) => {
                  draft.activeEnvironmentId = event.target.value || undefined;
                })
              }
              value={workspace.activeEnvironmentId ?? ""}
            >
              {workspace.environments.map((environment) => (
                <option key={environment.id} value={environment.id}>
                  {environment.name}
                </option>
              ))}
            </select>
          </label>
          <span className={`save-status save-status--${saveStatus}`}>{saveStatusLabel(saveStatus)}</span>
          <button
            aria-label="Settings"
            className={screen === "settings" ? "icon-button is-active" : "icon-button"}
            onClick={() => setScreen(screen === "settings" ? "editor" : "settings")}
            title="Settings"
            type="button"
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      {notice && (
        <div className="notice-banner">
          <span>{notice}</span>
          <button className="icon-button" onClick={() => setNotice(undefined)} type="button">
            x
          </button>
        </div>
      )}

      {!secureStorageAvailable && (
        <div className="notice-banner notice-banner--security" role="alert">
          Secure storage is unavailable. Secret values remain usable for this session but are never saved to disk.
        </div>
      )}

      <div className="workspace">
        <CollectionsSidebar
          activeCollection={activeCollection}
          onAddApinizerJwtRequest={() => addRequest("apinizer-jwt")}
          onAddOAuthClientRequest={() => addRequest("oauth-client")}
          onAddOAuthPasswordRequest={() => addRequest("oauth-password")}
          onAddCollection={addCollection}
          onAddFolder={addFolder}
          onAddJwtRequest={() => addRequest("jwt")}
          onAddRequest={() => addRequest("blank")}
          selectedFolderId={selectedFolderId}
          selectedRequestId={selectedRequestId}
          screen={screen}
          onScreenChange={setScreen}
          treeActions={treeActions}
          workspace={workspace}
        />
        <main className="workspace-main">
        <Suspense fallback={<div className="loading loading--screen">Loading screen...</div>}>
        {screen === "import" && (
          <ImportScreen
            grouping={grouping}
            importError={importError}
            importSummary={importSummary}
            importWarnings={importWarnings}
            importTargetCollectionId={importTargetCollectionId}
            importDiff={importDiff}
            collections={workspace.collections}
            importText={importText}
            importUrl={importUrl}
            isFetchingUrl={isFetchingImport}
            operations={importOperations}
            selectedOperationKeys={selectedImportKeys}
            onToggleOperation={toggleImportOperation}
            onSelectAllOperations={(selectAll) =>
              setSelectedImportKeys(
                selectAll
                  ? new Set(importOperations.map((operation) => operation.key))
                  : new Set()
              )
            }
            onFetchUrl={fetchImportUrl}
            onGroupingChange={setGrouping}
            onImport={handleImport}
            onImportUrlChange={setImportUrl}
            onImportTargetChange={setImportTargetCollectionId}
            onOpenFile={openImportFile}
            onOpenPostmanFolder={openPostmanFolder}
            onPreview={handlePreviewImport}
            onTextChange={(value) => {
              setPostmanFolderSource(undefined);
              setPostmanFolderPath("");
              setImportWarnings([]);
              setImportDiff(undefined);
              setImportText(value);
            }}
            postmanFolderPath={postmanFolderPath}
          />
        )}
        {screen === "editor" &&
          (workspace.collections.length === 0 ? (
            <WelcomeMain onImport={() => setScreen("import")} onNewCollection={addCollection} />
          ) : (
            <RequestWorkspace
              activeCollection={activeCollection}
              activeFolder={activeFolder}
              activeRequest={activeRequest}
              activeEnvironmentBaseUrl={activeEnvironment ? environmentBaseUrl(activeEnvironment) : undefined}
              activeEnvironment={activeEnvironment}
              activeEnvironmentName={activeEnvironment?.name}
              folderOptions={activeCollection ? flattenFolders(activeCollection) : []}
              isSending={isSending}
              onAddJwtRequest={() => addRequest("jwt")}
              onAddRequest={() => addRequest("blank")}
              onMoveRequest={moveActiveRequest}
              onRequestTabChange={setRequestTab}
              onSend={sendActiveRequest}
              onCopyCurl={copyActiveRequestAsCurl}
              onConfigureRouting={() => setScreen("environments")}
              onUpdateFolderTokenVariable={(folderId, variableName) =>
                activeCollection && mutateWorkspace((draft) => {
                  const collection = draft.collections.find(
                    (candidate) => candidate.id === activeCollection.id
                  );
                  const folder = collection ? findFolder(collection, folderId) : undefined;
                  if (!folder) return;
                  folder.accessTokenVariable = variableName || undefined;
                  if (!variableName) return;
                  for (const environment of draft.environments) {
                    const variable = environment.variables.find(
                      (candidate) => candidate.name === variableName
                    );
                    if (variable) variable.secret = true;
                  }
                })
              }
              onUpdateRequest={updateActiveRequest}
              onAssignResponseValue={assignResponseValue}
              onSaveResponseExample={saveResponseAsExample}
              environmentVariableNames={activeEnvironment?.variables.map((variable) => variable.name) ?? []}
              responseHistory={selectedRequestId ? responseHistory[selectedRequestId] ?? [] : []}
              requestTab={requestTab}
              response={response}
            />
          ))}
        {screen === "settings" && (
          <SettingsScreen
            settings={settings}
            onChange={updateSettings}
            workspaceName={workspace.name}
            onWorkspaceNameChange={(name) =>
              mutateWorkspace((draft) => {
                draft.name = name;
              })
            }
            onNewWorkspace={createNewWorkspace}
            onExportBackup={() => {
              void exportFullBackup().finally(refreshLocalDataInfo);
            }}
            onRestoreBackup={() => {
              void restoreFullBackup().finally(refreshLocalDataInfo);
            }}
            onDeleteAllData={() => {
              void deleteAllData().finally(refreshLocalDataInfo);
            }}
            localDataInfo={localDataInfo}
            onOpenLocalDataFolder={() => {
              void window.studio.openLocalDataFolder().then((result) => {
                setNotice(result.ok ? "Opened the local Specfold data folder." : `Could not open the data folder: ${result.error ?? "Unknown error"}`);
              });
            }}
            savedBackupPath={savedBackupPath}
          />
        )}
        {screen === "environments" && (
          <EnvironmentScreen
            activeEnvironmentId={workspace.activeEnvironmentId}
            activeCollection={activeCollection}
            environments={workspace.environments}
            folderOptions={activeCollection ? flattenFolders(activeCollection) : []}
            onCreateEnvironment={createNewEnvironment}
            onDeleteEnvironment={(environmentId) => {
              if (workspace.environments.length <= 1) {
                setNotice("At least one environment is required. Rename this environment instead.");
                return;
              }
              if (!window.confirm("Delete this environment and its variables? This cannot be undone.")) {
                return;
              }
              mutateWorkspace((draft) => {
                draft.environments = draft.environments.filter((environment) => environment.id !== environmentId);
                if (draft.activeEnvironmentId === environmentId) {
                  draft.activeEnvironmentId = draft.environments[0]?.id;
                }
              });
            }}
            onSelectEnvironment={(environmentId) =>
              mutateWorkspace((draft) => {
                draft.activeEnvironmentId = environmentId;
              })
            }
            onUpdateEnvironmentBaseUrl={updateEnvironmentBaseUrl}
            onUpdateCollection={(recipe) =>
              activeCollection && mutateCollection(activeCollection.id, recipe)
            }
            onUpdateFolder={(folderId, recipe) =>
              activeCollection && mutateCollection(activeCollection.id, (collection) => {
                const folder = findFolder(collection, folderId);
                if (folder) {
                  recipe(folder);
                }
              })
            }
            onUpdateEnvironment={updateEnvironment}
            onTestConnection={(url) => window.studio.testConnection(url)}
            selectedFolderId={routingFolderId}
          />
        )}
        {screen === "export" && (
          <ExportScreen
            activeCollection={activeCollection}
            exportContent={exportContent}
            exportWarnings={exportResult.warnings}
            exportCheck={exportResult.check}
            exportFolderIds={exportFolderIds}
            exportFormat={exportFormat}
            includeAllComponents={includeAllComponents}
            includeExamples={includeExamples}
            pruneUnusedComponents={pruneUnusedComponents}
            preferSourceOperation={preferSourceOperation}
            onExportFolderIdsChange={setExportFolderIds}
            onExportFormatChange={setExportFormat}
            onIncludeAllComponentsChange={setIncludeAllComponents}
            onIncludeExamplesChange={setIncludeExamples}
            onPruneUnusedComponentsChange={setPruneUnusedComponents}
            onPreferSourceOperationChange={setPreferSourceOperation}
            onCopy={copyExportToClipboard}
            onSave={saveExport}
            savedExportPath={savedExportPath}
          />
        )}
        </Suspense>
        </main>
      </div>
      {isAboutOpen && (
        <Suspense fallback={null}>
          <AboutDialog
            updateCheckRequestId={updateCheckRequestId}
            onClose={closeAbout}
          />
        </Suspense>
      )}
    </div>
  );
}
