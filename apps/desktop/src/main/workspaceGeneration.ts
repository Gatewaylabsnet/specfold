let generation = 0;
export const workspaceGeneration = () => generation;
export const bumpWorkspaceGeneration = () => ++generation;
export function checkWorkspaceGeneration(expected?: number): void {
  if (expected !== undefined && expected !== generation) throw new Error("WORKSPACE_CHANGED");
}
