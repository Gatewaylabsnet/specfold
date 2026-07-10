import React from "react";
import ReactDOM from "react-dom/client";
import { createEmptyWorkspace } from "@openapi-collection-studio/core";
import { App } from "./App";
import "./styles/global.css";

// Dev-only fallback: when the renderer is opened in a plain browser (no
// Electron preload), install an in-memory mock of window.studio so the UI can
// be developed and reviewed without launching Electron. In the packaged app
// the preload always defines window.studio first, so this never runs there.
if (import.meta.env.DEV && typeof window.studio === "undefined") {
  let workspace = createEmptyWorkspace("Browser Preview");
  window.studio = {
    loadWorkspace: async () => ({ workspace, recovered: false }),
    saveWorkspace: async (next) => {
      workspace = next;
    },
    loadSettings: async () => ({
      requestTimeoutMs: 30_000,
      maxResponseBytes: 10 * 1024 * 1024,
      allowInsecureTls: false
    }),
    saveSettings: async (settings) => settings,
    sendRequest: async () => ({
      status: 0,
      statusText: "Unavailable",
      durationMs: 0,
      sizeBytes: 0,
      headers: {},
      body: "",
      rawBody: "",
      error: "Sending requests requires the desktop app (browser preview mode)."
    }),
    saveExportFile: async () => ({ canceled: true }),
    openImportFile: async () => ({ canceled: true }),
    fetchImportUrl: async () => ({
      ok: false,
      error: "Fetching URLs requires the desktop app (browser preview mode)."
    })
  };
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
