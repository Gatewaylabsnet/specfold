// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "@openapi-collection-studio/core";
import { renderApp, studioMock } from "./App.testHelpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Postman import environments", () => {
  it("keeps the active environment when Postman variables are imported by default", async () => {
    const workspace = createEmptyWorkspace("Postman workspace");
    const activeEnvironmentId = workspace.activeEnvironmentId;
    const api = studioMock(workspace);
    const document = JSON.stringify({
      info: {
        name: "DATS CKS",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
      },
      variable: [
        { key: "baseUrl", value: "https://api.example.test" },
        { key: "bearerToken", value: "secret", type: "secret" }
      ],
      item: [{
        name: "List products",
        request: { method: "GET", url: "{{baseUrl}}/products" }
      }]
    });

    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.change(await screen.findByPlaceholderText(/Paste OpenAPI 3.x/), { target: { value: document } });
    const importButton = screen.getAllByRole("button", { name: "Import" })
      .find((button) => button.classList.contains("primary-button"));
    expect(importButton).toBeDefined();
    await user.click(importButton!);

    await waitFor(() => {
      const saved = vi.mocked(api.saveWorkspace).mock.calls
        .map(([workspace]) => workspace)
        .find((candidate) => candidate.collections.some((collection) => collection.name === "DATS CKS"));
      expect(saved).toBeDefined();
      expect(saved?.environments).toHaveLength(1);
      expect(saved?.activeEnvironmentId).toBe(activeEnvironmentId);
    });
  });

  it("imports Postman variables only on request without changing the active environment", async () => {
    const workspace = createEmptyWorkspace("Postman workspace");
    const activeEnvironmentId = workspace.activeEnvironmentId;
    const api = studioMock(workspace);
    const document = JSON.stringify({
      info: {
        name: "DATS CKS",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
      },
      variable: [{ key: "baseUrl", value: "https://api.example.test" }],
      item: [{
        name: "List products",
        request: { method: "GET", url: "{{baseUrl}}/products" }
      }]
    });

    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.change(await screen.findByPlaceholderText(/Paste OpenAPI 3.x/), { target: { value: document } });
    await user.click(screen.getByRole("checkbox", { name: "Import source variables as a new environment" }));
    const importButton = screen.getAllByRole("button", { name: "Import" })
      .find((button) => button.classList.contains("primary-button"));
    expect(importButton).toBeDefined();
    await user.click(importButton!);

    await waitFor(() => {
      const saved = vi.mocked(api.saveWorkspace).mock.calls
        .map(([workspace]) => workspace)
        .find((candidate) => candidate.collections.some((collection) => collection.name === "DATS CKS"));
      expect(saved).toBeDefined();
      expect(saved?.environments).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "DATS CKS variables" })
      ]));
      expect(saved?.activeEnvironmentId).toBe(activeEnvironmentId);
    });
  });
});
