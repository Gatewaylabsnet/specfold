// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createCollection, createEmptyWorkspace, createRequest } from "@openapi-collection-studio/core";
import type { ConnectionProfile, WorkflowAuth, WorkflowRunReport, WorkflowTestPlan } from "../../../../../../packages/core/src/workflow/types";
import { DEFAULT_SETTINGS, type WorkflowProfileSaveInput } from "../../../shared/contracts";
import { studioMock } from "../../App.testHelpers";
import { WorkflowWizard } from "./WorkflowWizard";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function fixture(auth?: WorkflowAuth) {
  const workspace = { ...createEmptyWorkspace("Workflow workspace"), connectionProfiles: [] as ConnectionProfile[] };
  const collection = createCollection("Demo API");
  collection.baseUrl = "https://api.example.test";
  collection.requests = [
    { ...createRequest({ name: "List users", method: "GET", url: "/users" }), id: "read-users" },
    { ...createRequest({ name: "Create user", method: "POST", url: "/users" }), id: "create-user" },
    { ...createRequest({ name: "Read missing user", method: "GET", url: "/users/{id}" }), id: "missing-user" }
  ];
  workspace.collections.push(collection);
  const environment = workspace.environments[0]; environment.name = "Staging";
  environment.variables = ["token", "username", "password", "key", "clientId", "clientSecret"].map((name) => ({
    id: name, name, value: `SYNTHETIC_STORED_${name}`, enabled: true, secret: true
  }));
  const profile: ConnectionProfile = {
    id: "profile-demo", name: "Sandbox API", provider: auth?.kind === "apinizer" ? "apinizer" : "openapi",
    collectionId: collection.id, environmentId: environment.id, baseUrl: collection.baseUrl,
    source: { kind: "existing", label: collection.name }, auth: auth ?? { kind: "none" }
  };
  if (auth) workspace.connectionProfiles.push(profile);
  const plan: WorkflowTestPlan = {
    id: "plan-original", profileId: profile.id, profileName: profile.name,
    collectionId: collection.id, environmentId: environment.id, environmentName: environment.name,
    createdAt: "2026-10-13T10:00:00.000Z", expiresAt: "2026-10-13T11:00:00.000Z", revision: "revision-original", warnings: [],
    rows: [
      { requestId: "read-users", name: "List users", method: "GET", route: "/users", effect: "read", selected: true,
        status: "ready", provenance: [], expectedStatuses: [200] },
      { requestId: "create-user", name: "Create user", method: "POST", route: "/users", effect: "may-change-data", selected: false,
        status: "ready", provenance: [{ location: "body", source: "example", valid: true }], expectedStatuses: [201] },
      { requestId: "missing-user", name: "Read missing user", method: "GET", route: "/users/{id}", effect: "read", selected: false,
        status: "blocked", reason: "Missing required path example: id",
        provenance: [{ location: "path", field: "id", source: "missing", valid: false }], expectedStatuses: [200] }
    ]
  };
  const report: WorkflowRunReport = {
    id: "report-demo", planId: plan.id, profileId: profile.id, status: "completed",
    startedAt: "2026-10-13T10:01:00.000Z", completedAt: "2026-10-13T10:01:01.000Z",
    totals: { passed: 1, failed: 0, skipped: 1, blocked: 1 },
    results: [{ requestId: "read-users", name: "List users", method: "GET", route: "/users", status: "passed", httpStatus: 200,
      assertions: [{ name: "status", outcome: "passed", message: "Status 200 matches the documented response." }] },
      { requestId: "create-user", name: "Create user", method: "POST", route: "/users", status: "skipped",
        reason: "This operation was not selected.", assertions: [] },
      { requestId: "missing-user", name: "Read missing user", method: "GET", route: "/users/{id}", status: "blocked",
        reason: "Missing required path example: id", assertions: [] }]
  };
  const saved = { workspace: { ...workspace, connectionProfiles: [profile] }, recovered: false, secureStorageAvailable: true,
    generation: 8, profileId: profile.id };
  const api = Object.assign(studioMock(workspace), {
    saveWorkflowProfile: vi.fn(async (_input: WorkflowProfileSaveInput) => saved),
    previewWorkflowRun: vi.fn(async (_profileId: string, _selectedIds?: string[]) => plan),
    runWorkflowPlan: vi.fn(async (_planId: string) => report),
    cancelWorkflowRun: vi.fn(async () => undefined)
  });
  vi.mocked(api.loadWorkspace).mockResolvedValue({ workspace, recovered: false, secureStorageAvailable: true, generation: 7 });
  window.studio = api;
  const props = { workspace, settings: { ...DEFAULT_SETTINGS }, secureStorageAvailable: true,
    saveWorkspaceNow: vi.fn(async (): Promise<void> => undefined), replaceSavedWorkspace: vi.fn(), onOpenSettings: vi.fn(), onClose: vi.fn(), onRunningChange: vi.fn() };
  return { api, props, collection, environment, profile, plan, report, saved, user: userEvent.setup() };
}

async function authentication(context: ReturnType<typeof fixture>, existing = false) {
  const { user, profile, collection, environment } = context;
  if (existing) await user.selectOptions(screen.getByRole("combobox", { name: "Existing profile" }), profile.id);
  else {
    await user.clear(screen.getByLabelText("Profile name"));
    await user.type(screen.getByLabelText("Profile name"), profile.name);
    await user.click(screen.getByRole("radio", { name: "Existing collection" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Existing collection" }), collection.id);
    await user.selectOptions(screen.getByRole("combobox", { name: "Environment" }), environment.id);
    await user.clear(screen.getByLabelText("Base URL"));
    await user.type(screen.getByLabelText("Base URL"), profile.baseUrl);
  }
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("combobox", { name: "Authentication" });
}

async function preview(context: ReturnType<typeof fixture>) {
  await authentication(context);
  await context.user.click(screen.getByRole("button", { name: "Save & preview" }));
  await screen.findByRole("checkbox", { name: "Select List users" });
}

function expectMcpUnchanged(api: ReturnType<typeof fixture>["api"]) {
  expect(api.saveSettings).not.toHaveBeenCalled();
  expect(api.startAgentSession).not.toHaveBeenCalled();
  expect(api.testAgentConnection).not.toHaveBeenCalled();
}

it("flushes pending workspace edits before saving with the current generation and keeps unsafe rows unselected", async () => {
  const context = fixture(); const flush = deferred<void>();
  context.props.saveWorkspaceNow.mockImplementationOnce(() => flush.promise);
  render(<WorkflowWizard {...context.props} />);
  await authentication(context);
  await context.user.click(screen.getByRole("button", { name: "Save & preview" }));
  expect(context.api.loadWorkspace).not.toHaveBeenCalled();
  expect(context.api.saveWorkflowProfile).not.toHaveBeenCalled();
  await act(async () => { flush.resolve(); });
  const read = await screen.findByRole("checkbox", { name: "Select List users" }) as HTMLInputElement;
  const write = screen.getByRole("checkbox", { name: "Select Create user" }) as HTMLInputElement;
  const missing = screen.getByRole("checkbox", { name: "Select Read missing user" }) as HTMLInputElement;
  expect(context.api.saveWorkflowProfile).toHaveBeenCalledWith(expect.objectContaining({ expectedGeneration: 7 }));
  expect(context.props.replaceSavedWorkspace).toHaveBeenCalledWith(context.saved);
  expect(read.checked).toBe(true); expect(write.checked).toBe(false);
  expect(missing.checked).toBe(false); expect(missing.disabled).toBe(true);
  expect(screen.getAllByText("Missing required path example: id").length).toBeGreaterThan(0);
  await context.user.click(missing);
  expect(context.api.previewWorkflowRun).toHaveBeenCalledTimes(1);
  expect(context.api.runWorkflowPlan).not.toHaveBeenCalled();
  expect(context.api.sendRequest).not.toHaveBeenCalled();
  expectMcpUnchanged(context.api);
});

it("requires explicit POST selection and disables running until the replacement preview arrives", async () => {
  const context = fixture(); render(<WorkflowWizard {...context.props} />); await preview(context);
  const refresh = deferred<WorkflowTestPlan>();
  context.api.previewWorkflowRun.mockImplementationOnce(() => refresh.promise);
  await context.user.click(screen.getByRole("checkbox", { name: "Select Create user" }));
  expect(context.api.previewWorkflowRun).toHaveBeenLastCalledWith(context.profile.id, ["read-users", "create-user"]);
  const run = screen.getByRole("button", { name: "Run selected tests" }) as HTMLButtonElement;
  expect(run.disabled).toBe(true); await context.user.click(run);
  expect(context.api.runWorkflowPlan).not.toHaveBeenCalled();
  const nextPlan = { ...context.plan, id: "plan-with-post", rows: context.plan.rows.map((row) => ({ ...row,
    selected: row.requestId !== "missing-user" })) };
  await act(async () => { refresh.resolve(nextPlan); });
  await context.user.click(screen.getByRole("button", { name: "Run selected tests" }));
  await waitFor(() => expect(context.api.runWorkflowPlan).toHaveBeenCalledWith(nextPlan.id));
  expect(context.api.runWorkflowPlan).not.toHaveBeenCalledWith(context.plan.id);
});

it("does not save or preview when the refreshed workspace has no generation", async () => {
  const context = fixture();
  vi.mocked(context.api.loadWorkspace).mockResolvedValueOnce({ workspace: context.props.workspace, recovered: false, secureStorageAvailable: true });
  render(<WorkflowWizard {...context.props} />); await authentication(context);
  await context.user.click(screen.getByRole("button", { name: "Save & preview" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Could not save the workflow");
  expect(context.props.saveWorkspaceNow).toHaveBeenCalledTimes(1);
  expect(context.api.saveWorkflowProfile).not.toHaveBeenCalled();
  expect(context.api.previewWorkflowRun).not.toHaveBeenCalled();
  expect(context.props.replaceSavedWorkspace).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Save & preview" }) as HTMLButtonElement).disabled).toBe(false);
});

it("rejects a source URL containing a secret query before downloading and never echoes it in the error", async () => {
  const context = fixture(); const secret = "SYNTHETIC_SOURCE_API_KEY";
  render(<WorkflowWizard {...context.props} />);
  await context.user.click(screen.getByRole("radio", { name: "OpenAPI URL" }));
  await context.user.type(screen.getByRole("textbox", { name: "OpenAPI URL" }), `https://api.example.test/openapi.json?api_key=${secret}`);
  await context.user.click(screen.getByRole("button", { name: "Load OpenAPI URL" }));
  const error = await screen.findByRole("alert");
  expect(error.textContent).toContain("without credentials or secret query parameters");
  expect(error.textContent).not.toContain(secret);
  expect(document.body.textContent).not.toContain(secret);
  expect(context.api.fetchImportUrl).not.toHaveBeenCalled();
  expect(context.api.saveWorkflowProfile).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
});

const sendLimitCases: Array<{ name: string; limit: number; auth?: WorkflowAuth }> = [
  { name: "generic API", limit: 20 },
  { name: "Apinizer authentication", limit: 19, auth: { kind: "apinizer", endpoint: "https://api.example.test/auth/jwt",
    usernameVariable: "username", passwordVariable: "password", clientIdVariable: "clientId", tokenVariable: "token" } }
];

it.each(sendLimitCases)("enforces the selected-test limit for $name and permits a fresh preview at the boundary", async ({ limit, auth }) => {
  const context = fixture(auth);
  const oversizedPlan: WorkflowTestPlan = { ...context.plan, rows: Array.from({ length: limit + 1 }, (_, index) => ({
    ...context.plan.rows[0], requestId: `read-${index}`, name: index === 0 ? "List users" : `Read item ${index}`
  })) };
  context.api.previewWorkflowRun.mockResolvedValueOnce(oversizedPlan);
  render(<WorkflowWizard {...context.props} />); await authentication(context, !!auth);
  await context.user.click(screen.getByRole("button", { name: "Save & preview" }));
  await screen.findByRole("checkbox", { name: "Select List users" });
  const run = screen.getByRole("button", { name: "Run selected tests" }) as HTMLButtonElement;
  expect(run.disabled).toBe(true);
  expect(screen.getByText(new RegExp(`Select at most ${limit} tests per run`)).textContent).toContain("20 network sends including authentication");
  if (auth) expect(screen.getByText(/one send is reserved for the Apinizer token/)).toBeTruthy();
  await context.user.click(run);
  expect(context.api.runWorkflowPlan).not.toHaveBeenCalled();
  const boundaryPlan = { ...oversizedPlan, id: "plan-at-limit", rows: oversizedPlan.rows.map((row, index) => ({ ...row, selected: index < limit })) };
  context.api.previewWorkflowRun.mockResolvedValueOnce(boundaryPlan);
  await context.user.click(screen.getByRole("checkbox", { name: `Select Read item ${limit}` }));
  expect(context.api.previewWorkflowRun).toHaveBeenLastCalledWith(context.profile.id, boundaryPlan.rows.filter((row) => row.selected).map((row) => row.requestId));
  await waitFor(() => expect((screen.getByRole("button", { name: "Run selected tests" }) as HTMLButtonElement).disabled).toBe(false));
  await context.user.click(screen.getByRole("button", { name: "Run selected tests" }));
  expect(context.api.runWorkflowPlan).toHaveBeenCalledWith(boundaryPlan.id);
});

it("invalidates the old plan after a selection preview fails and retries the explicit selection", async () => {
  const context = fixture(); render(<WorkflowWizard {...context.props} />); await preview(context);
  context.api.previewWorkflowRun.mockRejectedValueOnce(new Error("SYNTHETIC_PREVIEW_SECRET"));
  await context.user.click(screen.getByRole("checkbox", { name: "Select Create user" }));
  const retry = await screen.findByRole("button", { name: "Retry preview" });
  const run = screen.queryByRole("button", { name: "Run selected tests" }) as HTMLButtonElement | null;
  expect(run === null || run.disabled).toBe(true);
  expect(document.body.textContent).not.toContain("SYNTHETIC_PREVIEW_SECRET");
  expect(context.api.runWorkflowPlan).not.toHaveBeenCalled();
  await context.user.click(retry);
  await screen.findByRole("checkbox", { name: "Select List users" });
  expect(context.api.previewWorkflowRun).toHaveBeenLastCalledWith(context.profile.id, ["read-users", "create-user"]);
  expect(context.api.saveWorkflowProfile).toHaveBeenCalledTimes(1);
});

it("preserves the saved connection across a preview failure, retry, and back navigation without enabling MCP", async () => {
  const context = fixture(); context.api.previewWorkflowRun.mockRejectedValueOnce(new Error("Private backend detail"));
  render(<WorkflowWizard {...context.props} />); await authentication(context);
  await context.user.click(screen.getByRole("button", { name: "Save & preview" }));
  await context.user.click(await screen.findByRole("button", { name: "Retry preview" }));
  await screen.findByRole("checkbox", { name: "Select List users" });
  expect(context.api.saveWorkflowProfile).toHaveBeenCalledTimes(1);
  await context.user.click(screen.getByRole("button", { name: "Back to authentication" }));
  await context.user.click(screen.getByRole("button", { name: "Back to connection" }));
  expect((screen.getByLabelText("Profile name") as HTMLInputElement).value).toBe(context.profile.name);
  expect((screen.getByLabelText("Base URL") as HTMLInputElement).value).toBe(context.profile.baseUrl);
  expect(document.body.textContent).not.toContain("Private backend detail");
  expectMcpUnchanged(context.api);
});

it("keeps navigation locked after cancellation is requested until the pending run settles", async () => {
  const context = fixture(); const running = deferred<WorkflowRunReport>();
  context.api.runWorkflowPlan.mockImplementationOnce(() => running.promise);
  render(<WorkflowWizard {...context.props} />); await preview(context);
  await context.user.click(screen.getByRole("button", { name: "Run selected tests" }));
  await waitFor(() => expect(context.props.onRunningChange).toHaveBeenLastCalledWith(true));
  await context.user.click(screen.getByRole("button", { name: "Cancel run" }));
  expect(context.api.cancelWorkflowRun).toHaveBeenCalledTimes(1);
  for (const name of ["Back to authentication", "Preview again", "Back to editor"]) {
    const button = screen.queryByRole("button", { name }) as HTMLButtonElement | null;
    expect(button === null || button.disabled).toBe(true);
  }
  expect((screen.getByRole("button", { name: "Canceling..." }) as HTMLButtonElement).disabled).toBe(true);
  expect(context.props.onClose).not.toHaveBeenCalled();
  expect(context.props.onRunningChange).toHaveBeenLastCalledWith(true);
  expect(screen.queryByRole("heading", { name: "Results" })).toBeNull();
  await act(async () => { running.resolve({ ...context.report, status: "canceled" }); });
  await screen.findByRole("heading", { name: "Results" });
  expect(context.props.onRunningChange).toHaveBeenLastCalledWith(false);
  expect((screen.getByRole("button", { name: "Preview again" }) as HTMLButtonElement).disabled).toBe(false);
});

const storedAuthCases: Array<{ name: string; auth: WorkflowAuth; fields: string[] }> = [
  { name: "bearer", auth: { kind: "bearer", tokenVariable: "token" }, fields: ["Bearer token"] },
  { name: "basic", auth: { kind: "basic", usernameVariable: "username", passwordVariable: "password" }, fields: ["Username", "Password"] },
  { name: "API key", auth: { kind: "apiKey", key: "X-API-Key", in: "header", valueVariable: "key" }, fields: ["API key value"] },
  { name: "Apinizer", auth: { kind: "apinizer", endpoint: "https://api.example.test/auth/jwt", usernameVariable: "username",
    passwordVariable: "password", clientIdVariable: "clientId", clientSecretVariable: "clientSecret", tokenVariable: "token" }, fields: ["Username", "Password", "Client ID"] }
];

it.each(storedAuthCases)("does not restore saved $name credentials into the form", async ({ auth, fields }) => {
  const context = fixture(auth); render(<WorkflowWizard {...context.props} />); await authentication(context, true);
  for (const label of fields) {
    const input = screen.getByLabelText(label) as HTMLInputElement;
    expect(input.value).toBe(""); expect(input.type).toBe("password");
  }
  if (auth.kind === "apinizer") {
    await context.user.click(screen.getByText("Advanced: variable references"));
    expect((screen.getByLabelText("Client secret") as HTMLInputElement).value).toBe("");
  }
  expect(document.body.innerHTML).not.toContain("SYNTHETIC_STORED_");
});

it("does not save newly entered credentials when secure storage is unavailable", async () => {
  const context = fixture({ kind: "bearer", tokenVariable: "token" }); context.props.secureStorageAvailable = false;
  render(<WorkflowWizard {...context.props} />); await authentication(context, true);
  expect(screen.getByRole("alert").textContent).toContain("Secure storage is unavailable");
  await context.user.type(screen.getByLabelText("Bearer token"), "SYNTHETIC_UNSAVED_TOKEN");
  const save = screen.getByRole("button", { name: "Save & preview" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true); await context.user.click(save);
  expect(context.api.saveWorkflowProfile).not.toHaveBeenCalled();
});

it("clears typed credentials after save and exports only the visible report after an explicit click", async () => {
  const context = fixture({ kind: "bearer", tokenVariable: "token" });
  render(<WorkflowWizard {...context.props} />); await authentication(context, true);
  await context.user.type(screen.getByLabelText("Bearer token"), "SYNTHETIC_TYPED_TOKEN");
  await context.user.click(screen.getByRole("button", { name: "Save & preview" }));
  await screen.findByRole("checkbox", { name: "Select List users" });
  expect(context.api.saveWorkflowProfile).toHaveBeenLastCalledWith(expect.objectContaining({ credentials: { token: "SYNTHETIC_TYPED_TOKEN" } }));
  await context.user.click(screen.getByRole("button", { name: "Back to authentication" }));
  expect((screen.getByLabelText("Bearer token") as HTMLInputElement).value).toBe("");
  await context.user.click(screen.getByRole("button", { name: "Save & preview" }));
  await screen.findByRole("checkbox", { name: "Select List users" });
  await context.user.click(screen.getByRole("button", { name: "Run selected tests" }));
  await screen.findByRole("heading", { name: "Results" });
  expect(document.body.textContent).toContain(context.report.id);
  expect(document.body.textContent).toContain("Status 200 matches the documented response.");
  expect(context.api.saveExportFile).not.toHaveBeenCalled();
  await context.user.click(screen.getByRole("button", { name: "Export JSON report" }));
  const [, content] = vi.mocked(context.api.saveExportFile).mock.lastCall!;
  expect(JSON.parse(content)).toEqual(context.report);
  expect(content).not.toContain("SYNTHETIC_STORED_"); expect(content).not.toContain("SYNTHETIC_TYPED_TOKEN");
  expect(document.body.innerHTML).not.toContain("SYNTHETIC_TYPED_TOKEN");
  expectMcpUnchanged(context.api);
});

it("saves a new bearer profile to its own variable without overwriting the shared accessToken", async () => {
  const context = fixture();
  context.environment.variables.push({ id: "shared-token", name: "accessToken", value: "SYNTHETIC_SHARED_TOKEN", enabled: true, secret: true });
  render(<WorkflowWizard {...context.props} />); await authentication(context);
  await context.user.selectOptions(screen.getByRole("combobox", { name: "Authentication" }), "bearer");
  await context.user.type(screen.getByLabelText("Bearer token"), "SYNTHETIC_NEW_PROFILE_TOKEN");
  await context.user.click(screen.getByRole("button", { name: "Save & preview" }));
  await screen.findByRole("checkbox", { name: "Select List users" });
  const [input] = context.api.saveWorkflowProfile.mock.lastCall!;
  expect(input.profile.auth.kind).toBe("bearer");
  if (input.profile.auth.kind !== "bearer") throw new Error("Expected a saved bearer profile");
  const variable = input.profile.auth.tokenVariable;
  expect(variable).toMatch(/^workflow_[a-zA-Z0-9_]+_accessToken$/);
  expect(variable).not.toBe("accessToken");
  expect(input.credentials).toEqual({ [variable]: "SYNTHETIC_NEW_PROFILE_TOKEN" });
  expect(input.credentials).not.toHaveProperty("accessToken");
  expect(context.environment.variables.find((item) => item.name === "accessToken")?.value).toBe("SYNTHETIC_SHARED_TOKEN");
});
