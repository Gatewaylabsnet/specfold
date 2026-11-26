// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentPlanReview } from "../../shared/contracts";
import { AgentReviewDialog } from "./AgentReviewDialog";

afterEach(cleanup);

function reviewFixture(changed: boolean): AgentPlanReview {
  return {
    planId: "mock-plan", expectedRevision: "mock-revision", status: "pending",
    collection: { name: "Synthetic" }, intent: { kind: "update-request", collectionId: "synthetic" },
    diff: { added: [], changed: ["POST /export-control"], retained: 1, requestCount: 2 }, warnings: [],
    requestUpdate: { changed: true, requests: [{ requestId: "selected", operation: "POST /export-control",
      changes: [{ scope: "Body JSON", message: "Remove value at /requestHeader." },
        { scope: "HTTP header Content-Type", message: "Replaced saved header value." }], warnings: [] }] },
    schemaUpdate: { changed, selectedRequestIds: ["selected"], affectedRequestIds: changed ? ["other"] : [],
      selectedOperations: [{ id: "selected", operation: "POST /export-control" }],
      affectedOperations: changed ? [{ id: "other", operation: "POST /ec-dgs-list" }] : [],
      requiresAcknowledgement: changed, changes: [], warnings: [] }
  };
}

describe("request edit review", () => {
  it("separates body/header changes from source schema impact and passes the exact shared acknowledgement", () => {
    const onApply = vi.fn();
    const review = reviewFixture(true);
    render(<AgentReviewDialog review={review} busy={false} error="" onApply={onApply}
      onReject={vi.fn()} onRefresh={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Remove value at /requestHeader.", { exact: false })).toBeTruthy();
    expect(screen.getByText("HTTP header Content-Type:", { exact: true })).toBeTruthy();
    const apply = screen.getByRole("button", { name: "Apply request and schema updates" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /approve the shared schema/ }));
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith(["other"]);
  });

  it("permits an independent request edit with a no-op schema but disables apply after the revision becomes stale", () => {
    const review = reviewFixture(false);
    const props = { busy: false, error: "", onApply: vi.fn(), onReject: vi.fn(), onRefresh: vi.fn(), onClose: vi.fn() };
    const { rerender } = render(<AgentReviewDialog review={review} {...props} />);
    const apply = screen.getByRole("button", { name: "Apply request and schema updates" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    rerender(<AgentReviewDialog review={{ ...review, status: "stale" }} {...props} />);
    expect(apply.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("fresh preview using the new revision");
    expect(screen.queryByRole("button", { name: "Refresh preview" })).toBeNull();
  });
});
