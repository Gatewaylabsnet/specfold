import { contextBridge, ipcRenderer } from "electron";
import type { ApiRequest, Collection, Environment, Workspace } from "@openapi-collection-studio/core";

contextBridge.exposeInMainWorld("studio", {
  loadWorkspace: () => ipcRenderer.invoke("workspace:load"),
  saveWorkspace: (workspace: Workspace) =>
    ipcRenderer.invoke("workspace:save", workspace) as Promise<void>,
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings: unknown) => ipcRenderer.invoke("settings:save", settings),
  sendRequest: (request: ApiRequest, environment?: Environment, collection?: Pick<Collection, "baseUrl">) =>
    ipcRenderer.invoke("http:send", { request, environment, collection }),
  saveExportFile: (defaultPath: string, content: string) =>
    ipcRenderer.invoke("file:saveExport", { defaultPath, content }),
  openImportFile: () => ipcRenderer.invoke("file:openImport"),
  fetchImportUrl: (url: string) => ipcRenderer.invoke("import:fetchUrl", url)
});
