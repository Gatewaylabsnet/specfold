import type { ApiRequest, Workspace } from "../model/types";
import { flattenRequests } from "../model/traversal";
import { prepareHttpRequest } from "../http/prepareHttpRequest";
import { environmentToMap, resolveRequestVariables, resolveVariablesInText } from "../variables/resolveVariables";
import { redactAgentValue, REDACTED, workspaceSecrets } from "../agent/redaction";
import { analyzeWorkflowInputs, assertBoundedWorkflowValue, workflowValuesEqual } from "./provenance";
import { profileAuthVariables, validateConnectionProfile } from "./profiles";
import { workflowRequest, workflowReplacedAuthFields } from "./request";
import type { ConnectionProfile, WorkflowTestPlan, WorkflowTestRow } from "./types";

export interface BuildWorkflowTestPlanOptions {
  id: string;
  revision: string;
  createdAt?: string | number | Date;
  selectedRequestIds?: string[];
}

const hasReference = (value: unknown) => /\{\{[^{}]*\}\}/.test(JSON.stringify(value));
const readMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/** Build a reviewable manifest only. Never mutate saved requests, resolve auth for output, or send HTTP. */
export function buildWorkflowTestPlan(workspace: Workspace, input: ConnectionProfile, options: BuildWorkflowTestPlanOptions): WorkflowTestPlan {
  const profile = validateConnectionProfile(input);
  if (typeof options.id !== "string" || !options.id || options.id.length > 200 ||
      typeof options.revision !== "string" || !options.revision || options.revision.length > 200) throw new Error("INVALID_WORKFLOW_PLAN_OPTIONS");
  const collection = workspace.collections.find((item) => item.id === profile.collectionId);
  const environment = workspace.environments.find((item) => item.id === profile.environmentId);
  if (!collection) throw new Error("COLLECTION_NOT_FOUND");
  if (!environment) throw new Error("ENVIRONMENT_NOT_FOUND");
  assertBoundedWorkflowValue(collection);
  assertBoundedWorkflowValue(environment);
  const requests = flattenRequests(collection).map(({ request }) => request);
  if (requests.length > 500) throw new Error("WORKFLOW_REQUEST_LIMIT");
  if (options.selectedRequestIds && (!Array.isArray(options.selectedRequestIds) || options.selectedRequestIds.length > 500 ||
      options.selectedRequestIds.some((id) => typeof id !== "string" || !requests.some((request) => request.id === id)))) throw new Error("INVALID_WORKFLOW_SELECTION");
  const selected = options.selectedRequestIds ? new Set(options.selectedRequestIds) : undefined;
  const created = new Date(options.createdAt ?? Date.now());
  if (!Number.isFinite(created.getTime())) throw new Error("INVALID_WORKFLOW_PLAN_OPTIONS");
  const variables = environmentToMap(environment, { baseUrl: profile.baseUrl });
  const captureVariable = profile.auth.kind === "apinizer" ? profile.auth.tokenVariable : undefined;
  const requiredAuth = profileAuthVariables(profile).filter((name) => name !== captureVariable);
  const authMissing = requiredAuth.some((name) => {
    const variable = environment.variables.find((item) => item.name === name && item.enabled);
    if (!variable?.value || variable.value === REDACTED) return true;
    const resolved = resolveVariablesInText(variable.value, variables);
    return resolved.missing.length > 0 || hasReference(resolved.value);
  });
  const missingCapture = captureVariable !== undefined && !environment.variables.some((item) => item.name === captureVariable && item.enabled);
  const origin = new URL(profile.baseUrl).origin;
  const secrets = workspaceSecrets({ ...workspace, connectionProfiles: [...(workspace.connectionProfiles ?? []), profile] });
  const warnings = new Set<string>();
  const rows: WorkflowTestRow[] = requests.map((request) => {
    const effect = readMethods.has(request.method) ? "read" as const : "may-change-data" as const;
    const row: WorkflowTestRow = { requestId: request.id, name: request.name, method: request.method,
      route: safeRoute(request, profile.baseUrl), effect, selected: false, status: "ready", provenance: [],
      expectedStatuses: Array.from({ length: 100 }, (_, index) => 200 + index) };
    try {
      const candidate = workflowRequest(request, profile);
      const analysis = analyzeWorkflowInputs(candidate, collection, workflowReplacedAuthFields(request, profile));
      row.provenance = analysis.provenance;
      row.expectedStatuses = analysis.expectedStatuses;
      if (analysis.responseSchema !== undefined) row.responseSchema = analysis.responseSchema;
      if (analysis.responseSchemas !== undefined) row.responseSchemas = analysis.responseSchemas;
      analysis.warnings.forEach((warning) => warnings.add(warning));
      const invalid = row.provenance.find((item) => !item.valid);
      if (invalid) { row.status = "skipped"; row.reason = invalid.reason ?? "No usable documented input is available."; }
      // Workflow execution replaces auth on a clone and ignores folder routing overrides.
      candidate.auth = { type: "none" };
      const resolved = resolveRequestVariables(candidate, environment, { baseUrl: profile.baseUrl });
      if (resolved.missing.length || hasReference({ url: resolved.request.url, path: resolved.request.pathParams,
        query: resolved.request.queryParams, headers: resolved.request.headers, body: resolved.request.body.raw,
        form: resolved.request.body.form })) {
        row.status = "blocked"; row.reason = "Request variables are missing or cannot be resolved.";
      } else {
        const prepared = prepareHttpRequest(candidate, environment, { baseUrl: profile.baseUrl });
        const url = new URL(prepared.url);
        row.route = displayRoute(url, secrets);
        if (url.origin !== origin || !["http:", "https:"].includes(url.protocol) || url.username || url.password) {
          row.status = "blocked"; row.reason = "The saved request resolves outside the approved connection origin.";
        } else if (new URL(resolved.request.url, profile.baseUrl).search) {
          row.status = "skipped"; row.reason = "Inline URL query inputs have no verified example provenance; move them to documented query parameters before testing.";
          row.provenance.push({ location: "query", source: "missing", valid: false, reason: row.reason });
        }
      }
      if (authMissing || missingCapture) { row.status = "blocked"; row.reason = "Configure the profile authentication variables in its environment before testing."; }
      if (row.responseSchemas && !workflowValuesEqual(row.responseSchemas, redactAgentValue(row.responseSchemas, secrets))) {
        row.status = "blocked"; row.reason = "Response schema constraints contain sensitive data and require manual review.";
        delete row.responseSchema; delete row.responseSchemas;
      }
      if (profile.auth.kind === "apinizer" && request.name === "Apinizer JWT Token" && request.url.endsWith("/auth/jwt")) {
        row.status = "skipped"; row.reason = "The connection performs JWT authentication separately before the selected tests.";
      }
    } catch {
      row.status = "blocked"; row.reason = "The request definition is invalid, unsupported, or exceeds workflow limits.";
      if (!row.provenance.length) row.provenance.push({ location: "body", source: "missing", valid: false, reason: row.reason });
    }
    row.selected = row.status === "ready" && (selected ? selected.has(request.id) : effect === "read");
    if (row.status === "ready" && !row.selected) row.reason = effect === "may-change-data"
      ? "Explicitly select this operation; it may change server data." : "This operation was not selected.";
    return row;
  });
  if (rows.some((row) => row.effect === "may-change-data")) warnings.add("POST, PUT, PATCH and DELETE operations require explicit selection and may change server data.");
  warnings.add("A successful HTTP response or schema check does not prove business correctness.");
  const plan: WorkflowTestPlan = { id: options.id, profileId: profile.id, profileName: profile.name,
    collectionId: collection.id, environmentId: environment.id, environmentName: environment.name,
    createdAt: created.toISOString(), expiresAt: new Date(created.getTime() + 15 * 60_000).toISOString(),
    revision: options.revision, authentication: profile.auth.kind === "apinizer" ? `Apinizer JWT: ${profile.auth.endpoint}` : profile.auth.kind,
    warnings: [...warnings], rows };
  // Identifiers are execution keys, not display data. Scrubbing them can point
  // execution at the wrong row when a short credential matches part of an ID.
  return { ...plan, profileName: redactAgentValue(plan.profileName, secrets), environmentName: redactAgentValue(plan.environmentName, secrets),
    authentication: redactAgentValue(plan.authentication, secrets), warnings: plan.warnings.map((warning) => redactAgentValue(warning, secrets)),
    rows: plan.rows.map((row) => ({ ...row, name: redactAgentValue(row.name, secrets), route: redactAgentValue(row.route, secrets),
      ...(row.reason ? { reason: redactAgentValue(row.reason, secrets) } : {}),
      provenance: row.provenance.map((item) => ({ ...item, ...(item.field ? { field: redactAgentValue(item.field, secrets) } : {}),
        ...(item.reason ? { reason: redactAgentValue(item.reason, secrets) } : {}) })) })) };
}

function displayRoute(url: URL, secrets: readonly string[]): string {
  const path = url.pathname.split("/").map((segment) => {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch { return "[invalid path]"; }
    return redactAgentValue(decoded, secrets) === decoded ? segment : REDACTED;
  }).join("/");
  return redactAgentValue(`${url.origin}${path}`, secrets);
}

function safeRoute(request: ApiRequest, baseUrl: string): string {
  const path = request.openApi?.path;
  if (typeof path === "string" && path.startsWith("/") && !path.startsWith("//")) return `${baseUrl.replace(/\/+$/, "")}${path.split(/[?#]/)[0]}`;
  // A saved literal route can contain sample values; retain the origin only when
  // no specification template is available, rather than exposing resolved inputs.
  return `${new URL(baseUrl).origin}/[saved request]`;
}
