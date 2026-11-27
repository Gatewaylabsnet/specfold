// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createCollection, createEmptyWorkspace } from "@openapi-collection-studio/core";
import type { ResponseState } from "../types";
import { RequestAuthFields } from "./RequestAuthFields";
import { ResponsePanel } from "./ResponsePanel";

afterEach(cleanup);

function tokenResponse(token: string): ResponseState {
  const body = JSON.stringify({ access_token: token, token_type: "Bearer", expires_in: 120, echo: token });
  return {
    status: 200, statusText: "OK", durationMs: 1, sizeBytes: body.length, body, rawBody: body,
    headers: { "set-cookie": "private-session-cookie", "content-type": "application/json" },
    collectionTokenCapture: "saved"
  };
}

function props(response: ResponseState) {
  const workspace = createEmptyWorkspace();
  const collection = createCollection("Local API");
  workspace.collections = [collection];
  return {
    response, history: [], tokenIssuer: true,
    environmentVariableNames: [], onAssignResponseValue: vi.fn(), onSaveResponseExample: vi.fn(),
    onBindToken: vi.fn(),
    tokenBindingContext: { workspace, collectionId: collection.id,
      environmentId: workspace.environments[0].id, sourceRequestId: "issuer", secureStorageAvailable: true }
  };
}

it("opens and masks response content before collapsed token controls, including copy and original example actions", async () => {
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, "writeText");
  const original = "SYNTHETIC_OPAQUE_TOKEN";
  const input = props(tokenResponse(original));
  const { container, rerender } = render(<ResponsePanel {...input} />);
  const response = container.querySelector("details.response-body-view") as HTMLDetailsElement;
  const manual = screen.getByText("Use a response field as a token").closest("details")!;
  expect(response.open).toBe(true);
  expect(response.compareDocumentPosition(manual) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(manual.open).toBe(false);
  expect(response.textContent).toContain('"expires_in": 120');
  expect(response.textContent).toContain("[REDACTED]");
  expect(response.textContent).not.toContain(original);
  expect(screen.getByText("Collection token set. Eligible requests use it automatically.")).toBeTruthy();
  expect((screen.getByRole("button", { name: /^Save example$/ }) as HTMLButtonElement).disabled).toBe(true);

  await user.click(screen.getByRole("button", { name: /^Raw$/ }));
  await user.click(screen.getByRole("button", { name: /^Copy$/ }));
  expect(writeText).toHaveBeenLastCalledWith(expect.not.stringContaining(original));
  await user.click(screen.getByRole("button", { name: /^Headers$/ }));
  expect(response.textContent).not.toContain("private-session-cookie");

  await user.click(screen.getByRole("button", { name: /^Reveal sensitive response$/ }));
  expect(response.textContent).toContain("private-session-cookie");
  await user.click(screen.getByRole("button", { name: /^Body$/ }));
  expect(response.textContent).toContain(original);
  await user.click(screen.getByRole("button", { name: /^Save example$/ }));
  expect(input.onSaveResponseExample).toHaveBeenCalledWith(input.response);
  response.open = false;
  const fresh = "SYNTHETIC_FRESH_TOKEN";
  rerender(<ResponsePanel {...input} response={tokenResponse(fresh)} />);
  await waitFor(() => expect(response.open).toBe(true));
  expect(response.textContent).not.toContain(fresh);
  expect((screen.getByRole("button", { name: /^Save example$/ }) as HTMLButtonElement).disabled).toBe(true);
});

it("keeps opaque or malformed issuer response bodies hidden until intentionally revealed", () => {
  const opaque = "PLAINTEXT_UNSTRUCTURED_TOKEN";
  const input = props({ ...tokenResponse(opaque), rawBody: opaque, body: opaque });
  const { container } = render(<ResponsePanel {...input} />);
  expect(container.querySelector("pre")?.textContent).toContain("response hidden");
  expect(container.textContent).not.toContain(opaque);
  fireEvent.click(screen.getByRole("button", { name: /^Reveal sensitive response$/ }));
  expect(container.querySelector("pre")?.textContent).toBe(opaque);
});

it("keeps actionable missing variable names visible for a request that was not sent", () => {
  render(<ResponsePanel {...props({ status: 0, statusText: "Missing variables", durationMs: 0, sizeBytes: 0,
    body: "", rawBody: "", headers: {}, error: "Missing environment variables: userName, apiPassword" })} />);
  expect(screen.getByRole("alert").textContent).toContain("Missing environment variables: userName, apiPassword");
});

it("names the inherited secret variable, not its value, and lets the operator turn off collection capture", () => {
  const onChange = vi.fn();
  render(<RequestAuthFields auth={{ type: "none" }} onChange={vi.fn()} onFolderTokenVariableChange={vi.fn()}
    collectionTokenVariable="localCollectionToken" collectionTokenSettings={{ enabled: true, onChange }} />);
  expect(screen.getByText("localCollectionToken", { exact: true })).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "Capture and use the collection token automatically" }));
  expect(onChange).toHaveBeenCalledWith(false);
});
