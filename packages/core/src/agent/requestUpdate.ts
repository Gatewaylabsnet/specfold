import type { ApiRequest, Collection, Workspace } from "../model/types";
import { flattenRequests, folderAccessTokenVariable, type RequestWithLocation } from "../model/traversal";
import { assertBoundedWorkflowValue, workflowDocument, workflowValuesEqual } from "../workflow/provenance";
import { applyRequestBodyEdit } from "./requestBodyEdit";
import { applyRequestHeaderEdits, requestHeaderGuards, requestTransportWarnings } from "./requestHeadersEdit";
import type { RequestEdit, RequestUpdateSummary } from "./types";

/** Operates only on the cloned candidate collection; errors discard the entire candidate. */
export function planRequestEdits(collection: Collection, workspace: Workspace, edits: RequestEdit[]): RequestUpdateSummary {
  if (!Array.isArray(edits) || !edits.length || edits.length > 25 ||
      new Set(edits.map(({ requestId }) => requestId)).size !== edits.length) throw new Error("REQUEST_UPDATE_INVALID");
  try { assertBoundedWorkflowValue(edits); }
  catch { throw new Error("REQUEST_UPDATE_INVALID"); }
  const targets = new Map<string, RequestWithLocation>();
  const selected = new Set(edits.map(({ requestId }) => requestId));
  for (const entry of flattenRequests(collection)) {
    if (!selected.has(entry.request.id)) continue;
    if (targets.has(entry.request.id)) throw new Error("REQUEST_UPDATE_INVALID");
    targets.set(entry.request.id, entry);
  }
  if (targets.size !== edits.length) throw new Error("REQUEST_NOT_FOUND");
  const document = workflowDocument(collection);
  const summary: RequestUpdateSummary = { changed: false, requests: [] };
  const writes: Array<{ request: ApiRequest; body?: ApiRequest["body"]; headers?: ApiRequest["headers"] }> = [];
  for (const { requestId, body, headers } of edits) {
    if (body === undefined && headers === undefined) throw new Error("REQUEST_UPDATE_INVALID");
    const { request, folderPath } = targets.get(requestId)!;
    const guards = requestHeaderGuards(request, collection, workspace, Boolean(folderAccessTokenVariable(folderPath)));
    const nextBody = body === undefined ? undefined : applyRequestBodyEdit(request, body, document, (name) => guards.credentialVariables.has(name));
    const nextHeaders = headers === undefined ? undefined : applyRequestHeaderEdits(request, headers, guards);
    const bodyChanged = nextBody && !workflowValuesEqual(request.body, nextBody.body);
    const headersChanged = nextHeaders && !workflowValuesEqual(request.headers, nextHeaders.headers);
    const bodyWrite = bodyChanged ? nextBody.body : undefined;
    const headersWrite = headersChanged ? nextHeaders.headers : undefined;
    const candidate = { ...request, body: bodyWrite ?? request.body, headers: headersWrite ?? request.headers };
    if (bodyChanged || headersChanged) writes.push({ request, body: bodyWrite, headers: headersWrite });
    summary.changed ||= Boolean(bodyChanged || headersChanged);
    summary.requests.push({
      requestId, operation: `${request.method} ${request.openApi?.path ?? request.name}`.slice(0, 240),
      changes: [...(bodyChanged ? nextBody.changes : []), ...(headersChanged ? nextHeaders.changes : [])],
      warnings: [...new Set([...(nextBody?.warnings ?? []), ...requestTransportWarnings(candidate, guards)])]
    });
  }
  for (const { request, body, headers } of writes) {
    if (body) request.body = body;
    if (headers) request.headers = headers;
  }
  return summary;
}
