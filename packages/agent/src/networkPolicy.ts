import { findRequest, isCredentialName, prepareHttpRequest, redactAgentValue, requireAgentCollection, workspaceSecrets,
  type Workspace } from "@openapi-collection-studio/core";
import type { AgentNetworkCall } from "./networkTransport";
import { AgentError } from "./errors";

interface NetworkDependencies {
  enabled(): Promise<boolean>;
  snapshot(): Promise<{ workspace: Workspace; revision: string }>;
  confirm(summary: { method: string; route: string }): Promise<boolean>;
  execute(payload: Parameters<typeof prepareHttpRequest>): Promise<unknown>;
}

/** The desktop owns secret resolution, native consent and HTTP execution. */
export async function executeApprovedNetwork(call: AgentNetworkCall, deps: NetworkDependencies): Promise<unknown> {
  if (!await deps.enabled()) throw new AgentError("NETWORK_DISABLED");
  const { workspace, revision } = await deps.snapshot();
  const collection = requireAgentCollection(workspace, call.collectionId);
  const location = findRequest(collection, call.requestId);
  if (!location) throw new AgentError("REQUEST_NOT_FOUND");
  const environment = workspace.environments.find((env) => env.id === workspace.activeEnvironmentId);
  const payload: Parameters<typeof prepareHttpRequest> = [location.request, environment, collection, location.folderPath];
  let prepared;
  try { prepared = prepareHttpRequest(...payload); }
  catch { throw new AgentError("REQUEST_CONFIGURATION_REQUIRED"); }
  const url = new URL(prepared.url);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new AgentError("INVALID_API_BASE_URL");
  const secrets = workspaceSecrets(workspace);
  const summary = { method: prepared.method, route: redactAgentValue(`${url.origin}${url.pathname}`, secrets) };
  if (!await deps.confirm(summary)) throw new AgentError("NETWORK_APPROVAL_DENIED");
  if (!await deps.enabled()) throw new AgentError("NETWORK_DISABLED");
  if ((await deps.snapshot()).revision !== revision) throw new AgentError("REVISION_CONFLICT");
  const result = await deps.execute(payload);
  // Error strings can contain reflected input; expose a generic error instead.
  if (result && typeof result === "object" && "error" in result && result.error) return { error: "Network request failed; inspect configuration in Specfold." };
  const resolvedSecrets = Object.entries(prepared.headers).filter(([name]) => isCredentialName(name)).flatMap(([, value]) =>
    [value, value.replace(/^(?:Bearer|Basic)\s+/i, "")]);
  return redactAgentValue(result, [...secrets, ...resolvedSecrets].filter(Boolean));
}
