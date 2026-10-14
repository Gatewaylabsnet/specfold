import { randomUUID } from "node:crypto";
import {
  createKeyValue, createRequest, findRequest, isCredentialName, prepareHttpRequest, redactAgentValue,
  workspaceSecrets, evaluateWorkflowResponse, workflowRequest,
  type ApiRequest, type ConnectionProfile, type WorkflowRunReport, type WorkflowTestPlan, type Workspace
} from "@openapi-collection-studio/core";
import type { SendRequestPayload, SendRequestResult } from "../shared/contracts";

export interface WorkflowRunnerDependencies {
  /** Recheck saved revision, expiry and current agent permissions. */
  checkCurrent(): Promise<void>;
  confirm(plan: WorkflowTestPlan): Promise<boolean>;
  /** The desktop starts transport under its storage owner queue. */
  send(payload: SendRequestPayload): Promise<SendRequestResult>;
  /** Persist only the existing encrypted token variable and update the expected revision. */
  captureToken(token: string): Promise<void>;
  now?(): Date;
}

const reference = (name: string) => `{{${name}}}`;
export { workflowRequest } from "@openapi-collection-studio/core";
function secretVariants(value: string): string[] {
  if (!value) return [];
  const normalized = Buffer.from(value, "utf8").toString("utf8");
  const encoded = encodeURIComponent(normalized);
  const form = encoded.replace(/%20/g, "+");
  return [value, normalized, encoded, form, encoded.replace(/%[A-F0-9]{2}/g, (part) => part.toLowerCase()),
    form.replace(/%[A-F0-9]{2}/g, (part) => part.toLowerCase())];
}

export function workflowAuthenticationRequest(profile: ConnectionProfile): ApiRequest | undefined {
  const auth = profile.auth;
  if (auth.kind !== "apinizer") return undefined;
  const request = createRequest({ name: "Apinizer authentication", method: "POST", url: auth.endpoint });
  request.headers = [createKeyValue("Content-Type", "application/x-www-form-urlencoded")];
  request.body = { mode: "form", contentType: "application/x-www-form-urlencoded", form: [
    createKeyValue("grant_type", "password"), createKeyValue("username", reference(auth.usernameVariable)),
    createKeyValue("password", reference(auth.passwordVariable)), createKeyValue("client_id", reference(auth.clientIdVariable)),
    ...(auth.clientSecretVariable ? [createKeyValue("client_secret", reference(auth.clientSecretVariable))] : [])
  ] };
  return request;
}

const safeFailure = (error: unknown): string => {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    REVISION_CONFLICT: "Workspace changed. Preview a new plan.", PLAN_EXPIRED: "Plan expired. Preview a new plan.",
    NETWORK_DISABLED: "Agent network permission is disabled.", AUTH_CONFIGURATION_REQUIRED: "Configure the profile's enabled authentication variables first.",
    TOKEN_NOT_SAVED: "Token could not be stored securely. Service requests were blocked.",
    REQUEST_OUTSIDE_PROFILE: "The request destination is outside the approved profile origin.",
    REQUEST_NOT_FOUND: "A planned request no longer exists.", NETWORK_APPROVAL_DENIED: "Network permission was declined.",
    WORKFLOW_SEND_LIMIT: "A run may send at most 20 requests including authentication.",
    NO_REQUESTS_SELECTED: "No ready requests were selected."
  };
  return messages[code] ?? "Workflow stopped. Check the saved profile and request configuration in Specfold.";
};

/** Bound report content after masking; never retain rawBody or transport errors. */
function redactReport(report: WorkflowRunReport, secrets: string[]): WorkflowRunReport {
  const clip = (value: string, max: number) => Buffer.from(value, "utf8").subarray(0, max).toString("utf8");
  const text = (value: string, max: number) => clip(redactAgentValue(value, secrets), max);
  if (report.authentication) report.authentication.message = text(report.authentication.message, 512);
  for (const result of report.results) {
    result.name = text(result.name, 160);
    result.route = text(result.route, 512);
    if (result.reason) result.reason = text(result.reason, 256);
    result.assertions = result.assertions.slice(0, 8).map((item) => ({ ...item, message: text(item.message, 256) }));
    if (result.response) {
      const masked = redactAgentValue(result.response, secrets);
      const headers: Record<string, string> = {};
      let remaining = 1024;
      let headersTruncated = false;
      for (const [key, value] of Object.entries(masked.headers)) {
        const name = clip(key, 100), content = clip(value, Math.max(0, remaining - Buffer.byteLength(name)));
        if (!content || remaining <= Buffer.byteLength(name)) break;
        if (name !== key || content !== value) headersTruncated = true;
        headers[name] = content; remaining -= Buffer.byteLength(name) + Buffer.byteLength(content);
      }
      result.response = { headers, body: clip(masked.body, 8192),
        truncated: result.response.truncated || Buffer.byteLength(masked.body) > 8192 || headersTruncated || Object.keys(headers).length < Object.keys(masked.headers).length };
    }
  }
  // JSON escaping can expand control characters beyond the per-field UTF-8 budgets.
  if (Buffer.byteLength(JSON.stringify(report)) > 1024 * 1024) for (const result of report.results) {
    result.name = clip(result.name, 40); result.route = clip(result.route, 120);
    if (result.reason) result.reason = clip(result.reason, 120);
    result.assertions = result.assertions.map((item) => ({ ...item, message: clip(item.message, 120) }));
    if (result.response) result.response = { headers: {}, body: "", truncated: true };
  }
  return report;
}

/** Pure orchestration boundary: all network, consent and persistence are injected. */
export async function executeWorkflowPlan(
  savedWorkspace: Workspace, profile: ConnectionProfile, plan: WorkflowTestPlan,
  deps: WorkflowRunnerDependencies, signal?: AbortSignal
): Promise<WorkflowRunReport> {
  const workspace = structuredClone(savedWorkspace);
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  const report: WorkflowRunReport = {
    id: randomUUID(), planId: plan.id, profileId: profile.id, startedAt: now(), completedAt: "", status: "completed",
    results: plan.rows.map((row) => ({ requestId: row.requestId, name: row.name, method: row.method, route: row.route,
      status: row.status === "blocked" ? "blocked" : !row.selected || row.status === "skipped" ? "skipped" : "blocked",
      reason: row.reason ?? (!row.selected ? "Not selected." : "Not run."), assertions: [] })),
    totals: { passed: 0, failed: 0, skipped: 0, blocked: 0 }
  };
  const secrets = workspaceSecrets(workspace);
  const check = async () => { signal?.throwIfAborted(); await deps.checkCurrent(); signal?.throwIfAborted(); };
  const collection = workspace.collections.find((item) => item.id === profile.collectionId);
  const environment = workspace.environments.find((item) => item.id === profile.environmentId);
  const ready = plan.rows.filter((row) => row.selected && row.status === "ready");
  const authRequest = workflowAuthenticationRequest(profile);
  const payloadFor = (request: ApiRequest, authentication = false): SendRequestPayload => {
    const payload = { request, environment, collection: { baseUrl: profile.baseUrl }, folderPath: [] };
    const prepared = prepareHttpRequest(request, environment, payload.collection, []);
    const url = new URL(prepared.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (!authentication && url.origin !== new URL(profile.baseUrl).origin)) throw new Error("REQUEST_OUTSIDE_PROFILE");
    for (const [name, value] of Object.entries(prepared.headers)) if (isCredentialName(name)) {
      secrets.push(value, value.replace(/^(?:Bearer|Basic)\s+/i, ""));
    }
    return payload;
  };
  try {
    await check();
    if (!collection || !environment) throw new Error("AUTH_CONFIGURATION_REQUIRED");
    if (!ready.length) throw new Error("NO_REQUESTS_SELECTED");
    if (ready.length + (authRequest ? 1 : 0) > 20) throw new Error("WORKFLOW_SEND_LIMIT");
    const auth = profile.auth;
    const names = auth.kind === "none" ? [] : auth.kind === "apinizer"
      ? [auth.usernameVariable, auth.passwordVariable, auth.clientIdVariable, ...(auth.clientSecretVariable ? [auth.clientSecretVariable] : [])]
      : auth.kind === "bearer" ? [auth.tokenVariable] : auth.kind === "basic"
        ? [auth.usernameVariable, auth.passwordVariable] : [auth.valueVariable];
    if (names.some((name) => !environment.variables.some((value) => value.name === name && value.enabled && value.value.trim()))) {
      throw new Error("AUTH_CONFIGURATION_REQUIRED");
    }
    // Treat profile references as secrets even when a legacy environment forgot its Secret flag.
    for (const variable of environment.variables) if (names.includes(variable.name) ||
      ((auth.kind === "apinizer" || auth.kind === "bearer") && variable.name === auth.tokenVariable)) secrets.push(variable.value);
    if (auth.kind === "apinizer" && !environment.variables.some((value) => value.name === auth.tokenVariable && value.enabled)) {
      throw new Error("AUTH_CONFIGURATION_REQUIRED");
    }
    await check();
    const consentSecrets = [...new Set(secrets.flatMap(secretVariants))].sort((left, right) => right.length - left.length);
    const display = (value: string) => redactAgentValue(value, consentSecrets);
    const consent = { ...plan, profileName: display(plan.profileName), environmentName: display(plan.environmentName),
      authentication: plan.authentication ? display(plan.authentication) : undefined,
      rows: plan.rows.map((row) => ({ ...row, name: display(row.name), route: display(row.route) })) };
    if (!await deps.confirm(consent)) throw new Error("NETWORK_APPROVAL_DENIED");
    await check();
    if (authRequest && auth.kind === "apinizer") {
      const response = await deps.send(payloadFor(authRequest, true));
      signal?.throwIfAborted();
      let token: unknown;
      try { token = JSON.parse(response.rawBody || response.body).access_token; } catch { /* Issuer must return JSON. */ }
      if (typeof token === "string" && token) secrets.push(token);
      if (response.error || response.truncated || response.status < 200 || response.status >= 300 ||
        typeof token !== "string" || !token.trim() || token.length > 64 * 1024) {
        report.authentication = { status: "failed", message: "Authentication did not return a usable access_token. Service requests were blocked." };
        report.status = "blocked";
      } else {
        await check();
        await deps.captureToken(token);
        signal?.throwIfAborted();
        environment.variables.find((value) => value.name === auth.tokenVariable)!.value = token;
        report.authentication = { status: "passed", message: "Issuer token stored securely for this profile." };
      }
    }
    if (report.status !== "blocked") for (const row of ready) {
      await check();
      const location = findRequest(collection, row.requestId);
      if (!location) throw new Error("REQUEST_NOT_FOUND");
      const response = await deps.send(payloadFor(workflowRequest(location.request, profile)));
      signal?.throwIfAborted();
      const assertions = evaluateWorkflowResponse(row, response);
      const failed = response.error || assertions.some((item) => item.outcome === "failed");
      const blocked = assertions.some((item) => item.outcome === "blocked");
      const result = report.results.find((item) => item.requestId === row.requestId)!;
      Object.assign(result, { status: failed ? "failed" : blocked ? "blocked" : "passed", assertions,
        reason: response.error ? "Network request failed; inspect configuration in Specfold." : undefined,
        httpStatus: response.status, durationMs: response.durationMs,
        response: response.error ? undefined : { headers: response.headers, body: response.body, truncated: response.truncated } });
    }
  } catch (error) {
    report.status = signal?.aborted ? "canceled" : "blocked";
    const reason = signal?.aborted ? "Run canceled. No further requests were sent." : safeFailure(error);
    for (const result of report.results) if (result.status === "blocked" && result.reason === "Not run.") result.reason = reason;
    if (authRequest && !report.authentication) report.authentication = { status: "blocked", message: reason };
  }
  if (report.authentication?.status === "failed") for (const result of report.results) {
    if (result.status === "blocked" && result.reason === "Not run.") result.reason = "Blocked because authentication failed.";
  }
  for (const result of report.results) report.totals[result.status]++;
  report.completedAt = now();
  return redactReport(report, [...new Set(secrets.flatMap(secretVariants))].sort((left, right) => right.length - left.length));
}
