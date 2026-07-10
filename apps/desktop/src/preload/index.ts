import { contextBridge, ipcRenderer } from "electron";
import type { ApiRequest, Environment, Workspace } from "@openapi-collection-studio/core";

contextBridge.exposeInMainWorld("studio", {
  loadWorkspace: () => ipcRenderer.invoke("workspace:load") as Promise<Workspace>,
  saveWorkspace: (workspace: Workspace) =>
    ipcRenderer.invoke("workspace:save", workspace) as Promise<void>,
  sendRequest: (request: ApiRequest, environment?: Environment) =>
    ipcRenderer.invoke("http:send", { request, environment }),
  saveExportFile: (defaultPath: string, content: string) =>
    ipcRenderer.invoke("file:saveExport", { defaultPath, content })
});

