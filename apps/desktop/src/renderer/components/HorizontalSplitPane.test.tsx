// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HorizontalSplitPane } from "./HorizontalSplitPane";

afterEach(cleanup);

describe("HorizontalSplitPane", () => {
  it("supports keyboard resizing and reset", () => {
    render(<HorizontalSplitPane top={<div>Request</div>} bottom={<div>Response</div>} />);
    const separator = screen.getByRole("separator", {
      name: "Resize request and response panels"
    });
    const container = separator.parentElement as HTMLElement;
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({ top: 0, height: 800 })
    });

    fireEvent.keyDown(separator, { key: "ArrowDown" });
    expect(container.style.getPropertyValue("--split-pane-top-height")).toBe("73%");
    expect(separator.getAttribute("aria-valuenow")).toBe("73");

    fireEvent.doubleClick(separator);
    expect(container.style.getPropertyValue("--split-pane-top-height")).toBe("70%");
  });
});
