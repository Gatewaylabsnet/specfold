import { app, BrowserWindow } from "electron";
import { loadSettings } from "./storage";
import { closeHttpAgents } from "./http";
import { registerIpcHandlers } from "./ipc";
import { applyContentSecurityPolicy, applyNativeTheme, createWindow } from "./window";

const PRODUCT_NAME = "Specfold";
const APP_ID = "net.gatewaylabs.specfold";

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
    applyContentSecurityPolicy();
    registerIpcHandlers();
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
