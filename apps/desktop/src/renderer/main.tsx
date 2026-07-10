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
    sendRequest: async (request) => {
      // Canned success so the editor/response/history flow is reviewable in a
      // browser without a real network stack. Never used in the packaged app.
      const payload = {
        ok: true,
        method: request.method,
        access_token: `demo-token-${Math.floor(Math.random() * 1e6)}`,
        receivedAt: new Date().toISOString()
      };
      const rawBody = JSON.stringify(payload);
      return {
        status: 200,
        statusText: "OK",
        durationMs: 12 + Math.floor(Math.random() * 40),
        sizeBytes: rawBody.length,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload, null, 2),
        rawBody
      };
    },
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
