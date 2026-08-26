import { app, BrowserWindow } from "electron";
import { loadSettings } from "./storage";
import { closeHttpAgents } from "./http";
import { registerIpcHandlers } from "./ipc";
import { installApplicationMenu } from "./menu";
import { installAppProtocol, registerAppProtocolScheme } from "./protocol";
import { applyContentSecurityPolicy, applyNativeTheme, createWindow } from "./window";

const PRODUCT_NAME = "Specfold";
const APP_ID = "net.gatewaylabs.specfold";

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
    applyNativeTheme((await loadSettings()).theme);
    installAppProtocol();
    applyContentSecurityPolicy();
    registerIpcHandlers();
    installApplicationMenu();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => { void closeHttpAgents(); });
}
