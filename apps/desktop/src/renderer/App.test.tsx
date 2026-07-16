// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCollection,
  createEmptyWorkspace,
  createRequest,
  type Workspace
} from "@openapi-collection-studio/core";
import type { StudioApi } from "../shared/contracts";
import { App } from "./App";
import { CollectionTree } from "./components/CollectionTree";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function sampleWorkspace(): Workspace {
  const workspace = createEmptyWorkspace("Test workspace");
  const collection = createCollection("Demo API");
  collection.requests.push(createRequest({ name: "List users", method: "GET", url: "/users" }));
  workspace.collections.push(collection);
  return workspace;
}

function studioMock(workspace = sampleWorkspace()): StudioApi {
  return {
    loadWorkspace: vi.fn(async () => ({ workspace, recovered: false, secureStorageAvailable: true })),
    saveWorkspace: vi.fn(async () => undefined),
    loadSettings: vi.fn(async () => ({
      requestTimeoutMs: 30_000,
      maxResponseBytes: 10 * 1024 * 1024,
      allowInsecureTls: false
    })),
    saveSettings: vi.fn(async (settings) => settings),
    sendRequest: vi.fn(async () => ({
      status: 200,
      statusText: "OK",
      durationMs: 1,
      sizeBytes: 2,
      headers: {},
      body: "{}",
      rawBody: "{}"
    })),
    saveExportFile: vi.fn(async () => ({ canceled: true })),
    openImportFile: vi.fn(async () => ({ canceled: true })),
    openPostmanFolder: vi.fn(async () => ({ canceled: true })),
    exportBackup: vi.fn(async () => ({ canceled: true })),
    restoreBackup: vi.fn(async () => ({ canceled: true, restored: false, secureStorageAvailable: true })),
    deleteAllData: vi.fn(async () => undefined),
    fetchImportUrl: vi.fn(async () => ({ ok: false, error: "offline" }))
  };
}

async function renderApp(api = studioMock()) {
  window.studio = api;
  render(<App />);
  await screen.findByRole("navigation", { name: "Primary" });
  return { api, user: userEvent.setup() };
}

describe("renderer workflows", () => {
  it("shows every supported import source choice", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.getByRole("button", { name: "Open file" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Postman v3 folder" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Import from URL" })).toBeTruthy();
    expect(screen.getByPlaceholderText(/Paste OpenAPI 3.x/)).toBeTruthy();
  });

  it("requires confirmation before backup export and restore", async () => {
    const api = studioMock();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Settings" }));

    await user.click(screen.getByRole("button", { name: "Export backup" }));
    expect(api.exportBackup).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Export backup" }));
    await waitFor(() => expect(api.exportBackup).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Restore backup" }));
    await waitFor(() => expect(api.restoreBackup).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it("does not allow the last environment to be deleted", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Environments" }));
    const deleteButton = screen.getByTitle("At least one environment is required") as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
  });
});

describe("collection tree", () => {
  it("supports selection, search, and inline rename", async () => {
    const first = createCollection("First API");
    first.requests.push(createRequest({ name: "Find account", method: "GET", url: "/account" }));
    const second = createCollection("Second API");
    const onSelectCollection = vi.fn();
    const onRenameCollection = vi.fn();
    const noop = vi.fn();
    const user = userEvent.setup();
    render(<CollectionTree
      collections={[first, second]}
      onDeleteCollection={noop}
      onDeleteFolder={noop}
      onDeleteRequest={noop}
      onDuplicateFolder={noop}
      onDuplicateRequest={noop}
      onMoveFolderTo={noop}
      onMoveRequestTo={noop}
      onRenameCollection={onRenameCollection}
      onRenameFolder={noop}
      onRenameRequest={noop}
      onSelectCollection={onSelectCollection}
      onSelectFolder={noop}
      onSelectRequest={noop}
    />);

    await user.click(screen.getByRole("button", { name: /First API/ }));
    expect(onSelectCollection).toHaveBeenCalledWith(first.id);
    await user.type(screen.getByRole("textbox", { name: "Search requests" }), "account");
    expect(screen.getByText("Find account")).toBeTruthy();
    await user.clear(screen.getByRole("textbox", { name: "Search requests" }));
    await user.dblClick(screen.getByRole("button", { name: /Second API/ }));
    const renameInput = screen.getByDisplayValue("Second API");
    await user.clear(renameInput);
    await user.type(renameInput, "Renamed API{Enter}");
    expect(onRenameCollection).toHaveBeenCalledWith(second.id, "Renamed API");
  });
});
