import { useEffect, useRef } from "react";
import type { Workspace } from "@openapi-collection-studio/core";
import type { StudioState } from "./useStudioState";
import type { TokenBindingReview } from "./responseTokenBinding";

export function useResponseTokenController(state: StudioState) {
  const { workspace, setWorkspace, secureStorageAvailable, setSaveStatus, setNotice } = state;
  const pending = useRef<{ next: Workspace; original: Workspace; count: number }>();
  useEffect(() => {
    const result = pending.current;
    if (!result || workspace === result.original) return;
    pending.current = undefined;
    if (workspace === result.next) {
      setSaveStatus("dirty"); setNotice(`Token ready for ${result.count} selected requests. Saving securely.`);
    } else setNotice("The workspace changed. Review the token binding again.");
  }, [workspace, setSaveStatus, setNotice]);
  function bindResponseToken(review: TokenBindingReview) {
    if (!secureStorageAvailable) { setNotice("OS secure storage is required before saving a token."); return; }
    if (!review.matches(workspace)) { setNotice("The workspace changed. Review the token binding again."); return; }
    const next = review.apply(workspace);
    pending.current = { next, original: workspace, count: review.rows.length };
    setWorkspace((current) => current === workspace ? next : current);
  }
  return { bindResponseToken };
}
