// @vitest-environment jsdom
import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp, studioMock } from "./App.testHelpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("environment management", () => {
  it("opens the environment manager directly from the top bar", async () => {
    const { user } = await renderApp();

    await user.click(screen.getByRole("button", { name: "Manage environments" }));

    expect(await screen.findByRole("heading", { name: "Connection profiles" })).toBeTruthy();
  });

  it("keeps environment name editing local until the field is committed", async () => {
    const api = studioMock();
    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Manage environments" }));
    const name = await screen.findByRole("textbox", { name: "Environment name" });
    await user.clear(name);
    await user.type(name, "Staging");
    expect(api.saveWorkspace.mock.calls.some(([workspace]) =>
      workspace.environments.some((environment) => environment.name === "Staging")
    )).toBe(false);
    await user.tab();

    await waitFor(() => expect(api.saveWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      environments: [expect.objectContaining({ name: "Staging" })]
    })));
  });

  it("shows deletion progress and resets the workspace after confirmation", async () => {
    const api = studioMock();
    let finishDeletion: (() => void) | undefined;
    api.deleteAllData = vi.fn(() => new Promise<void>((resolve) => {
      finishDeletion = resolve;
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValue("DELETE ALL");
    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Settings" }));

    await user.click(await screen.findByRole("button", { name: "Delete all data" }));
    await waitFor(() => expect(api.deleteAllData).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("button", { name: "Deleting local data..." }) as HTMLButtonElement).disabled).toBe(true);

    finishDeletion?.();
    expect(await screen.findByText(/All local data was deleted/)).toBeTruthy();
  });
});
