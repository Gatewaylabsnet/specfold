import type { Workspace } from "../model/types";

export interface WorkspaceStorage {
  loadWorkspace(): Promise<Workspace>;
  saveWorkspace(workspace: Workspace): Promise<void>;
}

