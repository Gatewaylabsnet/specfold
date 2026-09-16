// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCollection,
  createEmptyWorkspace,
  createFolder,
  createRequest
} from "@openapi-collection-studio/core";
import { renderApp, studioMock } from "./App.testHelpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("renderer folder actions", () => {
  it("can delete a newly added selected folder from the editor panel", async () => {
    const api = studioMock();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = await renderApp(api);
    vi.mocked(api.saveWorkspace).mockClear();

    await user.click(screen.getByRole("button", { name: "New" }));
    await user.click(screen.getByRole("menuitem", { name: "Folder" }));

    expect(await screen.findByRole("heading", { name: "New Folder" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete folder" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Delete folder "New Folder"'));
    await waitFor(() => {
      const savedWorkspaces = vi.mocked(api.saveWorkspace).mock.calls.map(([saved]) => saved);
      expect(savedWorkspaces.some((saved) => saved.collections[0]?.folders.length === 0)).toBe(true);
    });
    expect(screen.queryByRole("heading", { name: "New Folder" })).toBeNull();
  });

  it("switches active collection when a searched folder is selected", async () => {
    const workspace = createEmptyWorkspace("Multi collection workspace");
    const first = createCollection("First API");
    first.requests.push(createRequest({ name: "First root", method: "GET", url: "/first" }));
    const second = createCollection("Second API");
    const secondFolder = createFolder("Second Folder");
    second.folders.push(secondFolder);
    workspace.collections.push(first, second);
    const api = studioMock(workspace);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = await renderApp(api);
    vi.mocked(api.saveWorkspace).mockClear();

    await user.type(screen.getByRole("textbox", { name: "Search requests" }), "Second Folder");
    await user.click(screen.getByRole("button", { name: /^Second Folder/ }));

    expect(await screen.findByRole("heading", { name: "Second Folder" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete folder" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Delete folder "Second Folder"'));
    await waitFor(() => {
      const savedWorkspaces = vi.mocked(api.saveWorkspace).mock.calls.map(([saved]) => saved);
      expect(savedWorkspaces.some((saved) =>
        saved.collections[0]?.name === "First API" &&
        saved.collections[0]?.requests.length === 1 &&
        saved.collections[1]?.name === "Second API" &&
        saved.collections[1]?.folders.length === 0
      )).toBe(true);
    });
  });
});
