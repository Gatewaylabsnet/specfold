import { app, BrowserWindow, nativeImage, nativeTheme, session } from "electron";
import { join } from "node:path";
import type { ThemePreference } from "../shared/contracts";
import { isTrustedWebContents } from "./security";

function windowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? "#111827" : "#f6f7f9";
}

export function applyNativeTheme(preference: ThemePreference): void {
  nativeTheme.themeSource = preference;
  for (const window of BrowserWindow.getAllWindows()) {
    window.setBackgroundColor(windowBackgroundColor());
  }
}

export function resolveWindowIcon(): Electron.NativeImage | undefined {
  // The running window's title-bar and taskbar icon come from here (the exe
  // file icon is separate and needs rcedit/winCodeSign, which isn't available
  // on this build path). Dev: apps/desktop/build; packaged: bundled in asar.
  const iconPath = process.env.ELECTRON_RENDERER_URL
    ? join(__dirname, "../../build/icon.png")
    : join(app.getAppPath(), "build/icon.png");
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? undefined : image;
}

export function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "Specfold",
    icon: resolveWindowIcon(),
    backgroundColor: windowBackgroundColor(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadURL("specfold://app/index.html");
  }
}

export function applyContentSecurityPolicy(): void {
  session.defaultSession.setPermissionCheckHandler((webContents, permission) =>
    permission === "clipboard-sanitized-write" &&
    Boolean(webContents && isTrustedWebContents(webContents))
  );
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(
      permission === "clipboard-sanitized-write" &&
      isTrustedWebContents(webContents)
    );
  });

  // Only enforce CSP for packaged specfold:// loads. The dev server needs the
  // Vite websocket/eval for HMR, so we leave dev untouched.
  if (process.env.ELECTRON_RENDERER_URL) {
    return;
  }
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'"
        ]
      }
    });
  });
}

// Display name shown in menus, dialogs, and the Windows taskbar. Change this
// one constant if the product is ever renamed. Must be set before the first
// getPath("userData") call so dev and packaged builds share a storage folder.
