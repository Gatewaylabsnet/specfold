import { app, BrowserWindow, dialog } from "electron";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { redactAgentValue, workspaceSecrets } from "@openapi-collection-studio/core";
import { executeApprovedNetwork } from "../../../../packages/agent/src/networkPolicy";
import { NetworkSession } from "../../../../packages/agent/src/networkSession";
import { documentationContext, documentationMarkdown, requestDefinitionKey, type ResponseEvidence } from "../../../../packages/agent/src/documentation";
import type { AgentSessionSelection } from "../shared/contracts";
import { validateAgentWorkspace } from "../../../../packages/agent/src/validation";
import { loadSettings, loadWorkspace, saveWorkspace, serializeStorageMutation } from "./storage";
import { sendHttpRequest } from "./http";
import { bumpWorkspaceGeneration } from "./workspaceGeneration";
import { agentEvent, flushAgentEditor } from "./agentWorkspace";
import { AgentError } from "../../../../packages/agent/src/errors";

export const networkSession = new NetworkSession();
const observations = new Map<string, ResponseEvidence[]>();
export function resetAgentExecution(): void { networkSession.stop(); observations.clear(); }

export const agentSnapshot = () => serializeStorageMutation(async () => {
  const raw = await readFile(join(app.getPath("userData"), "workspace.json"), "utf8");
  try { validateAgentWorkspace(JSON.parse(raw)); } catch { throw new Error("INVALID_WORKSPACE"); }
  const result = await loadWorkspace();
  if (result.recovered) throw new Error("INVALID_WORKSPACE");
  return { workspace: result.workspace, revision: createHash("sha256").update(raw).digest("hex") };
});

export async function startAgentSession(selection: AgentSessionSelection): Promise<void> {
  await flushAgentEditor();
  const settings = await loadSettings();
  if (!settings.agentEnabled || !settings.agentNetworkEnabled || settings.agentNetworkMode !== "session") throw new Error("NETWORK_DISABLED");
  const snapshot = await agentSnapshot();
  const candidate = new NetworkSession();
  const { routes } = candidate.start(snapshot.workspace, selection);
  const environment = snapshot.workspace.environments.find((item) => item.id === snapshot.workspace.activeEnvironmentId)!;
  const choice = await dialog.showMessageBox({ type: "warning", title: "Approve agent session", buttons: ["Allow selected requests", "Cancel"], defaultId: 1, cancelId: 1,
    message: `Allow ${routes.length} selected requests in ${environment.name}?`,
    detail: redactAgentValue(`${routes.join("\n")}\n\nPermission expires after 15 minutes or 20 sends. Requests including POST may modify server data. Apinizer JWT responses can update the existing encrypted token variable. Returned examples are masked. You can stop this session in Settings.`, workspaceSecrets(snapshot.workspace)) });
  if (choice.response !== 0) throw new Error("NETWORK_APPROVAL_DENIED");
  const latest = await agentSnapshot();
  if (latest.revision !== snapshot.revision) throw new Error("REVISION_CONFLICT");
  const current = await loadSettings();
  if (!current.agentEnabled || !current.agentNetworkEnabled || current.agentNetworkMode !== "session") throw new Error("NETWORK_DISABLED");
  networkSession.start(latest.workspace, selection);
}

export async function sendAgentRequest(call: { collectionId: string; requestId: string }, signal?: AbortSignal): Promise<unknown> {
  const checkCanceled = () => { if (signal?.aborted) throw new AgentError("OPERATION_CANCELLED"); };
  checkCanceled();
  await flushAgentEditor();
  checkCanceled();
  const settings = await loadSettings();
  let captured: string[] = [], method = "", route = "", environmentName = "";
  let permit: number | undefined;
  let definitionFingerprint: string | undefined;
  const result = await executeApprovedNetwork(call, {
    enabled: async () => { const current = await loadSettings(); checkCanceled(); return current.agentEnabled === true && current.agentNetworkEnabled === true; },
    snapshot: agentSnapshot,
    additionalSecrets: () => captured,
    confirm: async (summary) => {
      checkCanceled();
      method = summary.method; route = summary.route;
      if (settings.agentNetworkMode === "session") {
        permit = networkSession.authorize((await agentSnapshot()).workspace, call.collectionId, call.requestId);
        return true;
      }
      const parent = BrowserWindow.getAllWindows()[0];
      if (!parent) throw new AgentError("DESKTOP_REQUIRED");
      const choice = await dialog.showMessageBox(parent, { signal, type: "warning", title: "Agent requests network access", defaultId: 1, cancelId: 1,
        buttons: ["Send this request", "Cancel"], message: `${summary.method} ${summary.route}`,
        detail: "Send this saved request with your configured credentials? It may modify server data. Secrets stay in Specfold and returned examples are masked." });
      checkCanceled();
      return choice.response === 0;
    },
    execute: async ([request, environment, collection, folderPath], expectedRevision) => {
      environmentName = environment?.name ?? "Not configured";
      const beforeExecution = await agentSnapshot();
      checkCanceled();
      if (beforeExecution.revision !== expectedRevision) throw new Error("REVISION_CONFLICT");
      definitionFingerprint = requestDefinitionKey(beforeExecution.workspace, call.collectionId, call.requestId);
      const pending = await serializeStorageMutation(async () => {
        const current = await loadSettings();
        const raw = await readFile(join(app.getPath("userData"), "workspace.json"), "utf8");
        if (createHash("sha256").update(raw).digest("hex") !== expectedRevision) throw new Error("REVISION_CONFLICT");
        if (!current.agentEnabled || !current.agentNetworkEnabled) throw new Error("NETWORK_DISABLED");
        if (current.agentNetworkMode !== settings.agentNetworkMode) throw new Error("NETWORK_APPROVAL_DENIED");
        if (settings.agentNetworkMode === "session") networkSession.assertPermit(beforeExecution.workspace, call.collectionId, call.requestId, permit!);
        checkCanceled();
        // Start transport under the owner queue, then release it before waiting for HTTP.
        return { response: sendHttpRequest({ request, environment, collection, folderPath: folderPath ? [...folderPath] : undefined }, -1,
          { maxResponseBytes: 512 * 1024, timeoutMs: 30_000, allowInsecureTls: false, redirect: "error", signal }) };
      });
      const result = await pending.response;
      checkCanceled();
      if (!result.error && result.status >= 200 && result.status < 300 && request.name === "Apinizer JWT Token" && request.url.endsWith("/auth/jwt")) {
        let token: unknown;
        try { token = JSON.parse(result.body).access_token; } catch { /* Non-JSON responses are not captured. */ }
        if (typeof token === "string" && token && token.length <= 64 * 1024) {
          captured = [token];
          let tokenSaved = false;
          await serializeStorageMutation(async () => {
            const latest = await loadWorkspace();
            const raw = await readFile(join(app.getPath("userData"), "workspace.json"), "utf8");
            checkCanceled();
            if (createHash("sha256").update(raw).digest("hex") !== beforeExecution.revision || latest.workspace.activeEnvironmentId !== environment?.id) return;
            const variable = latest.workspace.environments.find((item) => item.id === environment?.id)?.variables.find((item) => item.name === "apinizerAuthAccessToken");
            if (variable && latest.secureStorageAvailable) {
              const previous = { ...variable };
              variable.value = token as string; variable.secret = true;
              await saveWorkspace(latest.workspace);
              const generation = bumpWorkspaceGeneration();
              tokenSaved = true;
              networkSession.refreshAfterTokenCapture(latest.workspace);
              agentEvent({ kind: "token-captured", workspaceId: latest.workspace.id, environmentId: environment!.id,
                previous, value: token as string, generation });
            }
          });
          if (!tokenSaved) return { ...result, rawBody: undefined, redacted: true, responseContentIsUntrustedData: true,
            warning: "The response was received, but the token was not saved. Check the active environment, token variable and secure storage in Specfold." };
        }
      }
      return { ...result, rawBody: undefined, redacted: true, responseContentIsUntrustedData: true };
    }
  });
  checkCanceled();
  const list = observations.get(call.collectionId) ?? [];
  list.push({ requestId: call.requestId, observedAt: new Date().toISOString(), environmentName, method, route, result, definitionFingerprint });
  observations.set(call.collectionId, list.slice(-50));
  return result;
}

export async function agentDocumentation(collectionId: string, markdown = false) {
  await flushAgentEditor();
  const { workspace } = await agentSnapshot();
  const evidence = observations.get(collectionId) ?? [];
  return markdown ? documentationMarkdown(workspace, collectionId, evidence) : documentationContext(workspace, collectionId, evidence);
}
