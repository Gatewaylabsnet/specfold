import { useEffect, useRef } from "react";
import {
  cloneFolder, cloneRequest, countFolderRequests, createApinizerJwtRequest, createCollection,
  createEmptyWorkspace, createEnvironment, createFolder, createId, createJwtRequest,
  createKeyValue, createRequest, checkOpenApiDocument, exportCollectionToOpenApiResult,
  looksLikeCurl, parseCurlCommand, requestToCurl, findFolder, findRequest, flattenRequests,
  importDocument, importPostmanV3Folder, listOperations, previewImportDocument,
  previewPostmanV3Folder, relocateFolder, relocateRequest, removeFolder, removeRequest,
  serializeCollectionJson,
  type ApiRequest, type Collection, type Environment, type ExportWarning, type GroupingStrategy,
  type ImportOperationSummary, type OpenApiCheckResult, type PostmanV3FolderSource, type Workspace
} from "@openapi-collection-studio/core";
import { applyEnvironmentBaseUrlToCollection, createEnvironmentVariable, environmentBaseUrl, extractJsonPath, replaceEnvironmentCustomVariables, upsertEnvironmentBaseUrl } from "./helpers";
import { MAX_HISTORY_PER_REQUEST } from "./types";
import type { ResponseState } from "./types";
import type { StudioState } from "./useStudioState";
import type { WorkspaceController } from "./useWorkspaceController";
import { useSettingsUpdates } from "./useSettingsUpdates";
import { prepareCollectionTokenCapture } from "./collectionTokenCapture";

export function useRequestController(state: StudioState, workspaceController: WorkspaceController) {
  const { workspace, setWorkspace, loaded, setLoaded, screen, setScreen,
    activeCollectionId, setActiveCollectionId, selectedFolderId, setSelectedFolderId,
    selectedRequestId, setSelectedRequestId, requestTab, setRequestTab, response, setResponse,
    responseHistory, setResponseHistory, isSending, setIsSending, importText, setImportText,
    postmanFolderSource, setPostmanFolderSource, postmanFolderPath, setPostmanFolderPath,
    importUrl, setImportUrl, isFetchingImport, setIsFetchingImport, importOperations,
    setImportOperations, selectedImportKeys, setSelectedImportKeys, lastImportIndexRef,
    grouping, setGrouping, importError, setImportError, importSummary, setImportSummary,
    exportFormat, setExportFormat, exportFolderIds, setExportFolderIds, includeAllComponents,
    setIncludeAllComponents, includeExamples, setIncludeExamples, pruneUnusedComponents,
    setPruneUnusedComponents, preferSourceOperation, setPreferSourceOperation, savedExportPath,
    setSavedExportPath, savedBackupPath, setSavedBackupPath, saveStatus, setSaveStatus,
    settings, setSettings, notice, setNotice, activeCollection, activeRequestLocation,
    activeRequest, activeEnvironment, exportResult, exportContent, mutateWorkspace, saveWorkspaceNow } = state;
  const { updateActiveRequest } = workspaceController;
  const latest = useRef({ workspace, activeCollectionId, selectedRequestId, secure: state.secureStorageAvailable });
  latest.current = { workspace, activeCollectionId, selectedRequestId, secure: state.secureStorageAvailable };
  const sendInFlight = useRef(false);
  const copyActiveRequestAsCurl = async () => {
    if (!activeRequest) {
      return;
    }
    const curl = requestToCurl(activeRequest);
    try {
      await navigator.clipboard.writeText(curl);
      setNotice("Copied request as cURL to the clipboard.");
    } catch {
      setNotice(curl);
    }
  };

  const sendActiveRequest = async () => {
    if (!activeRequest || isSending || sendInFlight.current) {
      return;
    }
    const requestId = activeRequest.id;
    sendInFlight.current = true;
    setIsSending(true);
    setResponse(undefined);
    const folderPath = activeRequestLocation?.folderPath.map(({ baseUrl, accessTokenVariable }) => ({ baseUrl, accessTokenVariable }));
    try {
      const response = await window.studio.sendRequest(activeRequest, activeEnvironment, activeCollection, folderPath);
      const result: ResponseState = { ...response };
      const current = latest.current;
      if (response.tokenIssuerOrigin && activeCollection && activeEnvironment && !activeCollection.autoTokenCaptureDisabled) {
        const next = current.workspace === workspace && current.secure
          ? prepareCollectionTokenCapture(workspace, activeCollection.id, activeEnvironment.id, requestId, response.tokenIssuerOrigin, response.rawBody)
          : undefined;
        if (next) {
          setWorkspace((value) => value === workspace ? next : value);
          setSaveStatus("dirty");
        }
        result.collectionTokenCapture = next ? "saved" : "skipped";
      }
      // A response belongs to the request that was actually sent.
      if (current.activeCollectionId === activeCollection?.id && current.selectedRequestId === requestId) setResponse(result);
      if (!result.error && current.workspace.id === workspace.id) {
        setResponseHistory((history) => ({
          ...history,
          [requestId]: [{ at: new Date().toISOString(), response: result }, ...(history[requestId] ?? [])].slice(0, MAX_HISTORY_PER_REQUEST)
        }));
      }
    } catch {
      const current = latest.current;
      if (current.activeCollectionId === activeCollection?.id && current.selectedRequestId === requestId) {
        setResponse({ status: 0, statusText: "Request failed", durationMs: 0, sizeBytes: 0, headers: {}, body: "", rawBody: "",
          error: "The desktop could not send this request." });
      }
    } finally {
      sendInFlight.current = false;
      setIsSending(false);
    }
  };

  const toggleCollectionTokenCapture = (enabled: boolean) => {
    if (!activeCollection) return;
    mutateWorkspace((draft) => {
      const collection = draft.collections.find(({ id }) => id === activeCollection.id);
      if (collection) collection.autoTokenCaptureDisabled = !enabled;
    });
  };

  // Keyboard shortcuts: Ctrl/Cmd+Enter sends the active request,
  // Ctrl/Cmd+S saves the workspace immediately.
  const shortcutHandlers = useRef({ send: sendActiveRequest, save: saveWorkspaceNow });
  shortcutHandlers.current = { send: sendActiveRequest, save: saveWorkspaceNow };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void shortcutHandlers.current.send();
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void shortcutHandlers.current.save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const updateEnvironment = (environmentId: string, recipe: (environment: Environment) => void) => {
    setSaveStatus("dirty");
    setWorkspace((current) => {
      const index = current.environments.findIndex((candidate) => candidate.id === environmentId);
      if (index < 0) {
        return current;
      }
      // Environment edits should not clone a potentially large request tree.
      // Keeping collections referentially stable also keeps the tree responsive.
      const environment = {
        ...current.environments[index],
        variables: current.environments[index].variables.map((variable) => ({ ...variable }))
      };
      recipe(environment);
      const environments = [...current.environments];
      environments[index] = environment;
      return { ...current, environments, updatedAt: new Date().toISOString() };
    });
  };

  const updateEnvironmentBaseUrl = (environmentId: string, value: string): boolean => {
    const nextValue = value.trim();
    updateEnvironment(environmentId, (environment) => {
      upsertEnvironmentBaseUrl(environment, nextValue);
    });
    return true;
  };

  const createNewEnvironment = () => {
    const environment = createEnvironment(`Environment ${workspace.environments.length + 1}`);
    environment.variables = [createEnvironmentVariable("baseUrl", "")];
    setSaveStatus("dirty");
    setWorkspace((current) => {
      if (current.environments.some((candidate) => candidate.id === environment.id)) {
        return current;
      }
      return {
        ...current,
        environments: [...current.environments, environment],
        activeEnvironmentId: environment.id,
        updatedAt: new Date().toISOString()
      };
    });
  };

  const selectEnvironment = (environmentId: string) => {
    setSaveStatus("dirty");
    setWorkspace((current) => {
      if (
        current.activeEnvironmentId === environmentId ||
        !current.environments.some((environment) => environment.id === environmentId)
      ) {
        return current;
      }
      return { ...current, activeEnvironmentId: environmentId, updatedAt: new Date().toISOString() };
    });
  };

  const deleteEnvironment = (environmentId: string) => {
    setSaveStatus("dirty");
    setWorkspace((current) => {
      if (current.environments.length <= 1 || !current.environments.some((environment) => environment.id === environmentId)) {
        return current;
      }
      const environments = current.environments.filter((environment) => environment.id !== environmentId);
      return {
        ...current,
        environments,
        activeEnvironmentId: current.activeEnvironmentId === environmentId
          ? environments[0]?.id
          : current.activeEnvironmentId,
        updatedAt: new Date().toISOString()
      };
    });
  };

  const updateSettings = useSettingsUpdates(settings, setSettings, setNotice);

  const assignResponseValue = (path: string, variableName: string, folderId?: string) => {
    if (!response || !variableName.trim()) {
      return;
    }
    const extracted = extractJsonPath(response.rawBody || response.body, path);
    if (extracted === undefined) {
      setNotice(`Could not find "${path}" in the response body.`);
      return;
    }
    const value = typeof extracted === "string" ? extracted : JSON.stringify(extracted);
    mutateWorkspace((draft) => {
      let environment = draft.environments.find(
        (candidate) => candidate.id === draft.activeEnvironmentId
      );
      if (!environment) {
        environment = createEnvironment("Local");
        draft.environments.push(environment);
        draft.activeEnvironmentId = environment.id;
      }
      const existing = environment.variables.find((variable) => variable.name === variableName);
      if (existing) {
        existing.value = value;
        if (folderId) existing.secret = true;
      } else {
        const variable = createEnvironmentVariable(variableName, value);
        if (folderId) variable.secret = true;
        environment.variables.push(variable);
      }
      if (folderId && activeCollection) {
        const collection = draft.collections.find(
          (candidate) => candidate.id === activeCollection.id
        );
        const folder = collection ? findFolder(collection, folderId) : undefined;
        if (folder) folder.accessTokenVariable = variableName;
      }
    });
    setNotice(
      folderId
        ? `Saved "${variableName}" as the folder access token in the ${activeEnvironment ? "active" : "new"} environment.`
        : `Saved "${variableName}" to the ${activeEnvironment ? "active" : "new"} environment.`
    );
  };

  const saveResponseAsExample = (responseToSave: ResponseState) => {
    if (!activeRequest || responseToSave.error) {
      return;
    }
    const contentType = Object.entries(responseToSave.headers).find(
      ([name]) => name.toLowerCase() === "content-type"
    )?.[1];
    const includesSensitiveData = /(?:authorization|api[_-]?key|access[_-]?token|client[_-]?secret|password)/i.test(
      `${JSON.stringify(responseToSave.headers)}\n${responseToSave.rawBody}`
    );
    if (
      includesSensitiveData &&
      !window.confirm("This response may contain a secret. Save it as a local example anyway?")
    ) {
      return;
    }
    updateActiveRequest((request) => {
      request.responseExamples.push({
        id: createId("response"),
        name: `Response ${responseToSave.status}`,
        status: responseToSave.status,
        headers: Object.entries(responseToSave.headers).map(([key, value]) =>
          createKeyValue(key, value)
        ),
        body: responseToSave.rawBody || responseToSave.body,
        contentType
      });
    });
    setNotice(`Saved ${responseToSave.status} response as an example for ${activeRequest.name}.`);
  };

  return {
    copyActiveRequestAsCurl, sendActiveRequest, updateEnvironment,
    updateEnvironmentBaseUrl, createNewEnvironment, selectEnvironment, deleteEnvironment,
    updateSettings, assignResponseValue, saveResponseAsExample, toggleCollectionTokenCapture
  };
}
