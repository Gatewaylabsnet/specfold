import { useDataController } from "./useDataController";
import { useImportController } from "./useImportController";
import { useRequestController } from "./useRequestController";
import { useStudioState } from "./useStudioState";
import { useWorkspaceController } from "./useWorkspaceController";

export function useStudioController() {
  const state = useStudioState();
  const workspace = useWorkspaceController(state);
  const importer = useImportController(state, workspace);
  const request = useRequestController(state, workspace);
  const data = useDataController(state, workspace);
  return { ...state, ...workspace, ...importer, ...request, ...data };
}
