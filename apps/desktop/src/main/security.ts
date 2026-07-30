import { BrowserWindow, type IpcMainInvokeEvent, type WebContents } from "electron";
import { isTrustedRendererUrl } from "./securityUrls";

export function isTrustedWebContents(contents: WebContents): boolean {
  return Boolean(
    BrowserWindow.fromWebContents(contents) &&
    isTrustedRendererUrl(contents.getURL(), process.env.ELECTRON_RENDERER_URL)
  );
}

export function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  if (
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedWebContents(event.sender) ||
    !isTrustedRendererUrl(event.senderFrame.url, process.env.ELECTRON_RENDERER_URL)
  ) {
    throw new Error("Rejected IPC request from an untrusted renderer.");
  }
}
