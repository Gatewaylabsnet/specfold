import { BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { AgentRepository } from "../../../../packages/agent/src/repository";
import { assertTrustedIpcSender } from "./security";
import { serializeStorageMutation } from "./storage";
import { bumpWorkspaceGeneration } from "./workspaceGeneration";
import type { Workspace } from "@openapi-collection-studio/core";

export class DesktopAgentRepository extends AgentRepository {
  override locked<T>(operation: () => Promise<T>): Promise<T> { return serializeStorageMutation(operation); }
  override async commit(workspace: Workspace, previous: string, receiptPath: string, receipt: object): Promise<string> {
    const backup = await super.commit(workspace, previous, receiptPath, receipt);
    bumpWorkspaceGeneration();
    return backup;
  }
}

export function agentEvent(event: "changed" | "review"): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("agent:event", event);
}

/** Flush the editor outside the storage queue, then use the owner queue for the transaction. */
export async function flushAgentEditor(): Promise<void> {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window || window.webContents.isDestroyed()) throw new Error("DESKTOP_REQUIRED");
  const id = randomUUID();
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); ipcMain.removeListener("agent:flushed", handler); };
    const handler = (event: Electron.IpcMainEvent, value: unknown, ok: unknown) => {
      try { assertTrustedIpcSender(event); } catch { return; }
      if (value !== id || event.sender.id !== window.webContents.id) return;
      cleanup();
      if (ok === true) resolve(); else reject(new Error("WORKSPACE_CHANGED"));
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error("WORKSPACE_CHANGED")); }, 5000);
    ipcMain.on("agent:flushed", handler);
    window.webContents.send("agent:flush", id);
  });
}
