import { app, BrowserWindow, dialog } from "electron";
import { acquireWorkspaceLease } from "../../../../packages/agent/src/workspaceLock";
import { installAgentNetworkHost } from "./agentNetwork";
import { loadSettings } from "./storage";
import { closeHttpAgents } from "./http";
import { registerIpcHandlers } from "./ipc";
import { installApplicationMenu } from "./menu";
import { installAppProtocol, registerAppProtocolScheme } from "./protocol";
import { applyContentSecurityPolicy, applyNativeTheme, createWindow } from "./window";

const PRODUCT_NAME = "Specfold";
const APP_ID = "net.gatewaylabs.specfold";
let releaseWorkspaceLease: (() => void) | undefined;
let closeAgentNetworkHost: (() => Promise<void>) | undefined;

registerAppProtocolScheme();
// The packaged E2E suite supplies an isolated profile. Keep this opt-in so
// local and released applications continue to use Electron's normal location.
if (process.env.SPECFOLD_E2E_USER_DATA_PATH) {
  app.setPath("userData", process.env.SPECFOLD_E2E_USER_DATA_PATH);
}
app.setName(PRODUCT_NAME);
if (process.platform === "win32") app.setAppUserModelId(APP_ID);

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      releaseWorkspaceLease = acquireWorkspaceLease(app.getPath("userData"), "desktop");
    } catch (error) {
      if (error instanceof Error && error.message === "WORKSPACE_BUSY") {
        dialog.showErrorBox("Specfold workspace is busy", "Close the other Specfold window or wait for the agent operation to finish. Specfold could not safely recover the lock. If this persists, see the recovery guidance in docs/LOCAL_AGENT.md.");
      } else {
        dialog.showErrorBox("Specfold could not open its workspace", "Check that the local Specfold profile is accessible and writable, then try again. Specfold did not open the workspace.");
      }
      app.quit();
      return;
    }
    applyNativeTheme((await loadSettings()).theme);
    installAppProtocol();
    applyContentSecurityPolicy();
    registerIpcHandlers();
    // Failure disables optional AI connections; the existing UI stays available.
    try { closeAgentNetworkHost = await installAgentNetworkHost(); } catch { /* Fail closed. */ }
    installApplicationMenu();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => { void closeHttpAgents(); void closeAgentNetworkHost?.(); });
  app.on("will-quit", () => { releaseWorkspaceLease?.(); });
}
