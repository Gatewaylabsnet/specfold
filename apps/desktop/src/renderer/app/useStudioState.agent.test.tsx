// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "@openapi-collection-studio/core";
import { studioMock } from "../App.testHelpers";
import type { AgentEvent, AgentTokenCapture } from "../../shared/contracts";
import { useStudioState } from "./useStudioState";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function fixture() {
  const workspace = createEmptyWorkspace("Original");
  const previous = { id: "token", name: "apinizerAuthAccessToken", value: "SYNTHETIC_OLD", enabled: true, secret: true };
  workspace.environments[0].variables.push(previous);
  const api = studioMock(workspace);
  const listeners = new Set<(event: AgentEvent) => void>();
  let flush = async () => undefined as void;
  api.onAgentEvent = (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  api.onAgentFlush = (listener) => { flush = listener; return () => undefined; };
  window.studio = api;
  const view = renderHook(() => useStudioState());
  await act(async () => undefined);
  await act(() => vi.advanceTimersByTimeAsync(350));
  vi.mocked(api.saveWorkspace).mockClear();
  const capture: AgentTokenCapture = { kind: "token-captured", workspaceId: workspace.id,
    environmentId: workspace.environments[0].id, previous: { ...previous }, value: "SYNTHETIC_NEW", generation: 1 };
  return { api, view, capture, emit: (event: AgentEvent) => act(() => { for (const listener of listeners) listener(event); }),
    emitAndFlush: (event: AgentEvent) => { for (const listener of listeners) listener(event); return flush(); } };
}

it("rebases the captured token onto unsaved edits and saves with the new generation", async () => {
  const { api, view, capture, emit } = await fixture();
  act(() => view.result.current.mutateWorkspace((workspace) => { workspace.name = "Pending edit"; }));
  emit(capture);
  await act(() => vi.advanceTimersByTimeAsync(350));
  expect(api.saveWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Pending edit",
    environments: [expect.objectContaining({ variables: [expect.objectContaining({ value: "SYNTHETIC_NEW" })] })] }), 1);
  expect(view.result.current.saveStatus).toBe("saved");
});

it.each(["value", "remove"])("preserves a pending manual token %s change", async (change) => {
  const { api, view, capture, emit } = await fixture();
  act(() => view.result.current.mutateWorkspace((workspace) => {
    if (change === "remove") workspace.environments[0].variables = [];
    else workspace.environments[0].variables[0].value = "SYNTHETIC_MANUAL";
  }));
  emit(capture);
  await act(() => vi.advanceTimersByTimeAsync(350));
  const saved = vi.mocked(api.saveWorkspace).mock.lastCall!;
  expect(saved[1]).toBe(1);
  expect(saved[0].environments[0].variables.map((item) => item.value)).toEqual(change === "remove" ? [] : ["SYNTHETIC_MANUAL"]);
});

it("ignores stale captures and captures for a replaced workspace", async () => {
  const { api, view, capture, emit } = await fixture();
  emit({ ...capture, workspaceId: "another-workspace" });
  emit({ ...capture, generation: 0 });
  await act(() => vi.advanceTimersByTimeAsync(350));
  expect(api.saveWorkspace).not.toHaveBeenCalled();
  expect(view.result.current.workspace.environments[0].variables[0].value).toBe("SYNTHETIC_OLD");
});

it("does not let a late old-generation save rejection undo the token rebase", async () => {
  const { api, view, capture, emit } = await fixture();
  let rejectOld!: (reason: Error) => void;
  vi.mocked(api.saveWorkspace).mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOld = reject; }));
  act(() => view.result.current.mutateWorkspace((workspace) => { workspace.name = "Already saving edit"; }));
  await act(() => vi.advanceTimersByTimeAsync(350));
  emit(capture);
  await act(async () => rejectOld(new Error("WORKSPACE_CHANGED")));
  await act(() => vi.advanceTimersByTimeAsync(350));
  expect(api.saveWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Already saving edit",
    environments: [expect.objectContaining({ variables: [expect.objectContaining({ value: "SYNTHETIC_NEW" })] })] }), 1);
  expect(view.result.current.saveStatus).toBe("saved");
});

it("flushes the captured token even before React commits the token event render", async () => {
  const { api, view, capture, emitAndFlush } = await fixture();
  act(() => view.result.current.mutateWorkspace((workspace) => { workspace.name = "Immediate flush edit"; }));
  await act(async () => { await emitAndFlush(capture); });
  expect(api.saveWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Immediate flush edit",
    environments: [expect.objectContaining({ variables: [expect.objectContaining({ value: "SYNTHETIC_NEW" })] })] }), 1);
});

it("preserves a manual revert after a captured token has rendered", async () => {
  const { api, view, capture, emit } = await fixture();
  emit(capture);
  act(() => view.result.current.mutateWorkspace((workspace) => {
    workspace.environments[0].variables[0].value = capture.previous.value;
  }));
  await act(async () => { await view.result.current.saveWorkspaceNow(); });
  expect(api.saveWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({
    environments: [expect.objectContaining({ variables: [expect.objectContaining({ value: "SYNTHETIC_OLD" })] })] }), 1);
});
