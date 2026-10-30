import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { AppSettings } from "./types";

/** Send once per user intent, outside React state updaters; ignore older acknowledgements. */
export function useSettingsUpdates(settings: AppSettings, setSettings: Dispatch<SetStateAction<AppSettings>>, setNotice: (message: string) => void) {
  const intent = useRef(settings), revision = useRef(0), active = useRef(true);
  useEffect(() => { intent.current = settings; }, [settings]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  return (patch: Partial<AppSettings>) => {
    const next = { ...intent.current, ...patch }, currentRevision = ++revision.current;
    intent.current = next; setSettings(next);
    void window.studio.saveSettings(next).then((saved) => {
      if (!active.current || currentRevision !== revision.current) return;
      intent.current = saved; setSettings(saved);
    }).catch(() => {
      if (!active.current || currentRevision !== revision.current) return;
      setNotice("Settings could not be saved. Check the saved permission state before sending requests.");
      void window.studio.loadSettings().then((saved) => {
        if (!active.current || currentRevision !== revision.current) return;
        intent.current = saved; setSettings(saved);
      }).catch(() => undefined);
    });
  };
}
