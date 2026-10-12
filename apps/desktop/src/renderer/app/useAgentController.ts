import { useEffect, useState } from "react";
import type { AgentConnectionInfo, AgentPlanReview } from "../../shared/contracts";
import type { StudioState } from "./useStudioState";
import { firstRequestId } from "./helpers";

export function useAgentController(state: StudioState) {
  const [agentConnection, setAgentConnection] = useState<AgentConnectionInfo>();
  const [agentReview, setAgentReview] = useState<AgentPlanReview>();
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState("");
  const refresh = () => { void window.studio.getAgentConnection?.().then(setAgentConnection).catch(() => undefined); };
  useEffect(() => {
    if (!state.loaded) return;
    refresh();
    return window.studio.onAgentEvent?.(refresh);
  }, [state.loaded, state.settings]);
  const run = async (operation: () => Promise<void>) => {
    setAgentBusy(true); setAgentError("");
    try { await operation(); }
    catch (error) { setAgentError(error instanceof Error ? error.message : "Could not complete the operation."); }
    finally { setAgentBusy(false); refresh(); }
  };
  const openAgentReview = (id: string) => run(async () => { setAgentReview(await window.studio.reviewAgentPlan(id)); });
  const applyAgentReview = () => run(async () => {
    if (!agentReview) return;
    const result = await window.studio.applyAgentPlan(agentReview.planId, agentReview.expectedRevision);
    state.replaceSavedWorkspace(result);
    state.setActiveCollectionId(result.collectionId);
    state.setSelectedFolderId(undefined);
    const collection = result.workspace.collections.find((item) => item.id === result.collectionId);
    state.setSelectedRequestId(collection ? firstRequestId(collection) : undefined);
    state.setResponse(undefined); state.setScreen("editor");
    state.setNotice("Agent changes applied. A local safety copy was created.");
    setAgentReview(undefined);
  });
  const rejectAgentReview = () => run(async () => {
    if (agentReview) await window.studio.rejectAgentPlan(agentReview.planId);
    setAgentReview(undefined);
  });
  const refreshAgentReview = () => run(async () => {
    if (agentReview) setAgentReview(await window.studio.refreshAgentPlan(agentReview.planId));
  });
  return { agentConnection, agentReview, agentBusy, agentError, openAgentReview, applyAgentReview,
    rejectAgentReview, refreshAgentReview, closeAgentReview: () => setAgentReview(undefined) };
}
