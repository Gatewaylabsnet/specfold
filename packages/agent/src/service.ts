import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { open, readdir, unlink } from "node:fs/promises";
import {
  applyAgentProposal, findRequest, flattenRequests, parseApiText, previewAgentMutation,
  redactAgentValue, requireAgentCollection, validateAgentCollection, workspaceSecrets,
  type AgentMutation
} from "@openapi-collection-studio/core";
import { atomicWriteFile } from "./atomicFile";
import { AgentError } from "./errors";
import { AgentRepository, readBoundedFile, revisionOf } from "./repository";
import { mutationSchema } from "./validation";
import { callNetworkHost } from "./networkTransport";
import { assertOpaqueCredentialStorage } from "./secretGuard";

interface StoredPlan {
  schema: "specfold.agent-plan.v1";
  id: string;
  expectedRevision: string;
  action: AgentMutation;
  collectionId: string;
  warnings: string[];
  createdAt: number;
  signature: string;
}
const PLAN_TTL_MS = 24 * 60 * 60 * 1000;
const checkId = (id: string) => { if (!/^[a-f0-9]{64}$/.test(id)) throw new AgentError("INVALID_PLAN"); };

export class AgentService {
  constructor(readonly repository: AgentRepository, readonly allowApply = false, readonly allowNetwork = false) {}

  async listCollections() {
    const { workspace, revision } = await this.repository.snapshot();
    return redactAgentValue({ revision, collections: workspace.collections.map((collection) => ({
      id: collection.id, name: collection.name, baseUrl: collection.baseUrl,
      requests: flattenRequests(collection).map(({ request, folderPath }) => ({
        id: request.id, name: request.name, method: request.method, path: request.openApi?.path ?? request.url,
        folders: folderPath.map((folder) => ({ id: folder.id, name: folder.name }))
      }))
    })), variables: workspace.environments.map((environment) => ({ id: environment.id, name: environment.name,
      variables: environment.variables.map((variable) => ({ name: variable.name, enabled: variable.enabled, secret: variable.secret === true }))
    })) }, workspaceSecrets(workspace));
  }

  async inspectRequest(collectionId: string, requestId: string) {
    const { workspace, revision } = await this.repository.snapshot();
    const location = findRequest(requireAgentCollection(workspace, collectionId), requestId);
    if (!location) throw new AgentError("REQUEST_NOT_FOUND");
    return redactAgentValue({ revision, request: location.request,
      folderPath: location.folderPath.map(({ id, name, baseUrl }) => ({ id, name, baseUrl })) }, workspaceSecrets(workspace));
  }

  async validateCollection(collectionId: string) {
    const { workspace, revision } = await this.repository.snapshot();
    return { revision, ...validateAgentCollection(workspace, collectionId) };
  }

  async key(): Promise<string> {
    const path = join(await this.repository.stateDirectory(), "plan-key");
    try {
      const handle = await open(path, "wx", 0o600);
      try { await handle.writeFile(randomBytes(32).toString("hex")); } finally { await handle.close(); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const key = await readBoundedFile(path, 256);
    if (!/^[a-f0-9]{64}$/.test(key)) throw new AgentError("INVALID_PLAN");
    return key;
  }

  private async sign(payload: object): Promise<string> {
    return createHmac("sha256", await this.key()).update(JSON.stringify(payload)).digest("hex");
  }

  async preview(input: unknown) {
    const parsed = mutationSchema.safeParse(input);
    if (!parsed.success) throw new AgentError("INVALID_PLAN");
    const { workspace, revision } = await this.repository.snapshot();
    let action = parsed.data;
    let proposal;
    try { proposal = previewAgentMutation(workspace, action); }
    catch (error) {
      if (action.kind === "import-openapi") throw new AgentError("INVALID_OPENAPI");
      throw error;
    }
    if (action.kind === "import-openapi") {
      // Store only sanitized source data; imported secrets/PII never enter a plan file.
      const document = parseApiText(action.text).document;
      action = { ...action, text: JSON.stringify(redactAgentValue(document, workspaceSecrets(workspace))) };
    }
    const id = revisionOf(JSON.stringify({ revision, action }));
    const payload = { schema: "specfold.agent-plan.v1" as const, id, expectedRevision: revision,
      action, collectionId: proposal.collection.id, warnings: proposal.warnings, createdAt: Date.now() };
    const plan: StoredPlan = { ...payload, signature: await this.sign(payload) };
    const path = join(await this.repository.stateDirectory(), `${id}.plan.json`);
    // Reuse an existing signed plan so repeated previews do not invalidate approval.
    try { await this.loadPlan(id); }
    catch {
      const entries = await readdir(await this.repository.stateDirectory());
      if (entries.filter((name) => name.endsWith(".plan.json")).length >= 128 && !entries.includes(`${id}.plan.json`)) {
        throw new AgentError("PLAN_LIMIT");
      }
      await atomicWriteFile(path, JSON.stringify(plan));
    }
    return redactAgentValue({ planId: id, expectedRevision: revision, diff: proposal.diff,
      warnings: [...new Set(proposal.warnings)], collection: { name: proposal.collection.name, baseUrl: proposal.collection.baseUrl },
      intent: this.intent(action), approvalRequired: true, expiresAfterHours: 24, networkRequests: 0 }, workspaceSecrets(workspace));
  }

  async loadPlan(id: string): Promise<StoredPlan> {
    checkId(id);
    try {
      const path = join(await this.repository.stateDirectory(), `${id}.plan.json`);
      const plan: StoredPlan = JSON.parse(await readBoundedFile(path, 12 * 1024 * 1024));
      const { signature, ...payload } = plan;
      if (plan.schema !== "specfold.agent-plan.v1" || plan.id !== id ||
          typeof plan.createdAt !== "number" || Date.now() - plan.createdAt > PLAN_TTL_MS ||
          plan.createdAt > Date.now() + 1000 || !mutationSchema.safeParse(plan.action).success ||
          typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) throw new AgentError("INVALID_PLAN");
      const expected = await this.sign(payload);
      if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) throw new AgentError("INVALID_PLAN");
      return plan;
    } catch { throw new AgentError("INVALID_PLAN"); }
  }

  async showDiff(planId: string) {
    const plan = await this.loadPlan(planId);
    const { workspace, revision } = await this.repository.snapshot();
    if (revision !== plan.expectedRevision) throw new AgentError("REVISION_CONFLICT");
    const proposal = previewAgentMutation(workspace, plan.action);
    return redactAgentValue({ planId, expectedRevision: revision, diff: proposal.diff,
      warnings: plan.warnings, intent: this.intent(plan.action) }, workspaceSecrets(workspace));
  }

  /** Called only by the interactive CLI after a human types the exact challenge. */
  async approve(planId: string, expectedRevision: string) {
    const plan = await this.loadPlan(planId);
    const { revision } = await this.repository.snapshot();
    if (plan.expectedRevision !== expectedRevision || revision !== expectedRevision) throw new AgentError("REVISION_CONFLICT");
    const approvalPayload = { planId, expectedRevision, planSignature: plan.signature };
    const approval = { ...approvalPayload, signature: await this.sign(approvalPayload) };
    await atomicWriteFile(join(await this.repository.stateDirectory(), `${planId}.approval.json`), JSON.stringify(approval));
    return { planId, approved: true, expectedRevision };
  }

  async apply(planId: string, expectedRevision: string): Promise<{ planId: string; revision: string; collectionId: string; alreadyApplied: boolean; safetyBackup?: string }> {
    if (!this.allowApply) throw new AgentError("WRITES_DISABLED");
    const plan = await this.loadPlan(planId);
    if (expectedRevision !== plan.expectedRevision) throw new AgentError("REVISION_CONFLICT");
    return this.repository.locked(async () => {
      const snapshot = await this.repository.snapshot();
      const directory = await this.repository.stateDirectory();
      const receiptPath = join(directory, `${planId}.receipt.json`);
      try {
        const receipt = JSON.parse(await readBoundedFile(receiptPath, 4096));
        const { signature, ...payload } = receipt;
        if (signature === await this.sign(payload) && receipt.revision === snapshot.revision && receipt.planId === planId) {
          return { planId, revision: snapshot.revision, collectionId: receipt.collectionId, alreadyApplied: true };
        }
      } catch { /* An absent receipt does not grant permission. */ }
      if (snapshot.revision !== expectedRevision) throw new AgentError("REVISION_CONFLICT");
      assertOpaqueCredentialStorage(snapshot.workspace);
      try {
        const approval = JSON.parse(await readBoundedFile(join(directory, `${planId}.approval.json`), 4096));
        if (approval.planId !== planId || approval.expectedRevision !== expectedRevision ||
            approval.planSignature !== plan.signature ||
            approval.signature !== await this.sign({ planId, expectedRevision, planSignature: plan.signature })) throw new AgentError("APPROVAL_REQUIRED");
      } catch { throw new AgentError("APPROVAL_REQUIRED"); }
      const proposal = previewAgentMutation(snapshot.workspace, plan.action);
      if (!proposal.targetCollectionId) proposal.collection.id = plan.collectionId;
      const workspace = applyAgentProposal(snapshot.workspace, proposal);
      assertOpaqueCredentialStorage(workspace);
      const revision = revisionOf(JSON.stringify(workspace, null, 2));
      const receiptPayload = { planId, revision, collectionId: proposal.collection.id };
      const receipt = { ...receiptPayload, signature: await this.sign(receiptPayload) };
      const safetyBackup = await this.repository.commit(workspace, snapshot.raw, receiptPath, receipt);
      await unlink(join(directory, `${planId}.approval.json`)).catch(() => undefined);
      return { ...receiptPayload, alreadyApplied: false, safetyBackup };
    });
  }

  async sendRequest(collectionId: string, requestId: string): Promise<unknown> {
    if (!this.allowNetwork) throw new AgentError("NETWORK_DISABLED");
    return callNetworkHost(this.repository.root, { collectionId, requestId });
  }

  private intent(action: AgentMutation) {
    if (action.kind === "import-openapi") return { kind: action.kind, targetCollectionId: action.targetCollectionId, apinizer: action.apinizer === true,
      tokenVariable: action.apinizer ? "apinizerAuthAccessToken" : undefined };
    if (action.kind === "bind-bearer") return { kind: action.kind, collectionId: action.collectionId, variableName: action.variableName,
      requestId: action.requestId, folderId: action.folderId };
    return { kind: action.kind, collectionId: action.collectionId, baseUrl: action.baseUrl };
  }
}
