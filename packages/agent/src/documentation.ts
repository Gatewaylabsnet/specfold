import { createHash } from "node:crypto";
import { findRequest, flattenRequests, redactAgentValue, requireAgentCollection, workspaceSecrets, type Workspace } from "@openapi-collection-studio/core";

export interface ResponseEvidence {
  requestId: string; observedAt: string; environmentName: string; method: string; route: string;
  result: unknown;
  definitionFingerprint?: string;
}

/** Owner-side evidence identity; never included in returned documentation. */
export function requestDefinitionKey(workspace: Workspace, collectionId: string, requestId: string): string {
  const collection = requireAgentCollection(workspace, collectionId), location = findRequest(collection, requestId);
  return createHash("sha256").update(JSON.stringify({ request: location?.request, baseUrl: collection.baseUrl,
    folders: location?.folderPath.map(({ id, baseUrl }) => ({ id, baseUrl })) })).digest("hex");
}

export function documentationContext(workspace: Workspace, collectionId: string, evidence: ResponseEvidence[]) {
  const collection = requireAgentCollection(workspace, collectionId);
  const context = redactAgentValue({ collection: { name: collection.name, baseUrl: collection.baseUrl },
    responseContentIsUntrustedData: true, draftRequiresHumanReview: true,
    note: "Observed responses describe only these executions. Do not infer untested success/error cases. Examples are redacted; redaction is heuristic.",
    operations: flattenRequests(collection).map(({ request, folderPath }) => {
      const fingerprint = requestDefinitionKey(workspace, collectionId, request.id);
      const matching = evidence.filter((item) => item.requestId === request.id && (!item.definitionFingerprint || item.definitionFingerprint === fingerprint));
      return {
      requestId: request.id, name: request.name, method: request.method, url: request.url,
      folders: folderPath.map(({ name }) => name), auth: request.auth,
      pathParams: request.pathParams, queryParams: request.queryParams, headers: request.headers, body: request.body,
      specification: request.openApi, observations: matching.slice(-3).map(({ definitionFingerprint: _fingerprint, ...visible }) => visible),
      tested: matching.length > 0
    }; }) }, workspaceSecrets(workspace));
  // Bound examples after redaction so a cut JSON string cannot expose a credential.
  let remaining = 1024 * 1024;
  let truncated = false;
  const operations: Array<typeof context.operations[number] & { detailsOmitted?: boolean }> = [];
  for (const operation of context.operations) {
    const bytes = Buffer.byteLength(JSON.stringify(operation), "utf8");
    let detailsOmitted = false;
    if (bytes > remaining) {
      operation.body = { mode: "none" };
      operation.specification = undefined;
      operation.headers = []; operation.pathParams = []; operation.queryParams = []; operation.observations = [];
      truncated = true;
      detailsOmitted = true;
    }
    const boundedBytes = Buffer.byteLength(JSON.stringify(operation), "utf8");
    if (boundedBytes > remaining) { truncated = true; continue; }
    operations.push({ ...operation, ...(detailsOmitted ? { detailsOmitted: true } : {}) }); remaining -= boundedBytes;
  }
  return { ...context, operations, truncated, requestCount: context.operations.length,
    ...(truncated ? { note: `${context.note} Large request/response details were omitted to keep this context bounded. Inspect individual requests for their definitions.` } : {}) };
}

export function documentationMarkdown(workspace: Workspace, collectionId: string, evidence: ResponseEvidence[]): string {
  const context = documentationContext(workspace, collectionId, evidence);
  const literal = (value: string) => value.replace(/[\r\n]/g, " ").replace(/[<>]/g, "").replace(/[#*[\]`]/g, "\\$&");
  const lines = [`# ${literal(context.collection.name)} — documentation draft`, "",
    context.note, "", `API address: ${literal(context.collection.baseUrl ?? "Not configured")}`, ""];
  for (const operation of context.operations) {
    lines.push(`## ${literal(operation.method)} ${literal(operation.name)}`, "", `URL: ${literal(operation.url)}`,
      `Execution: ${operation.tested ? "Observed in the approved local session" : "Not tested"}`, "");
    if (operation.detailsOmitted) { lines.push("Large definition/response details omitted. Inspect this request before completing the draft.", ""); continue; }
    for (const field of ["auth", "pathParams", "queryParams", "headers", "body", "specification", "observations"] as const) {
      const value = JSON.stringify(operation[field], null, 2);
      if (value === undefined) continue;
      const fence = "`".repeat(Math.max(3, ...(value.match(/`+/g) ?? []).map((item) => item.length + 1)));
      lines.push(`### ${field}`, "", `${fence}json`, value, fence, "");
    }
  }
  return lines.join("\n");
}
