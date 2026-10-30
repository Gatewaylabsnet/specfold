// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createCollection, createRequest } from "@openapi-collection-studio/core";
import { SyntheticDataPanel } from "./SyntheticDataPanel";
afterEach(cleanup);
function fixture() {
  const collection = createCollection("Synthetic API"), request = createRequest({ name: "Create item", method: "POST", url: "/items" });
  request.openApi = { rawOperation: { requestBody: { content: { "application/json": { schema: { type: "object", properties: { count: { type: "integer", minimum: 1 } } } } } } } };
  request.body = { mode: "json", raw: "EXISTING_PRIVATE_BODY", contentType: "application/json" };
  return { collection, request, onApply: vi.fn(), user: userEvent.setup() };
}
it("requires draft review and explicit apply, preserves source evidence and never sends", async () => {
  const f = fixture(); render(<SyntheticDataPanel {...f} />);
  await f.user.click(screen.getByText("Synthetic JSON test data"));
  await f.user.click(screen.getByRole("button", { name: "Generate synthetic draft" }));
  expect(f.onApply).not.toHaveBeenCalled(); expect(f.request.body.raw).toBe("EXISTING_PRIVATE_BODY");
  expect(screen.getByRole("button", { name: "Apply reviewed synthetic body" }).hasAttribute("disabled")).toBe(true);
  await f.user.click(screen.getByRole("checkbox"));
  await f.user.click(screen.getByRole("button", { name: "Apply reviewed synthetic body" }));
  expect(f.onApply).toHaveBeenCalledTimes(1); expect(JSON.parse(f.onApply.mock.calls[0][0].raw).count).toBeGreaterThanOrEqual(1);
  expect(JSON.stringify(f.request.openApi)).not.toContain("example");
});
it("discards without changing data and invalidates drafts after edits", async () => {
  const f = fixture(), view = render(<SyntheticDataPanel {...f} />);
  await f.user.click(screen.getByText("Synthetic JSON test data"));
  await f.user.click(screen.getByRole("button", { name: "Generate synthetic draft" }));
  await f.user.click(screen.getByRole("button", { name: "Discard synthetic draft" }));
  expect(f.onApply).not.toHaveBeenCalled();
  await f.user.click(screen.getByRole("button", { name: "Generate synthetic draft" }));
  view.rerender(<SyntheticDataPanel {...f} request={{ ...f.request, body: { ...f.request.body, raw: "{}" } }} />);
  expect(screen.queryByRole("button", { name: "Apply reviewed synthetic body" })).toBeNull();
  expect(f.onApply).not.toHaveBeenCalled();
});
