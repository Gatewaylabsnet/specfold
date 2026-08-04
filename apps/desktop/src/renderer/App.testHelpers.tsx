import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { createCollection, createEmptyWorkspace, createRequest, type Workspace } from "@openapi-collection-studio/core";
import type { StudioApi } from "../shared/contracts";
import { App } from "./App";

function sampleWorkspace(): Workspace {
  const workspace = createEmptyWorkspace("Test workspace");
  const collection = createCollection("Demo API");
  collection.requests.push(createRequest({ name: "List users", method: "GET", url: "/users" }));
  workspace.collections.push(collection);
  return workspace;
}

export function studioMock(workspace = sampleWorkspace()): StudioApi {
  return {
    onAppMenuAction: vi.fn(() => () => undefined),
    getAppInfo: vi.fn(async () => ({
      name: "Specfold", version: "1.6.0", platform: "win32", arch: "x64",
      releaseUrl: "https://github.com/Gatewaylabsnet/specfold/releases/tag/v1.6.0",
      downloadUrl: "https://gatewaylabs.net/specfold", license: "Apache-2.0"
    })),
    checkForUpdates: vi.fn(async () => ({
      ok: true, currentVersion: "1.6.0", latestVersion: "1.7.0", updateAvailable: true,
      releaseName: "v1.7.0", releaseUrl: "https://github.com/Gatewaylabsnet/specfold/releases/tag/v1.7.0"
    })),
    openExternal: vi.fn(async () => undefined),
    loadWorkspace: vi.fn(async () => ({ workspace, recovered: false, secureStorageAvailable: true })),
    saveWorkspace: vi.fn(async () => undefined),
    loadSettings: vi.fn(async () => ({
      requestTimeoutMs: 30_000, maxResponseBytes: 10 * 1024 * 1024, allowInsecureTls: false,
      theme: "system" as const, fontSize: "compact" as const
    })),
    saveSettings: vi.fn(async (settings) => settings),
    testConnection: vi.fn(async (url) => ({ ok: true, url, status: 204, statusText: "No Content", durationMs: 12 })),
    sendRequest: vi.fn(async () => ({
      status: 200, statusText: "OK", durationMs: 1, sizeBytes: 2, headers: {}, body: "{}", rawBody: "{}"
    })),
    saveExportFile: vi.fn(async () => ({ canceled: true })),
    openImportFile: vi.fn(async () => ({ canceled: true })),
    openPostmanFolder: vi.fn(async () => ({ canceled: true })),
    openUploadFile: vi.fn(async () => ({ canceled: true })),
    releaseUploadFile: vi.fn(async () => undefined),
    exportBackup: vi.fn(async () => ({ canceled: true })),
    restoreBackup: vi.fn(async () => ({ canceled: true, restored: false, secureStorageAvailable: true })),
    deleteAllData: vi.fn(async () => undefined),
    getLocalDataInfo: vi.fn(async () => ({ dataPath: "C:\\Specfold", backupCount: 0 })),
    openLocalDataFolder: vi.fn(async () => ({ ok: true })),
    fetchImportUrl: vi.fn(async () => ({ ok: false, error: "offline" }))
  };
}

export async function renderApp(api = studioMock()) {
  window.studio = api;
  render(<App />);
  await screen.findByRole("navigation", { name: "Primary" });
  return { api, user: userEvent.setup() };
}
