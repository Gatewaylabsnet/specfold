import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, realpath, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Workspace } from "@openapi-collection-studio/core";
import { atomicWriteFile } from "./atomicFile";
import { readBoundedFile } from "./fileIO";
export { readBoundedFile } from "./fileIO";
import { acquireWorkspaceLease } from "./workspaceLock";
import { validateAgentWorkspace } from "./validation";
import { AgentError } from "./errors";

export const MAX_WORKSPACE_BYTES = 100 * 1024 * 1024;
export const revisionOf = (text: string): string => createHash("sha256").update(text).digest("hex");

export class AgentRepository {
  readonly root: string;
  readonly path: string;
  constructor(userData: string, readonly writer = atomicWriteFile) {
    this.root = resolve(userData);
    this.path = join(this.root, "workspace.json");
  }
  async checkRoot(): Promise<void> {
    if ((await lstat(this.root)).isSymbolicLink() || resolve(await realpath(this.root)) !== this.root) {
      throw new AgentError("UNSAFE_DATA_PATH");
    }
  }
  async snapshot(): Promise<{ workspace: Workspace; revision: string; raw: string }> {
    try {
      await this.checkRoot();
      const raw = await readBoundedFile(this.path, MAX_WORKSPACE_BYTES);
      let value: unknown;
      try { value = JSON.parse(raw); } catch { throw new AgentError("INVALID_WORKSPACE"); }
      return { workspace: validateAgentWorkspace(value), revision: revisionOf(raw), raw };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new AgentError("WORKSPACE_NOT_FOUND");
      if (error instanceof AgentError && error.code === "INVALID_ENCODING") throw new AgentError("INVALID_WORKSPACE");
      throw error;
    }
  }
  async locked<T>(operation: () => Promise<T>): Promise<T> {
    await this.checkRoot();
    const release = acquireWorkspaceLease(this.root, "agent");
    try { return await operation(); } finally { release(); }
  }
  async stateDirectory(): Promise<string> {
    await this.checkRoot();
    const path = join(this.root, ".agent");
    await mkdir(path, { recursive: true, mode: 0o700 });
    if ((await lstat(path)).isSymbolicLink()) throw new AgentError("UNSAFE_DATA_PATH");
    return path;
  }
  async commit(workspace: Workspace, previous: string, receiptPath: string, receipt: object): Promise<string> {
    const backupDir = join(this.root, "backups");
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    if ((await lstat(backupDir)).isSymbolicLink()) throw new AgentError("UNSAFE_DATA_PATH");
    const backup = join(backupDir, `agent-safety-${randomUUID()}.workspace.json`);
    await copyFile(this.path, backup);
    await chmod(backup, 0o600);
    try {
      await this.writer(this.path, JSON.stringify(workspace, null, 2));
      await this.writer(receiptPath, JSON.stringify(receipt));
    } catch (error) {
      // Receipt + workspace are a transaction; preserve the safety snapshot on failure.
      await atomicWriteFile(this.path, previous);
      await unlink(receiptPath).catch(() => undefined);
      throw error;
    }
    return backup.split(/[\\/]/).at(-1)!;
  }
}
