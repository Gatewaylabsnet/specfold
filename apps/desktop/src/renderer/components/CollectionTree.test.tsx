// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCollection, createFolder, createRequest } from "@openapi-collection-studio/core";
import { CollectionTree } from "./CollectionTree";

afterEach(cleanup);

describe("collection tree", () => {
  it("collapses nested folders independently and reveals matches while searching", async () => {
    const collection = createCollection("Hierarchy API");
    const accounts = createFolder("Accounts");
    const orders = createFolder("Orders");
    accounts.requests.push(createRequest({ name: "Find account", method: "GET", url: "/accounts/{id}" }));
    orders.requests.push(createRequest({ name: "Find order", method: "GET", url: "/orders/{id}" }));
    accounts.folders.push(orders);
    collection.folders.push(accounts);
    const noop = vi.fn();
    const onSelectFolder = vi.fn();
    const user = userEvent.setup();

    render(<CollectionTree
      activeCollectionId={collection.id}
      collections={[collection]}
      onDeleteCollection={noop}
      onDeleteFolder={noop}
      onDeleteRequest={noop}
      onDuplicateFolder={noop}
      onDuplicateRequest={noop}
      onMoveFolderTo={noop}
      onMoveRequestTo={noop}
      onRenameCollection={noop}
      onRenameFolder={noop}
      onRenameRequest={noop}
      onToggleRequestFavorite={noop}
      onSelectCollection={noop}
      onSelectFolder={onSelectFolder}
      onSelectRequest={noop}
    />);

    const accountsButton = screen.getByRole("button", { name: /^Accounts/ });
    const collapseAccounts = screen.getByRole("button", { name: "Collapse Accounts" });
    expect(collapseAccounts.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Find account")).toBeTruthy();
    expect(screen.getByText("Find order")).toBeTruthy();

    await user.click(collapseAccounts);
    expect(screen.getByRole("button", { name: "Expand Accounts" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Find account")).toBeNull();
    expect(screen.queryByText("Find order")).toBeNull();

    await user.type(screen.getByRole("textbox", { name: "Search requests" }), "order");
    expect(screen.getByText("Find order")).toBeTruthy();
    await user.clear(screen.getByRole("textbox", { name: "Search requests" }));
    expect(screen.queryByText("Find order")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Expand Accounts" }));
    await user.click(screen.getByRole("button", { name: "Collapse Orders" }));
    expect(screen.getByText("Find account")).toBeTruthy();
    expect(screen.queryByText("Find order")).toBeNull();

    await user.click(accountsButton);
    expect(onSelectFolder).toHaveBeenCalledWith(accounts.id);
  });

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
      onToggleRequestFavorite={noop}
      onSelectCollection={onSelectCollection}
      onSelectFolder={noop}
      onSelectRequest={noop}
    />);

    await user.click(screen.getByRole("button", { name: "First API" }));
    expect(onSelectCollection).toHaveBeenCalledWith(first.id);
    await user.type(screen.getByRole("textbox", { name: "Search requests" }), "account");
    expect(screen.getByText("Find account")).toBeTruthy();
    await user.clear(screen.getByRole("textbox", { name: "Search requests" }));
    await user.dblClick(screen.getByRole("button", { name: "Second API" }));
    const renameInput = screen.getByDisplayValue("Second API");
    await user.clear(renameInput);
    await user.type(renameInput, "Renamed API{Enter}");
    expect(onRenameCollection).toHaveBeenCalledWith(second.id, "Renamed API");
  });
});
