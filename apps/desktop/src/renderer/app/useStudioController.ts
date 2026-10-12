import { useDataController } from "./useDataController";
import { useImportController } from "./useImportController";
import { useRequestController } from "./useRequestController";
import { useStudioState } from "./useStudioState";
import { useWorkspaceController } from "./useWorkspaceController";
import { useAgentController } from "./useAgentController";

export function useStudioController() {
  const state = useStudioState();
  const workspace = useWorkspaceController(state);
  const importer = useImportController(state, workspace);
  const request = useRequestController(state, workspace);
  const data = useDataController(state, workspace);
  const agent = useAgentController(state);
  return { ...state, ...workspace, ...importer, ...request, ...data, ...agent };
}
