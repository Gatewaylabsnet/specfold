import { contextBridge, ipcRenderer } from "electron";
import type { ApiRequest, Collection, Environment, Folder, Workspace } from "@openapi-collection-studio/core";
import { APP_MENU_ACTIONS, type AppMenuAction, type StudioApi } from "../shared/contracts";

const studioApi: StudioApi = {
  onAppMenuAction: (listener: (action: AppMenuAction) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (APP_MENU_ACTIONS.includes(action as AppMenuAction)) {
        listener(action as AppMenuAction);
      }
    };
    ipcRenderer.on("app:menuAction", handler);
    return () => ipcRenderer.removeListener("app:menuAction", handler);
  },
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  checkForUpdates: () => ipcRenderer.invoke("app:checkForUpdates"),
  openExternal: (url: string) => ipcRenderer.invoke("app:openExternal", url),
  loadWorkspace: () => ipcRenderer.invoke("workspace:load"),
  saveWorkspace: (workspace: Workspace, generation?: number) =>
    ipcRenderer.invoke("workspace:save", workspace, generation) as Promise<void>,
  onAgentEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (value === "changed" || value === "review") listener(value);
    };
    ipcRenderer.on("agent:event", handler);
    return () => ipcRenderer.removeListener("agent:event", handler);
  },
  onAgentFlush: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string) => {
      void listener().then(() => ipcRenderer.send("agent:flushed", id, true), () => ipcRenderer.send("agent:flushed", id, false));
    };
    ipcRenderer.on("agent:flush", handler);
    return () => ipcRenderer.removeListener("agent:flush", handler);
  },
  getAgentConnection: () => ipcRenderer.invoke("agent:connection"),
  testAgentConnection: () => ipcRenderer.invoke("agent:test"),
  reviewAgentPlan: (id) => ipcRenderer.invoke("agent:review", id),
  refreshAgentPlan: (id) => ipcRenderer.invoke("agent:refresh", id),
  applyAgentPlan: (id, revision) => ipcRenderer.invoke("agent:apply", id, revision),
  rejectAgentPlan: (id) => ipcRenderer.invoke("agent:reject", id),
  startAgentSession: (selection) => ipcRenderer.invoke("agent:session", selection),
  stopAgentSession: () => ipcRenderer.invoke("agent:stopSession"),
  exportAgentDocumentation: (id) => ipcRenderer.invoke("agent:exportDocumentation", id),
  previewAgentDocumentation: (id) => ipcRenderer.invoke("agent:previewDocumentation", id),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings: unknown) => ipcRenderer.invoke("settings:save", settings),
  testConnection: (url: string) => ipcRenderer.invoke("environment:testConnection", url),
  sendRequest: (
    request: ApiRequest,
    environment?: Environment,
    collection?: Pick<Collection, "baseUrl">,
    folderPath?: Array<Pick<Folder, "baseUrl">>
  ) => ipcRenderer.invoke("http:send", { request, environment, collection, folderPath }),
  saveExportFile: (defaultPath: string, content: string) =>
    ipcRenderer.invoke("file:saveExport", { defaultPath, content }),
  openImportFile: () => ipcRenderer.invoke("file:openImport"),
  openUploadFile: () => ipcRenderer.invoke("file:openUpload"),
  releaseUploadFile: (uploadId: string) => ipcRenderer.invoke("file:releaseUpload", uploadId),
  openPostmanFolder: () => ipcRenderer.invoke("file:openPostmanFolder"),
  exportBackup: (workspace: Workspace) => ipcRenderer.invoke("file:exportBackup", workspace),
  restoreBackup: () => ipcRenderer.invoke("file:restoreBackup"),
  deleteAllData: () => ipcRenderer.invoke("data:deleteAll"),
  getLocalDataInfo: () => ipcRenderer.invoke("data:info"),
  openLocalDataFolder: () => ipcRenderer.invoke("data:openFolder"),
  fetchImportUrl: (url: string) => ipcRenderer.invoke("import:fetchUrl", url)
};

contextBridge.exposeInMainWorld("studio", studioApi);
