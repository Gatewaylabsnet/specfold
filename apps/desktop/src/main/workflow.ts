import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildWorkflowTestPlan, createId, importApiDocument, profileAuthVariables, redactAgentValue,
  validateConnectionProfile, workspaceSecrets, type ConnectionProfile, type WorkflowRunReport,
  type WorkflowTestPlan, type Workspace
} from "@openapi-collection-studio/core";
import { validateAgentWorkspace } from "../../../../packages/agent/src/validation";
import type { WorkspaceLoadResult } from "../shared/contracts";
import { agentEvent, flushAgentEditor } from "./agentWorkspace";
import { sendHttpRequest } from "./http";
import { assertTrustedIpcSender } from "./security";
import { loadSettings, loadWorkspace, saveWorkspace, serializeStorageMutation } from "./storage";
import { bumpWorkspaceGeneration, checkWorkspaceGeneration } from "./workspaceGeneration";
import { executeWorkflowPlan } from "./workflowRunner";

interface StoredPlan {
  id: string; profileId: string; selectedRequestIds?: string[]; revision: string; createdAt: string; expiresAt: string;
}
interface ProfileInput {
  profile: ConnectionProfile; sourceText?: string; credentials?: Record<string, string>; expectedGeneration: number;
}
const plans = new Map<string, StoredPlan>();
const reports = new Map<string, WorkflowRunReport>();
let activeRun: AbortController | undefined;
let activeRunFromAgent = false;
let stateEpoch = 0;
const path = () => join(app.getPath("userData"), "workspace.json");
const rawRevision = async () => createHash("sha256").update(await readFile(path(), "utf8")).digest("hex");
/** Re-encryption and autosave timestamps do not change the approved saved inputs. */
const semanticRevision = (workspace: Workspace) => {
  const value = { ...workspace, updatedAt: undefined };
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
};
const id = (value: unknown): string => {
  if (typeof value !== "string" || !value || value.length > 200) throw new Error("INVALID_WORKFLOW_ID");
  return value;
};
const selection = (value: unknown): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 500 || new Set(value).size !== value.length) throw new Error("INVALID_WORKFLOW_SELECTION");
  return value.map(id);
};
async function snapshotUnlocked() {
  const expected = await rawRevision();
  const loaded = await loadWorkspace();
  if (loaded.recovered) throw new Error("INVALID_WORKSPACE");
  validateAgentWorkspace(loaded.workspace);
  if (await rawRevision() !== expected) throw new Error("REVISION_CONFLICT");
  return { ...loaded, revision: semanticRevision(loaded.workspace) };
}
const snapshot = () => serializeStorageMutation(snapshotUnlocked);
const profileFor = (workspace: Workspace, profileId: string): ConnectionProfile => {
  const found = workspace.connectionProfiles?.find((item) => item.id === profileId);
  if (!found) throw new Error("WORKFLOW_PROFILE_NOT_FOUND");
  return validateConnectionProfile(found);
};
function prunePlans(): void {
  for (const [key, plan] of plans) if (Date.parse(plan.expiresAt) <= Date.now()) plans.delete(key);
}
export function cancelWorkflowRun(fromAgentOnly = false): void { if (!fromAgentOnly || activeRunFromAgent) activeRun?.abort(); }
export function resetWorkflowState(): void { stateEpoch++; cancelWorkflowRun(); plans.clear(); reports.clear(); }

/** Reject credential-bearing source URLs rather than persisting a masked but runnable destination. */
function assertNoCredentialUrls(value: unknown, depth = 0): void {
  if (depth > 80) throw new Error("INVALID_WORKFLOW_SOURCE");
  if (typeof value === "string") {
    for (const match of value.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
      try {
        const url = new URL(match[0]);
        if (url.username || url.password || [...url.searchParams.keys()].some((key) =>
          /token|secret|password|passwd|api.?key|authorization|signature|credential/i.test(key))) throw new Error("CREDENTIAL_URL_NOT_ALLOWED");
      } catch (error) { if ((error as Error).message === "CREDENTIAL_URL_NOT_ALLOWED") throw error; }
    }
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) assertNoCredentialUrls(item, depth + 1);
  }
}

export async function saveWorkflowProfile(value: unknown): Promise<WorkspaceLoadResult & { profileId: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_WORKFLOW_PROFILE");
  const input = value as ProfileInput;
  // An import's collection id is assigned by main, not chosen by the renderer.
  const profile = validateConnectionProfile(input.sourceText !== undefined && input.profile && typeof input.profile === "object"
    ? { ...input.profile, collectionId: createId("col") } : input.profile);
  if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0) throw new Error("WORKSPACE_CHANGED");
  if (input.sourceText !== undefined && (typeof input.sourceText !== "string" || !input.sourceText.trim() || input.sourceText.length > 4 * 1024 * 1024)) {
    throw new Error("INVALID_WORKFLOW_SOURCE");
  }
  const allowed = new Set(profileAuthVariables(profile));
  const credentials = input.credentials ?? {};
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials) ||
    Object.entries(credentials).some(([name, content]) => !allowed.has(name) || typeof content !== "string" || content.length > 64 * 1024 || content.includes("{{"))) {
    throw new Error("INVALID_WORKFLOW_CREDENTIALS");
  }
  assertNoCredentialUrls(profile);
  await flushAgentEditor();
  return serializeStorageMutation(async () => {
    checkWorkspaceGeneration(input.expectedGeneration);
    const saved = await snapshotUnlocked();
    const workspace = structuredClone(saved.workspace);
    const environment = workspace.environments.find((item) => item.id === profile.environmentId);
    if (!environment) throw new Error("WORKFLOW_ENVIRONMENT_NOT_FOUND");
    if (allowed.size && !saved.secureStorageAvailable) throw new Error("SECURE_STORAGE_REQUIRED");
    if (input.sourceText !== undefined) {
      const imported = importApiDocument(input.sourceText, { grouping: "tags" }).collection;
      assertNoCredentialUrls(imported);
      const collection = redactAgentValue(imported, [...workspaceSecrets(workspace), ...Object.values(credentials).filter(Boolean)]);
      // Import always creates a new collection; existing content is never used as a replacement target.
      collection.id = createId("col");
      collection.baseUrl = profile.baseUrl;
      workspace.collections.push(collection);
      profile.collectionId = collection.id;
    } else if (!workspace.collections.some((item) => item.id === profile.collectionId)) throw new Error("COLLECTION_NOT_FOUND");
    for (const name of allowed) {
      const matches = environment.variables.filter((item) => item.name === name);
      if (matches.length > 1) throw new Error("DUPLICATE_AUTH_VARIABLE");
      let variable = matches[0];
      if (!variable) {
        variable = { id: createId("var"), name, value: "", enabled: true, secret: true };
        environment.variables.push(variable);
      }
      const supplied = Object.hasOwn(credentials, name) ? credentials[name] : undefined;
      if (supplied?.trim()) variable.value = supplied;
      variable.secret = true;
      variable.enabled = true;
    }
    workspace.connectionProfiles ??= [];
    const index = workspace.connectionProfiles.findIndex((item) => item.id === profile.id);
    if (index < 0) {
      if (workspace.connectionProfiles.length >= 64) throw new Error("WORKFLOW_PROFILE_LIMIT");
      workspace.connectionProfiles.push(profile);
    } else workspace.connectionProfiles[index] = profile;
    workspace.updatedAt = new Date().toISOString();
    validateAgentWorkspace(workspace);
    checkWorkspaceGeneration(input.expectedGeneration);
    if ((await snapshotUnlocked()).revision !== saved.revision) throw new Error("REVISION_CONFLICT");
    await saveWorkspace(workspace);
    const generation = bumpWorkspaceGeneration();
    plans.clear();
    // The only caller is the trusted setup UI, which replaces this returned snapshot.
    // A generic reload event could overwrite edits typed after the editor flush.
    return { ...await loadWorkspace(), generation, profileId: profile.id };
  });
}

export async function workflowProfiles() {
  await flushAgentEditor();
  const saved = await snapshot();
  const secrets = workspaceSecrets(saved.workspace);
  return (saved.workspace.connectionProfiles ?? []).map((value) => {
    const profile = validateConnectionProfile(value);
    return { id: profile.id, collectionId: profile.collectionId, environmentId: profile.environmentId,
      provider: profile.provider, name: redactAgentValue(profile.name, secrets), baseUrl: redactAgentValue(profile.baseUrl, secrets),
      auth: { kind: profile.auth.kind } };
  });
}

export async function previewWorkflowPlan(profileId: string, selectedRequestIds?: string[]): Promise<WorkflowTestPlan> {
  const key = id(profileId), selected = selection(selectedRequestIds);
  await flushAgentEditor();
  const saved = await snapshot();
  const profile = profileFor(saved.workspace, key);
  prunePlans();
  if (plans.size >= 32) throw new Error("WORKFLOW_PLAN_LIMIT");
  const plan = buildWorkflowTestPlan(saved.workspace, profile, { id: randomUUID(), revision: saved.revision, selectedRequestIds: selected });
  if (plan.rows.length > 500) throw new Error("WORKFLOW_ROW_LIMIT");
  plans.set(plan.id, { id: plan.id, profileId: profile.id, selectedRequestIds: selected, revision: saved.revision,
    createdAt: plan.createdAt, expiresAt: plan.expiresAt });
  // Core masks display/schema evidence while preserving execution IDs and status enums.
  return plan;
}

export async function runWorkflowPlan(planId: string, signal?: AbortSignal, fromAgent = false): Promise<WorkflowRunReport> {
  if (activeRun) throw new Error("WORKFLOW_BUSY");
  const stored = plans.get(id(planId));
  if (!stored) throw new Error("WORKFLOW_PLAN_NOT_FOUND");
  if (Date.parse(stored.expiresAt) <= Date.now()) { plans.delete(stored.id); throw new Error("PLAN_EXPIRED"); }
  const parent = BrowserWindow.getAllWindows()[0];
  if (!parent || parent.isDestroyed() || parent.webContents.isDestroyed()) throw new Error("DESKTOP_REQUIRED");
  const controller = new AbortController();
  activeRun = controller;
  activeRunFromAgent = fromAgent;
  const epoch = stateEpoch;
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const cancel = () => controller.abort();
  parent.once("closed", cancel);
  parent.webContents.once("destroyed", cancel);
  try {
    combined.throwIfAborted();
    await flushAgentEditor();
    const saved = await snapshot();
    if (saved.revision !== stored.revision) throw new Error("REVISION_CONFLICT");
    const profile = profileFor(saved.workspace, stored.profileId);
    const plan = buildWorkflowTestPlan(saved.workspace, profile, stored);
    if (plan.rows.length > 500) throw new Error("WORKFLOW_ROW_LIMIT");
    let expectedRevision = stored.revision;
    const checkUnlocked = async () => {
      combined.throwIfAborted();
      if (Date.parse(stored.expiresAt) <= Date.now()) throw new Error("PLAN_EXPIRED");
      if (fromAgent) {
        const settings = await loadSettings();
        if (!settings.agentEnabled || !settings.agentNetworkEnabled) throw new Error("NETWORK_DISABLED");
      }
      if ((await snapshotUnlocked()).revision !== expectedRevision) throw new Error("REVISION_CONFLICT");
      combined.throwIfAborted();
    };
    // Consume a plan once; repeating a run requires a fresh preview and consent.
    plans.delete(stored.id);
    const report = await executeWorkflowPlan(saved.workspace, profile, plan, {
      checkCurrent: () => serializeStorageMutation(checkUnlocked),
      confirm: async (summary) => {
        const selected = summary.rows.filter((row) => row.selected && row.status === "ready");
        const details = [summary.authentication ? `Authentication: ${summary.authentication}` : "",
          ...selected.map((row) => `${row.effect === "may-change-data" ? "MAY CHANGE DATA: " : ""}${row.method} ${row.route}`),
          "", "Only these selected requests will run, sequentially, once. Authentication may update this profile's encrypted token.",
          "Requests marked MAY CHANGE DATA can modify server data. Cancel stops further requests; it cannot undo work already performed by the server."];
        const choice = await dialog.showMessageBox(parent, { signal: combined, type: "warning", title: "Approve workflow run",
          buttons: ["Run selected requests", "Cancel"], defaultId: 1, cancelId: 1,
          message: `Run ${selected.length} selected requests with ${summary.profileName} in ${summary.environmentName}?`, detail: details.filter(Boolean).join("\n") });
        combined.throwIfAborted();
        return choice.response === 0;
      },
      send: async (payload) => {
        const pending = await serializeStorageMutation(async () => {
          await checkUnlocked();
          return { response: sendHttpRequest(payload, -1, { maxResponseBytes: 512 * 1024, timeoutMs: 30_000,
            allowInsecureTls: false, redirect: "error", signal: combined }) };
        });
        return pending.response;
      },
      captureToken: async (token) => serializeStorageMutation(async () => {
        await checkUnlocked();
        const latest = await loadWorkspace();
        const auth = profile.auth;
        const variable = auth.kind === "apinizer" ? latest.workspace.environments.find((item) => item.id === profile.environmentId)
          ?.variables.find((item) => item.name === auth.tokenVariable) : undefined;
        if (!variable || !variable.enabled || !latest.secureStorageAvailable) throw new Error("TOKEN_NOT_SAVED");
        const previous = { ...variable };
        combined.throwIfAborted();
        variable.value = token; variable.secret = true;
        await saveWorkspace(latest.workspace);
        expectedRevision = (await snapshotUnlocked()).revision;
        const generation = bumpWorkspaceGeneration();
        agentEvent({ kind: "token-captured", workspaceId: latest.workspace.id, environmentId: profile.environmentId, previous, value: token, generation });
      })
    }, combined);
    if (epoch === stateEpoch) {
      reports.set(report.id, report);
      while (reports.size > 10) reports.delete(reports.keys().next().value!);
    }
    return report;
  } finally {
    parent.removeListener("closed", cancel);
    parent.webContents.removeListener("destroyed", cancel);
    if (activeRun === controller) { activeRun = undefined; activeRunFromAgent = false; }
  }
}

export function workflowReport(planIdOrRunId: string): WorkflowRunReport {
  const key = id(planIdOrRunId);
  const report = reports.get(key) ?? [...reports.values()].reverse().find((item) => item.planId === key);
  if (!report) throw new Error("WORKFLOW_REPORT_NOT_FOUND");
  return structuredClone(report);
}

export function registerWorkflowIpc(): void {
  const handle = (channel: string, operation: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedIpcSender(event);
      try { return await operation(event, ...args); }
      catch (error) {
        const message = error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message) ? error.message : "WORKFLOW_OPERATION_FAILED";
        throw new Error(message, { cause: error });
      }
    });
  handle("workflow:saveProfile", (_event, value) => saveWorkflowProfile(value));
  handle("workflow:preview", (_event, profileId, selected) => previewWorkflowPlan(id(profileId), selection(selected)));
  handle("workflow:run", async (event, planId) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    event.sender.once("destroyed", cancel);
    try { return await runWorkflowPlan(id(planId), controller.signal); }
    finally { event.sender.removeListener("destroyed", cancel); }
  });
  handle("workflow:cancel", () => cancelWorkflowRun());
  handle("workflow:report", (_event, reportId) => workflowReport(id(reportId)));
}
