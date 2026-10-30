// @vitest-environment jsdom
import React, { StrictMode, useState } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/contracts";
import { studioMock } from "../App.testHelpers";
import { createEmptyWorkspace } from "@openapi-collection-studio/core";
import { useSettingsUpdates } from "./useSettingsUpdates";
afterEach(cleanup);
it("persists each explicit intent once under StrictMode and ignores stale acknowledgements", async () => {
  const api = studioMock(createEmptyWorkspace()); window.studio = api;
  const replies: Array<(value: typeof DEFAULT_SETTINGS) => void> = [];
  vi.mocked(api.saveSettings).mockImplementation(() => new Promise((resolve) => replies.push(resolve)));
  const hook = renderHook(() => { const [settings, setSettings] = useState(DEFAULT_SETTINGS); return { settings, update: useSettingsUpdates(settings, setSettings, vi.fn()) }; }, { wrapper: ({ children }) => <StrictMode>{children}</StrictMode> });
  act(() => { hook.result.current.update({ agentEnabled: true }); hook.result.current.update({ agentNetworkEnabled: true }); hook.result.current.update({ agentNetworkEnabled: false }); });
  expect(api.saveSettings).toHaveBeenCalledTimes(3);
  expect(vi.mocked(api.saveSettings).mock.calls.map(([value]) => [value.agentEnabled, value.agentNetworkEnabled])).toEqual([[true, false], [true, true], [true, false]]);
  await act(async () => replies[2]({ ...DEFAULT_SETTINGS, agentEnabled: true, agentNetworkEnabled: false }));
  await act(async () => { replies[1]({ ...DEFAULT_SETTINGS, agentEnabled: true, agentNetworkEnabled: true }); replies[0]({ ...DEFAULT_SETTINGS, agentEnabled: true, agentNetworkEnabled: false }); });
  await waitFor(() => expect(hook.result.current.settings.agentNetworkEnabled).toBe(false));
});
it("reports a failed save and reloads actual saved permission instead of claiming success", async () => {
  const api = studioMock(createEmptyWorkspace()); window.studio = api; const notice = vi.fn();
  vi.mocked(api.loadSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, agentNetworkEnabled: false });
  vi.mocked(api.saveSettings).mockRejectedValue(new Error("SYNTHETIC_TRANSPORT_DETAIL"));
  const hook = renderHook(() => { const [settings, setSettings] = useState(DEFAULT_SETTINGS); return { settings, update: useSettingsUpdates(settings, setSettings, notice) }; });
  act(() => hook.result.current.update({ agentNetworkEnabled: true }));
  await waitFor(() => expect(api.loadSettings).toHaveBeenCalled());
  await waitFor(() => expect(hook.result.current.settings.agentNetworkEnabled).toBe(false));
  expect(JSON.stringify(notice.mock.calls)).not.toContain("SYNTHETIC_TRANSPORT_DETAIL");
});
