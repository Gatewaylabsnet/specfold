// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponsePanel } from "./ResponsePanel";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ResponsePanel text size", () => {
  it("changes and persists the response text size independently", async () => {
    const user = userEvent.setup();
    render(
      <ResponsePanel
        environmentVariableNames={[]}
        history={[]}
        onAssignResponseValue={vi.fn()}
        onSaveResponseExample={vi.fn()}
        response={{
          status: 200,
          statusText: "OK",
          durationMs: 12,
          sizeBytes: 18,
          headers: {},
          body: "{\n  \"ok\": true\n}",
          rawBody: "{\"ok\":true}"
        }}
      />
    );

    const responseText = screen.getByText(/"ok": true/);
    expect(responseText.style.fontSize).toBe("12px");

    await user.click(screen.getByRole("button", { name: "Increase response text size" }));
    expect(responseText.style.fontSize).toBe("14px");
    expect(localStorage.getItem("specfold.responseFontSize")).toBe("14");

    await user.click(screen.getByRole("button", { name: "Decrease response text size" }));
    expect(responseText.style.fontSize).toBe("12px");
  });
});
