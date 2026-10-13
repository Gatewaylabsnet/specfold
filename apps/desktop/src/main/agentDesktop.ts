import { app, dialog, ipcMain } from "electron";
import { AgentService } from "../../../../packages/agent/src/service";
import { safeAgentError } from "../../../../packages/agent/src/errors";
import type { DesktopAgentCall } from "../../../../packages/agent/src/desktopContracts";
import type { AgentConnectionInfo, AgentPlanReview, AgentSessionSelection } from "../shared/contracts";
import { agentEvent, DesktopAgentRepository, flushAgentEditor } from "./agentWorkspace";
import { agentConfiguration, testBundledAgent } from "./agentConnection";
import { agentDocumentation, networkSession, resetAgentExecution, sendAgentRequest, startAgentSession } from "./agentExecution";
import { assertTrustedIpcSender } from "./security";
import { atomicWrite, loadSettings, loadWorkspace, serializeStorageMutation } from "./storage";
import { workspaceGeneration } from "./workspaceGeneration";

let service: AgentService | undefined;
let available = false, lastConnectedAt: string | undefined;
const reviews = new Map<string, AgentPlanReview>();
const agentService = () => service ??= new AgentService(new DesktopAgentRepository(app.getPath("userData")), true);
const planId = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("INVALID_PLAN");
  return value;
};
export function setAgentHostAvailable(value: boolean): void { available = value; }
export function resetAgentState(): void { reviews.clear(); resetAgentExecution(); }
export function revokeAgentSession(): void { networkSession.stop(); }

async function connectionInfo(): Promise<AgentConnectionInfo> {
  const settings = await loadSettings();
  return { available: available && settings.agentEnabled === true, lastConnectedAt, configuration: agentConfiguration(),
    pending: [...reviews.values()].filter((item) => item.status === "pending" || item.status === "stale"), session: networkSession.info() };
}

export async function dispatchAgentCall(call: DesktopAgentCall, signal?: AbortSignal): Promise<unknown> {
  const checkCanceled = () => { if (signal?.aborted) throw new Error("OPERATION_CANCELLED"); };
  checkCanceled();
  if (!(await loadSettings()).agentEnabled) throw new Error("AGENT_DISABLED");
  checkCanceled();
  lastConnectedAt = new Date().toISOString();
  if (call.operation === "ping") return { ready: true };
  if (call.operation === "send") return sendAgentRequest(call, signal);
  if (call.operation === "documentation") return agentDocumentation(call.collectionId);
  if (call.operation === "status") {
    const review = reviews.get(call.planId);
    if (!review) throw new Error("REVIEW_NOT_FOUND");
    return { planId: review.planId, status: review.status, collectionId: review.collectionId };
  }
  await flushAgentEditor();
  checkCanceled();
  const service = agentService();
  switch (call.operation) {
    case "list": return service.listCollections();
    case "inspect": return service.inspectRequest(call.collectionId, call.requestId);
    case "validate": return service.validateCollection(call.collectionId);
    case "preview": return service.preview(call.action);
    case "diff": return service.showDiff(call.planId);
    case "review": {
      const existing = reviews.get(call.planId);
      if (existing?.expectedRevision === call.expectedRevision && existing.status !== "stale") {
        return { planId: call.planId, status: existing.status, collectionId: existing.collectionId };
      }
      const diff = await service.showDiff(call.planId) as Omit<AgentPlanReview, "status">;
      if (diff.expectedRevision !== call.expectedRevision) throw new Error("REVISION_CONFLICT");
      if (reviews.size >= 128) throw new Error("PLAN_LIMIT");
      reviews.set(call.planId, { ...diff, status: "pending" });
      agentEvent("review");
      return { planId: call.planId, status: "pending", nextAction: "Review the proposed changes in Specfold. Check get_plan_status after the user applies or rejects them." };
    }
  }
}

export function registerAgentIpc(): void {
  const handle = (channel: string, operation: (...args: unknown[]) => unknown) => ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedIpcSender(event);
    try { return await operation(...args); }
    catch (error) { throw new Error(safeAgentError(error).message, { cause: error }); }
  });
  handle("agent:connection", connectionInfo);
  handle("agent:test", testBundledAgent);
  handle("agent:review", async (id: unknown) => {
    const key = planId(id), existing = reviews.get(key);
    if (!existing) throw new Error("REVIEW_NOT_FOUND");
    await flushAgentEditor();
    try { return { ...await agentService().showDiff(key) as AgentPlanReview, status: existing.status }; }
    catch (error) {
      if ((error as Error).message !== "REVISION_CONFLICT") throw error;
      existing.status = "stale"; return existing;
    }
  });
  handle("agent:refresh", async (id: unknown) => {
    const key = planId(id), old = reviews.get(key);
    if (!old || old.status === "applied") throw new Error("REVIEW_NOT_FOUND");
    await flushAgentEditor();
    const action = (await agentService().loadPlan(key)).action;
    const preview = await agentService().preview(action) as { planId: string };
    const diff = await agentService().showDiff(preview.planId) as Omit<AgentPlanReview, "status">;
    old.status = "rejected";
    const review: AgentPlanReview = { ...diff, status: "pending" };
    reviews.set(preview.planId, review); agentEvent("review"); return review;
  });
  handle("agent:apply", async (id: unknown, expected: unknown) => {
    const key = planId(id), revision = planId(expected), review = reviews.get(key);
    if (!review || review.expectedRevision !== revision || review.status === "rejected") throw new Error("APPROVAL_REQUIRED");
    if (!(await loadSettings()).agentEnabled) throw new Error("AGENT_DISABLED");
    await flushAgentEditor();
    let result;
    try { result = await agentService().approveAndApply(key, revision); }
    catch (error) { if ((error as Error).message === "REVISION_CONFLICT") review.status = "stale"; throw error; }
    review.status = "applied"; review.collectionId = result.collectionId;
    networkSession.stop();
    for (const item of reviews.values()) if (item.planId !== key && item.status === "pending") item.status = "stale";
    agentEvent("changed");
    return serializeStorageMutation(async () => ({ ...await loadWorkspace(), generation: workspaceGeneration(), collectionId: result.collectionId }));
  });
  handle("agent:reject", (id: unknown) => {
    const review = reviews.get(planId(id));
    if (!review || review.status === "applied") throw new Error("REVIEW_NOT_FOUND");
    review.status = "rejected"; agentEvent("review");
  });
  handle("agent:session", async (value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("INVALID_ARGUMENTS");
    const selection = value as AgentSessionSelection;
    if (typeof selection.collectionId !== "string" || selection.collectionId.length > 200 || !Array.isArray(selection.requestIds) ||
      selection.requestIds.some((id) => typeof id !== "string" || id.length > 200)) throw new Error("INVALID_ARGUMENTS");
    await startAgentSession(selection); return connectionInfo();
  });
  handle("agent:stopSession", () => networkSession.stop());
  handle("agent:previewDocumentation", async (id: unknown) => {
    if (typeof id !== "string" || !id || id.length > 200) throw new Error("INVALID_ARGUMENTS");
    return agentDocumentation(id, true);
  });
  handle("agent:exportDocumentation", async (id: unknown) => {
    if (typeof id !== "string" || !id || id.length > 200) throw new Error("INVALID_ARGUMENTS");
    const content = await agentDocumentation(id, true) as string;
    const result = await dialog.showSaveDialog({ title: "Save documentation draft", defaultPath: "specfold-api-documentation.md", filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    await atomicWrite(result.filePath, content); return { canceled: false, filePath: result.filePath };
  });
}
