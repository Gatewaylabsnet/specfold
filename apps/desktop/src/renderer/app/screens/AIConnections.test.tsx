// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createCollection, createEmptyWorkspace } from "@openapi-collection-studio/core";
import { DEFAULT_SETTINGS } from "../../../shared/contracts";
import { studioMock } from "../../App.testHelpers";
import { AIConnections } from "./AIConnections";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("keeps optional configuration and network controls hidden by default", async () => {
  window.studio = studioMock(); const onChange = vi.fn();
  render(<AIConnections settings={DEFAULT_SETTINGS} onChange={onChange} />);
  expect(screen.queryByRole("button", { name: "Copy configuration" })).toBeNull();
  expect(screen.queryByLabelText("Allow agents to send requests and read masked responses")).toBeNull();
  await userEvent.setup().click(screen.getByLabelText("Enable AI connections"));
  expect(onChange).toHaveBeenCalledWith({ agentEnabled: true });
});
it("copies a usable runtime environment in JSON and Codex formats", async () => {
  window.studio = studioMock();
  const user = userEvent.setup();
  render(<AIConnections settings={{ ...DEFAULT_SETTINGS, agentEnabled: true }} onChange={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Copy configuration" }).hasAttribute("disabled")).toBe(false));
  await user.click(screen.getByRole("button", { name: "Copy configuration" }));
  const json = await navigator.clipboard.readText(); expect(JSON.parse(json).mcpServers.specfold.command).toBe("Specfold.exe");
  await user.selectOptions(screen.getByLabelText("AI client configuration"), "codex");
  await user.click(screen.getByRole("button", { name: "Copy configuration" }));
  expect(await navigator.clipboard.readText()).toContain('env = { ELECTRON_RUN_AS_NODE = "1" }');
  expect(await navigator.clipboard.readText()).toContain("[mcp_servers.specfold]");
});
it("requires a visible documentation preview before export", async () => {
  const workspace = createEmptyWorkspace(); const collection = createCollection("Sample"); workspace.collections.push(collection);
  const api = studioMock(workspace); window.studio = api;
  render(<AIConnections settings={{ ...DEFAULT_SETTINGS, agentEnabled: true }} workspace={workspace} onChange={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Export documentation draft" })).toBeNull();
  const user = userEvent.setup(); await user.click(screen.getByText("Advanced: draft documentation from observed responses"));
  await user.click(screen.getByRole("button", { name: "Preview documentation draft" }));
  await screen.findByLabelText("Documentation draft");
  await user.click(screen.getByRole("button", { name: "Export documentation draft" }));
  expect(api.exportAgentDocumentation).toHaveBeenCalledWith(collection.id);
});
it("keeps helper self-test evidence distinct from an unverified external client", async () => {
  const api = studioMock(); window.studio = api;
  api.testAgentConnection = vi.fn().mockResolvedValue({ ok: true, message: "A client connected" });
  render(<AIConnections settings={{ ...DEFAULT_SETTINGS, agentEnabled: true }} onChange={vi.fn()} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Test bundled helper" }));
  expect(await screen.findByText("Bundled helper self-test passed. This does not verify your external client.")).toBeTruthy();
  expect(screen.getByText(/External client: not verified by this self-test/)).toBeTruthy();
  expect(screen.queryByText("A client connected")).toBeNull();
  expect(screen.getByText("List my collections. Do not change data or send API requests.")).toBeTruthy();
});
it("does not present a failed helper result as successful", async () => {
  const api = studioMock(); window.studio = api;
  api.testAgentConnection = vi.fn().mockResolvedValue({ ok: false, message: "Connected" });
  render(<AIConnections settings={{ ...DEFAULT_SETTINGS, agentEnabled: true }} onChange={vi.fn()} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Test bundled helper" }));
  expect(await screen.findByText(/Bundled helper self-test failed/)).toBeTruthy();
  expect(screen.queryByText(/self-test passed/)).toBeNull();
});
it("clears a previous success if a subsequent self-test throws, without rendering transport details", async () => {
  const api = studioMock(); window.studio = api;
  api.testAgentConnection = vi.fn().mockResolvedValueOnce({ ok: true, message: "ok" }).mockRejectedValueOnce(new Error("SYNTHETIC_TRANSPORT_DETAIL"));
  const user = userEvent.setup(); render(<AIConnections settings={{ ...DEFAULT_SETTINGS, agentEnabled: true }} onChange={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Test bundled helper" }));
  await screen.findByText(/self-test passed/);
  await user.click(screen.getByRole("button", { name: "Test bundled helper" }));
  await screen.findByText("Bundled helper self-test failed. Keep Specfold open and retry.");
  expect(screen.getByText(/Last bundled helper test: failed/)).toBeTruthy();
  expect(document.body.textContent?.includes("SYNTHETIC_TRANSPORT_DETAIL")).toBe(false);
});
