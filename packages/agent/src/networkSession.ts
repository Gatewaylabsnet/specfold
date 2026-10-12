import { createHash } from "node:crypto";
import { findRequest, prepareHttpRequest, requireAgentCollection, type Workspace } from "@openapi-collection-studio/core";
import { AgentError } from "./errors";
import type { AgentSessionSelection } from "./desktopContracts";

/** In-memory, bounded consent. Fingerprints never leave the owner process. */
export class NetworkSession {
  private grant?: { collectionId: string; environmentId: string; stamps: Map<string, string>;
    expiresAt: number; remaining: number; collectionName: string; environmentName: string; permit: number };
  private permit = 0;
  constructor(private readonly now = Date.now) {}
  stop(): void { this.grant = undefined; }
  start(workspace: Workspace, selection: AgentSessionSelection): { routes: string[] } {
    const collection = requireAgentCollection(workspace, selection.collectionId);
    const environment = workspace.environments.find((item) => item.id === workspace.activeEnvironmentId);
    if (!environment || !selection.requestIds.length || selection.requestIds.length > 50) throw new AgentError("INVALID_ARGUMENTS");
    const ids = [...new Set(selection.requestIds)];
    const routes = ids.map((id) => {
      const location = findRequest(collection, id);
      if (!location) throw new AgentError("REQUEST_NOT_FOUND");
      // Resolve the destination without requiring a token before the JWT step.
      const routing = { ...location.request, auth: { type: "none" as const }, headers: [], queryParams: [], body: { mode: "none" as const } };
      let url: URL;
      try { url = new URL(prepareHttpRequest(routing, environment, collection, location.folderPath).url); }
      catch { throw new AgentError("REQUEST_CONFIGURATION_REQUIRED"); }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new AgentError("INVALID_API_BASE_URL");
      return `${location.request.method} ${url.origin}${url.pathname}`;
    });
    this.grant = { ...selection, environmentId: environment.id, permit: ++this.permit,
      stamps: new Map(ids.map((id) => [id, this.stamp(workspace, selection.collectionId, id)])),
      expiresAt: this.now() + 15 * 60_000, remaining: 20, collectionName: collection.name, environmentName: environment.name };
    return { routes };
  }
  authorize(workspace: Workspace, collectionId: string, requestId: string): number {
    const grant = this.grant;
    if (!grant) throw new AgentError("SESSION_REQUIRED");
    if (grant.expiresAt <= this.now() || grant.remaining <= 0) { this.stop(); throw new AgentError("SESSION_EXPIRED"); }
    if (collectionId !== grant.collectionId || !grant.stamps.has(requestId)) throw new AgentError("SESSION_REQUIRED");
    if (workspace.activeEnvironmentId !== grant.environmentId || grant.stamps.get(requestId) !== this.stamp(workspace, collectionId, requestId)) {
      this.stop(); throw new AgentError("SESSION_EXPIRED");
    }
    grant.remaining--;
    return grant.permit;
  }
  /** Recheck a reserved send immediately before transport without consuming twice. */
  assertPermit(workspace: Workspace, collectionId: string, requestId: string, permit: number): void {
    const grant = this.grant;
    if (!grant || grant.permit !== permit) throw new AgentError("SESSION_REQUIRED");
    if (grant.expiresAt <= this.now() || workspace.activeEnvironmentId !== grant.environmentId ||
      collectionId !== grant.collectionId || grant.stamps.get(requestId) !== this.stamp(workspace, collectionId, requestId)) {
      this.stop(); throw new AgentError("SESSION_EXPIRED");
    }
  }
  /** Refresh only after an owner-controlled, revision-checked JWT capture. */
  refreshAfterTokenCapture(workspace: Workspace): void {
    if (this.grant) for (const id of this.grant.stamps.keys()) this.grant.stamps.set(id, this.stamp(workspace, this.grant.collectionId, id));
  }
  info() {
    const grant = this.grant;
    if (!grant || grant.expiresAt <= this.now()) { this.stop(); return undefined; }
    if (grant.remaining <= 0) return undefined;
    return { collectionName: grant.collectionName, environmentName: grant.environmentName, remaining: grant.remaining, expiresAt: grant.expiresAt };
  }
  private stamp(workspace: Workspace, collectionId: string, requestId: string): string {
    const collection = requireAgentCollection(workspace, collectionId);
    const location = findRequest(collection, requestId);
    if (!location) throw new AgentError("REQUEST_NOT_FOUND");
    return createHash("sha256").update(JSON.stringify({ request: location.request, baseUrl: collection.baseUrl,
      folders: location.folderPath.map(({ id, baseUrl, accessTokenVariable }) => ({ id, baseUrl, accessTokenVariable })),
      environment: workspace.environments.find((item) => item.id === workspace.activeEnvironmentId) })).digest("hex");
  }
}
