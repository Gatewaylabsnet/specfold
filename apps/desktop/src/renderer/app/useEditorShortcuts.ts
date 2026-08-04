import { useEffect } from "react";
import type { SaveStatus } from "./types";

export function useEditorShortcuts(onFocusSearch: () => void) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        onFocusSearch();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onFocusSearch]);
}

export function useUnsavedExitWarning(saveStatus: SaveStatus) {
  useEffect(() => {
    const warnBeforeExit = (event: BeforeUnloadEvent) => {
      if (saveStatus === "saved") return;
      event.preventDefault();
      event.returnValue = "Specfold still has unsaved changes.";
    };
    window.addEventListener("beforeunload", warnBeforeExit);
    return () => window.removeEventListener("beforeunload", warnBeforeExit);
  }, [saveStatus]);
}
