// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createCollection, createEmptyWorkspace, createFolder, createRequest } from "@openapi-collection-studio/core";
import { ResponseTokenBinding, type TokenBindingContext } from "./ResponseTokenBinding";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function fixture() {
  const workspace = createEmptyWorkspace(), collection = createCollection("Demo API"), folder = createFolder("Orders");
  const issuer = createRequest({ name: "Issuer", method: "POST", url: "/auth/jwt" });
  const request = createRequest({ name: "List orders", method: "GET", url: "/orders" });
  collection.requests = [issuer]; folder.requests = [request]; collection.folders = [folder]; workspace.collections.push(collection);
  const context: TokenBindingContext = { workspace, collectionId: collection.id, environmentId: workspace.environments[0].id,
    sourceRequestId: issuer.id, secureStorageAvailable: true };
  return { workspace, collection, folder, request, context, body: '{"access_token":"SYNTHETIC_UI_SECRET"}' };
}
it("requires a reviewed scope and explicit confirmation without rendering the token value", async () => {
  const f = fixture(), onApply = vi.fn(), user = userEvent.setup();
  render(<ResponseTokenBinding body={f.body} context={f.context} onApply={onApply} />);
  expect(document.body.textContent?.includes("SYNTHETIC_UI_SECRET")).toBe(false);
  await user.selectOptions(screen.getByLabelText("Token scope"), f.folder.id);
  await user.click(screen.getByRole("button", { name: "Review token use" }));
  expect(await screen.findByRole("dialog", { name: "Confirm token use" })).toBeTruthy();
  expect(onApply).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel token use" }));
  expect(onApply).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Review token use" }));
  await user.click(screen.getByRole("button", { name: "Save token and bind 1 requests" }));
  expect(onApply).toHaveBeenCalledTimes(1);
  const review = onApply.mock.calls[0][0];
  expect(review.rows[0].id).toBe(f.request.id);
  expect(JSON.stringify(review).includes("SYNTHETIC_UI_SECRET")).toBe(false);
});
it("invalidates an open confirmation when the workspace changes", async () => {
  const f = fixture(), onApply = vi.fn(), user = userEvent.setup();
  const view = render(<ResponseTokenBinding body={f.body} context={f.context} onApply={onApply} />);
  await user.click(screen.getByRole("button", { name: "Review token use" }));
  await screen.findByRole("dialog");
  view.rerender(<ResponseTokenBinding body={f.body} context={{ ...f.context, workspace: structuredClone(f.workspace) }} onApply={onApply} />);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(onApply).not.toHaveBeenCalled();
});
it("blocks token persistence when OS secure storage is unavailable", () => {
  const f = fixture(); render(<ResponseTokenBinding body={f.body} context={{ ...f.context, secureStorageAvailable: false }} onApply={vi.fn()} />);
  expect((screen.getByRole("button", { name: "Review token use" }) as HTMLButtonElement).disabled).toBe(true);
});
