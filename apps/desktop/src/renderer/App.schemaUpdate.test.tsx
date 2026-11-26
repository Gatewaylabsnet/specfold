// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCollection, createEmptyWorkspace, createRequest } from "@openapi-collection-studio/core";
import type { AgentPlanReview } from "../shared/contracts";
import { renderApp, studioMock } from "./App.testHelpers";

afterEach(cleanup);

function mkkWorkspace() {
  const workspace = createEmptyWorkspace();
  const collection = createCollection("MKK synthetic");
  collection.openApi = { sourceFormat: "openapi3" };
  const exportControl = createRequest({ name: "Export control", method: "POST", url: "/export-control" });
  const dgsList = createRequest({ name: "DGS list", method: "POST", url: "/ec-dgs-list" });
  for (const request of [exportControl, dgsList]) {
    request.openApi = { sourceFormat: "openapi3", method: "post", path: request.url };
  }
  collection.requests.push(exportControl, dgsList);
  workspace.collections.push(collection);
  return { workspace, collection, exportControl, dgsList };
}

function fixture() {
  const { workspace, collection, exportControl, dgsList } = mkkWorkspace();
  const source = '{"openapi":"3.0.3","paths":{}}'; // The main-side planner is mocked; choose an inline source, never a real endpoint.
  const review: AgentPlanReview = {
    planId: "mock-plan",
    expectedRevision: "mock-revision",
    collection: { name: collection.name },
    intent: { kind: "update-openapi-schema", targetCollectionId: collection.id },
    status: "pending",
    diff: { added: [], changed: ["POST /export-control"], retained: 1, requestCount: 2 },
    warnings: [],
    schemaUpdate: {
      changed: true,
      selectedRequestIds: [exportControl.id],
      affectedRequestIds: [dgsList.id],
      selectedOperations: [{ id: exportControl.id, operation: "POST /export-control" }],
      affectedOperations: [{ id: dgsList.id, operation: "POST /ec-dgs-list" }],
      requiresAcknowledgement: true,
      changes: [{ scope: "components.schemas.Payload", message: "Removed required property requestHeader." }],
      warnings: ["The saved request body still contains a property removed from the updated schema."]
    }
  };
  const api = studioMock(workspace);
  api.previewSchemaUpdate = vi.fn(async () => review);
  return { api, source, review, workspace, collection, exportControl, dgsList };
}

async function openReview({ api, source, collection }: ReturnType<typeof fixture>) {
  const { user } = await renderApp(api);
  await user.click(within(screen.getByRole("navigation", { name: "Primary" })).getByRole("button", { name: "Import" }));
  await user.click(await screen.findByRole("button", { name: "Update schemas and keep request data" }));
  expect(screen.queryByRole("button", { name: "Fetch" })).toBeNull();
  await user.selectOptions(screen.getByRole("combobox", { name: "Existing OpenAPI collection" }), collection.id);
  const input = screen.getByRole("textbox", { name: "Updated OpenAPI document" });
  await user.click(input);
  await user.paste(source);
  await user.click(screen.getByRole("checkbox", { name: /Export control/ }));
  await user.click(screen.getByRole("button", { name: "Preview schema update" }));
  const dialog = await screen.findByRole("dialog", { name: "Review OpenAPI schema update" });
  return { user, reviewUi: within(dialog) };
}

describe("desktop schema update", () => {
  it("previews only selected target requests and requires explicit acknowledgement of additional shared impact", async () => {
    const item = fixture();
    item.api.applyAgentPlan = vi.fn(async () => ({
      workspace: item.workspace, recovered: false, secureStorageAvailable: true, collectionId: item.collection.id
    }));
    const { user, reviewUi } = await openReview(item);
    expect(item.api.previewSchemaUpdate).toHaveBeenCalledWith({
      targetCollectionId: item.collection.id, openApiText: item.source, requestIds: [item.exportControl.id]
    });
    expect(reviewUi.getByText("POST /ec-dgs-list")).toBeTruthy();
    expect(reviewUi.getByText(/Removed required property requestHeader/)).toBeTruthy();
    expect(reviewUi.getByText(/saved request body still contains/)).toBeTruthy();
    const apply = reviewUi.getByRole<HTMLButtonElement>("button", { name: "Apply schema update" });
    expect(apply.disabled).toBe(true);
    expect(item.api.applyAgentPlan).not.toHaveBeenCalled();
    await user.click(reviewUi.getByRole("checkbox", { name: /approve the shared schema changes/ }));
    expect(apply.disabled).toBe(false);
    await user.click(apply);
    expect(item.api.applyAgentPlan).toHaveBeenCalledWith(item.review.planId, item.review.expectedRevision, [item.dgsList.id]);
    expect(item.api.sendRequest).not.toHaveBeenCalled();
    expect(item.api.fetchImportUrl).not.toHaveBeenCalled();
  });

  it("cancels a preview without applying it even after an impact acknowledgement", async () => {
    const item = fixture();
    const { user, reviewUi } = await openReview(item);
    await user.click(reviewUi.getByRole("checkbox", { name: /approve the shared schema changes/ }));
    await user.click(reviewUi.getByRole("button", { name: "Cancel changes" }));
    expect(item.api.rejectAgentPlan).toHaveBeenCalledWith(item.review.planId);
    expect(item.api.applyAgentPlan).not.toHaveBeenCalled();
  });

  it("requires a fresh impact acknowledgement when the workspace revision changes", async () => {
    const item = fixture();
    item.api.applyAgentPlan = vi.fn(async () => { throw new Error("Workspace changed since preview."); });
    item.api.refreshAgentPlan = vi.fn(async () => ({ ...item.review, planId: "new-plan", expectedRevision: "new-revision" }));
    const { user, reviewUi } = await openReview(item);
    await user.click(reviewUi.getByRole("checkbox", { name: /approve the shared schema changes/ }));
    await user.click(reviewUi.getByRole("button", { name: "Apply schema update" }));
    await user.click(await reviewUi.findByRole("button", { name: "Refresh preview" }));
    const refreshed = within(await screen.findByRole("dialog", { name: "Review OpenAPI schema update" }));
    expect(refreshed.getByRole<HTMLInputElement>("checkbox", { name: /approve the shared schema changes/ }).checked).toBe(false);
    expect(refreshed.getByRole<HTMLButtonElement>("button", { name: "Apply schema update" }).disabled).toBe(true);
    expect(item.api.applyAgentPlan).toHaveBeenCalledTimes(1);
  });

  it("keeps keyboard focus in the review, and Escape closes without applying or rejecting", async () => {
    const item = fixture();
    const { user, reviewUi } = await openReview(item);
    const close = reviewUi.getByRole("button", { name: "Close review" });
    const cancel = reviewUi.getByRole("button", { name: "Cancel changes" });
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(item.api.applyAgentPlan).not.toHaveBeenCalled();
    expect(item.api.rejectAgentPlan).not.toHaveBeenCalled();
  });
});
