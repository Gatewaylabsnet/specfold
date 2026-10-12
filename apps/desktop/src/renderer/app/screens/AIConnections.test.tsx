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
  const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "Preview documentation draft" }));
  await screen.findByLabelText("Documentation draft");
  await user.click(screen.getByRole("button", { name: "Export documentation draft" }));
  expect(api.exportAgentDocumentation).toHaveBeenCalledWith(collection.id);
});
