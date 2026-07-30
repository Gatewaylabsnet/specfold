import { BrowserWindow, Menu } from "electron";
import type { AppMenuAction } from "../shared/contracts";
import { openTrustedExternal } from "./external";
import { buildApplicationMenuTemplate } from "./menuTemplate";

function sendMenuAction(action: AppMenuAction): void {
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  target?.webContents.send("app:menuAction", action);
}

export function installApplicationMenu(): void {
  const template = buildApplicationMenuTemplate(process.platform === "darwin", {
    send: sendMenuAction,
    openDocumentation: () => {
      void openTrustedExternal("https://gatewaylabs.net/docs/specfold");
    },
    openReleaseNotes: () => {
      void openTrustedExternal("https://github.com/Gatewaylabsnet/specfold/releases/latest");
    }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
