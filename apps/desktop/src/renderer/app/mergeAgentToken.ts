import type { Workspace } from "@openapi-collection-studio/core";
import type { AgentTokenCapture } from "../../shared/contracts";

/** Rebase only the captured variable onto current editor state, preserving user edits. */
export function mergeAgentToken(workspace: Workspace, capture: AgentTokenCapture): Workspace {
  const next = structuredClone(workspace);
  const variable = next.environments.find((item) => item.id === capture.environmentId)?.variables
    .find((item) => item.id === capture.previous.id);
  const previous = capture.previous;
  // A newer manual edit/removal wins over the HTTP response, including a token edit.
  if (variable && variable.name === previous.name && variable.value === previous.value &&
      variable.enabled === previous.enabled && variable.secret === previous.secret) {
    variable.value = capture.value;
    variable.secret = true;
  }
  return next;
}
