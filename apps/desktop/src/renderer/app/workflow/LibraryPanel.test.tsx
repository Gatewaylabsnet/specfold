// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyWorkspace, type WorkflowRunReport, type WorkflowTestPlan } from "@openapi-collection-studio/core";
import { studioMock } from "../../App.testHelpers";
import type { SafeRunSummary } from "../../../shared/workflowLibrary";
import { LibraryPanel } from "./LibraryPanel";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("saves only after explicit actions, opens a fresh preview and never runs a scenario itself", async () => {
  const api = studioMock(createEmptyWorkspace()); window.studio = api;
  vi.mocked(api.getWorkflowLibrary).mockResolvedValue({ scenarios: [{ id: "scenario", workspace: "workspace", profile: "setup", requests: ["request"], createdAt: "2026-10-30T10:00:00.000Z" }], runs: [] });
  const user = userEvent.setup(), onOpen = vi.fn(async () => undefined);
  const plan = { id: "new-preview", rows: [{ selected: true, status: "ready" }] } as WorkflowTestPlan;
  const report = { id: "memory-report" } as WorkflowRunReport;
  render(<LibraryPanel profileId="setup" plan={plan} report={report} busy={false} onOpen={onOpen} />);
  await user.click(screen.getByText("Saved scenarios & safe history"));
  await screen.findByRole("button", { name: "Preview scenario 1" });
  expect(api.saveWorkflowSummary).not.toHaveBeenCalled(); expect(api.saveWorkflowScenario).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save selected scenario" }));
  expect(api.saveWorkflowScenario).toHaveBeenCalledWith("new-preview");
  await user.click(screen.getByRole("button", { name: "Preview scenario 1" }));
  expect(onOpen).toHaveBeenCalledWith("scenario"); expect(api.runWorkflowPlan).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save safe summary" }));
  expect(api.saveWorkflowSummary).toHaveBeenCalledWith("memory-report");
});
it("compares stored outcomes and states the limits of matching request identities", async () => {
  const api = studioMock(createEmptyWorkspace()); window.studio = api;
  const before: SafeRunSummary = { id: "earlier", workspace: "w", profile: "p", status: "completed", startedAt: "2026-10-30T10:00:00.000Z", completedAt: "2026-10-30T10:00:01.000Z",
    totals: { passed: 1, failed: 0, skipped: 0, blocked: 0 }, results: [{ request: "r", status: "passed", httpStatus: 200, durationMs: 10, assertions: [] }] };
  const after = { ...before, id: "latest", results: [{ ...before.results[0], status: "failed" as const, httpStatus: 500, durationMs: 20 }] };
  vi.mocked(api.getWorkflowLibrary).mockResolvedValue({ scenarios: [], runs: [before, after] });
  const user = userEvent.setup(); render(<LibraryPanel profileId="setup" busy={false} onOpen={vi.fn()} />);
  await user.click(screen.getByText("Saved scenarios & safe history"));
  await user.selectOptions(await screen.findByLabelText("History baseline"), "earlier");
  expect(screen.getByRole("table").textContent).toContain("passed → failed");
  expect(screen.getByRole("table").textContent).toContain("10 ms");
  expect(screen.getByText(/do not prove identical inputs/)).toBeTruthy();
  expect(api.runWorkflowPlan).not.toHaveBeenCalled();
});
