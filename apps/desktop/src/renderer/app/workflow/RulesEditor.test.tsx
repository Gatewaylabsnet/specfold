// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createCollection, createRequest } from "@openapi-collection-studio/core";
import { RulesEditor } from "./RulesEditor";
afterEach(cleanup);
it("requires explicit review for a validated request-specific rule and rejects credential paths", async () => {
  const collection = createCollection("Synthetic API"); collection.requests = [createRequest({ name: "Read", method: "GET", url: "/read" })];
  const onChange = vi.fn(), user = userEvent.setup(); render(<RulesEditor rules={[]} collection={collection} onChange={onChange} />);
  await user.click(screen.getByText("No-code response rules (0)"));
  expect(screen.getByRole("button", { name: "Add reviewed rule" }).hasAttribute("disabled")).toBe(true);
  await user.clear(screen.getByLabelText("Rule JSON pointer")); await user.type(screen.getByLabelText("Rule JSON pointer"), "/access_token");
  await user.click(screen.getByRole("checkbox")); await user.click(screen.getByRole("button", { name: "Add reviewed rule" }));
  expect(onChange).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toBeTruthy();
  await user.clear(screen.getByLabelText("Rule JSON pointer")); await user.type(screen.getByLabelText("Rule JSON pointer"), "/count");
  await user.click(screen.getByRole("checkbox")); await user.click(screen.getByRole("button", { name: "Add reviewed rule" }));
  expect(onChange.mock.calls[0][0][0]).toMatchObject({ requestId: collection.requests[0].id, kind: "exists", path: "/count" });
});
