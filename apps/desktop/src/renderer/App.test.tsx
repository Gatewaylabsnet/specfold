// @vitest-environment jsdom
import React from "react";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCollection,
  createEmptyWorkspace,
  createFolder,
  createRequest
} from "@openapi-collection-studio/core";
import type { StudioApi } from "../shared/contracts";
import { renderApp, studioMock } from "./App.testHelpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("renderer workflows", () => {
  it("shows every supported import source choice", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("button", { name: "Open file" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Postman v3 folder" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Import from URL" })).toBeTruthy();
    expect(screen.getByPlaceholderText(/Paste OpenAPI 3.x/)).toBeTruthy();
  });

  it("requires confirmation before backup export and restore", async () => {
    const api = studioMock();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Settings" }));

    await user.click(await screen.findByRole("button", { name: "Export backup" }));
    expect(api.exportBackup).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Export backup" }));
    await waitFor(() => expect(api.exportBackup).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Restore backup" }));
    await waitFor(() => expect(api.restoreBackup).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledTimes(3);
  });

  it("saves the text size preference from Settings", async () => {
    const api = studioMock();
    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Text size" }), "large");

    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ fontSize: "large" })));
    expect(document.documentElement.dataset.fontSize).toBe("large");
  });

  it("shows app version in About and checks for updates without downloading", async () => {
    const api = studioMock();
    let menuListener: Parameters<StudioApi["onAppMenuAction"]>[0] | undefined;
    api.onAppMenuAction = vi.fn((listener) => {
      menuListener = listener;
      return () => undefined;
    });
    const { user } = await renderApp(api);
    act(() => menuListener?.("about"));

    expect(await screen.findByRole("dialog", { name: "About Specfold" })).toBeTruthy();
    expect(await screen.findByText("v1.6.0")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Check for updates" }));

    expect(await screen.findByText(/v1\.7\.0 is available/i)).toBeTruthy();
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(api.openExternal).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Release notes" }));
    expect(api.openExternal).toHaveBeenCalledWith("https://github.com/Gatewaylabsnet/specfold/releases/tag/v1.7.0");
    await user.click(screen.getByRole("button", { name: "Close About" }));
    expect(screen.queryByRole("dialog", { name: "About Specfold" })).toBeNull();

    vi.mocked(api.checkForUpdates).mockClear();
    act(() => menuListener?.("check-for-updates"));
    expect(await screen.findByText(/v1\.7\.0 is available/i)).toBeTruthy();
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("does not allow the last environment to be deleted", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Environments" }));
    const deleteButton = await screen.findByTitle("At least one environment is required") as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
  });

  it("tests an environment base URL and keeps its response visible", async () => {
    const api = studioMock();
    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Environments" }));
    const baseUrl = await screen.findByRole("textbox", { name: "Environment base URL" });
    await user.type(baseUrl, "https://api.example.test");
    await user.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(api.testConnection).toHaveBeenCalledWith("https://api.example.test"));
    expect(await screen.findByText(/Reachable: HTTP 204 No Content/)).toBeTruthy();
  });

  it("shows local data details and opens the local data folder from Settings", async () => {
    const api = studioMock();
    api.getLocalDataInfo = vi.fn(async () => ({
      dataPath: "C:\\Specfold",
      backupCount: 2,
      latestBackupAt: "2026-08-04T10:00:00.000Z"
    }));
    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(await screen.findByText("Local data")).toBeTruthy();
    expect(screen.getByText(/2 automatic safety backups/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open data folder" }));
    await waitFor(() => expect(api.openLocalDataFolder).toHaveBeenCalledTimes(1));
  });

  it("supports save, request search, and send keyboard shortcuts", async () => {
    const api = studioMock();
    const { user } = await renderApp(api);
    vi.mocked(api.saveWorkspace).mockClear();

    await user.keyboard("{Control>}k{/Control}");
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search requests" }));
    await user.keyboard("{Control>}s{/Control}");
    await waitFor(() => expect(api.saveWorkspace).toHaveBeenCalled());
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(api.sendRequest).toHaveBeenCalledTimes(1));
  });

  it("pins a frequently used request at the top of its folder", async () => {
    const api = studioMock();
    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Pin request" }));

    await waitFor(() => {
      const savedWorkspaces = vi.mocked(api.saveWorkspace).mock.calls.map(([saved]) => saved);
      expect(savedWorkspaces.some((saved) => saved.collections[0]?.requests[0]?.favorite)).toBe(true);
    });
  });

  it("clears the environment base URL without prompting or clearing collection routes", async () => {
    const workspace = createEmptyWorkspace("Base URL workspace");
    const collection = createCollection("Demo API");
    collection.baseUrl = "https://collection.example.com";
    workspace.collections.push(collection);
    workspace.environments[0].variables = [
      { id: "var_baseUrl", name: "baseUrl", value: "https://environment.example.com", enabled: true }
    ];
    const api = studioMock(workspace);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Environments" }));
    const baseUrl = await screen.findByRole("textbox", { name: "Environment base URL" });
    await user.clear(baseUrl);
    await user.tab();

    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() => {
      const savedWorkspaces = vi.mocked(api.saveWorkspace).mock.calls.map(([saved]) => saved);
      expect(savedWorkspaces.some((saved) =>
        !saved.environments[0]?.variables.some((variable) => variable.name === "baseUrl") &&
        saved.collections[0]?.baseUrl === "https://collection.example.com"
      )).toBe(true);
    });
  });

  it("keeps request name editing responsive across multiple folders and commits on blur", async () => {
    const workspace = createEmptyWorkspace("Multi-folder workspace");
    const collection = createCollection("Demo API");
    const firstFolder = createFolder("Accounts");
    const secondFolder = createFolder("Orders");
    firstFolder.requests.push(
      createRequest({ name: "Find account", method: "GET", url: "/accounts/{id}" })
    );
    secondFolder.requests.push(
      createRequest({ name: "Find order", method: "GET", url: "/orders/{id}" })
    );
    collection.folders.push(firstFolder, secondFolder);
    workspace.collections.push(collection);

    const { user } = await renderApp(studioMock(workspace));
    const nameInput = screen.getByRole("textbox", { name: "Request name" });
    await user.clear(nameInput);
    await user.type(nameInput, "Get account details");

    expect((nameInput as HTMLInputElement).value).toBe("Get account details");
    expect(screen.getByText("Find account")).toBeTruthy();

    await user.tab();
    await screen.findByText("Get account details");
  });

  it("builds multipart text and file fields with an accessible file picker", async () => {
    const workspace = createEmptyWorkspace("Upload workspace");
    const collection = createCollection("Documents API");
    collection.requests.push(
      createRequest({ name: "Upload document", method: "POST", url: "/documents" })
    );
    workspace.collections.push(collection);
    const api = studioMock(workspace);
    api.openUploadFile = vi.fn(async () => ({
      canceled: false,
      file: {
        uploadId: "upload-session-1",
        fileName: "report.pdf",
        sizeBytes: 2048,
        contentType: "application/pdf"
      }
    }));

    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Body" }));
    await user.click(screen.getByRole("button", { name: "Form data" }));

    expect(screen.getByRole("note", { name: "Multipart boundary information" }).textContent)
      .toMatch(/boundary.*automatically/i);
    await user.click(screen.getByRole("button", { name: "Add text field" }));
    await user.type(screen.getByRole("textbox", { name: "Field 1 name" }), "title");
    await user.type(screen.getByRole("textbox", { name: "Field 1 value" }), "Quarterly report");

    await user.click(screen.getByRole("button", { name: "Add file" }));
    await user.type(screen.getByRole("textbox", { name: "Field 2 name" }), "document");
    expect(screen.getByRole("alert").textContent).toMatch(/choose a file/i);
    await user.click(screen.getByRole("button", { name: "Choose file for field 2" }));

    expect(await screen.findByText("report.pdf")).toBeTruthy();
    expect(screen.getByText("2.0 KB / application/pdf")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace file for field 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear file for field 2" })).toBeTruthy();
    const mediaType = screen.getByRole("textbox", { name: "Field 2 media type" });
    expect((mediaType as HTMLInputElement).value).toBe("application/pdf");
    await user.clear(mediaType);
    await user.type(mediaType, "application/vnd.gateway.document");

    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(api.sendRequest).toHaveBeenCalledTimes(1));
    expect(api.sendRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          mode: "multipart",
          contentType: "multipart/form-data",
          multipart: expect.arrayContaining([
            expect.objectContaining({ key: "title", type: "text", value: "Quarterly report" }),
            expect.objectContaining({
              key: "document",
              type: "file",
              uploadId: "upload-session-1",
              fileName: "report.pdf",
              contentType: "application/vnd.gateway.document"
            })
          ])
        })
      }),
      expect.anything(),
      expect.anything(),
      []
    );

    await user.click(screen.getByRole("button", { name: "Clear file for field 2" }));
    expect(screen.getByRole("alert").textContent).toMatch(/choose a file/i);
    expect(api.releaseUploadFile).toHaveBeenCalledWith("upload-session-1");
  });

  it("shows file-picker failures inline without removing the multipart row", async () => {
    const workspace = createEmptyWorkspace("Upload error workspace");
    const collection = createCollection("Documents API");
    collection.requests.push(
      createRequest({ name: "Upload document", method: "POST", url: "/documents" })
    );
    workspace.collections.push(collection);
    const api = studioMock(workspace);
    api.openUploadFile = vi.fn(async () => ({
      canceled: false,
      error: "The selected file is no longer available."
    }));

    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Body" }));
    await user.click(screen.getByRole("button", { name: "Form data" }));
    await user.click(screen.getByRole("button", { name: "Add file" }));
    await user.click(screen.getByRole("button", { name: "Choose file for field 1" }));

    expect((await screen.findByRole("alert")).textContent)
      .toBe("The selected file is no longer available.");
    expect(screen.getByRole("listitem", { name: "Form-data field 1" })).toBeTruthy();
  });

  it("edits a folder base URL and sends its inherited folder path", async () => {
    const workspace = createEmptyWorkspace("Proxy workspace");
    const collection = createCollection("Demo API");
    collection.baseUrl = "https://api.example.com/default";
    const parent = createFolder("Proxy A");
    parent.baseUrl = "https://proxy-a.example.com/service";
    const child = createFolder("Orders");
    child.requests.push(createRequest({ name: "List orders", method: "GET", url: "/orders" }));
    parent.folders.push(child);
    collection.folders.push(parent);
    workspace.collections.push(collection);
    const api = studioMock(workspace);

    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: /^Orders/ }));
    await user.click(screen.getByRole("button", { name: "Environments" }));
    const folderBaseUrl = screen.getByRole("textbox", { name: "Folder base URL" });
    expect(screen.getByRole("textbox", { name: "Collection base URL" })).toBeTruthy();
    expect(folderBaseUrl.getAttribute("placeholder")).toContain("https://proxy-a.example.com/service");
    expect(screen.getByText("Inherited from Proxy A")).toBeTruthy();
    await user.type(folderBaseUrl, "https://proxy-b.example.com/orders");

    await user.click(screen.getByRole("button", { name: "Editor" }));
    await user.click(screen.getByRole("button", { name: /List orders/ }));
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(api.sendRequest).toHaveBeenCalledTimes(1));
    expect(api.sendRequest).toHaveBeenCalledWith(
      expect.objectContaining({ name: "List orders" }),
      expect.anything(),
      expect.objectContaining({ baseUrl: "https://api.example.com/default" }),
      [
        { baseUrl: "https://proxy-a.example.com/service" },
        { baseUrl: "https://proxy-b.example.com/orders" }
      ]
    );
  });

  it("opens the folder route editor when a request has no configured base URL", async () => {
    const workspace = createEmptyWorkspace("Routing workspace");
    const collection = createCollection("Demo API");
    const folder = createFolder("Proxy");
    folder.requests.push(createRequest({ name: "List proxy items", method: "GET", url: "/items" }));
    collection.folders.push(folder);
    workspace.collections.push(collection);

    const { user } = await renderApp(studioMock(workspace));
    await user.click(screen.getByRole("button", { name: /List proxy items/ }));

    expect(screen.getByText("Not configured")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Configure route" }));

    expect(await screen.findByRole("heading", { name: "Connection profiles" })).toBeTruthy();
    const folderBaseUrl = screen.getByRole("textbox", { name: "Folder base URL" });
    await user.type(folderBaseUrl, "https://proxy.example.com/api");

    await user.click(screen.getByRole("button", { name: "Editor" }));
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(window.studio.sendRequest).toHaveBeenCalledTimes(1));
    expect(window.studio.sendRequest).toHaveBeenCalledWith(
      expect.objectContaining({ name: "List proxy items" }),
      expect.anything(),
      expect.anything(),
      [{ baseUrl: "https://proxy.example.com/api" }]
    );
  });

  it("creates Apinizer JWT in a dedicated folder with a derived gateway origin", async () => {
    const workspace = createEmptyWorkspace("Apinizer workspace");
    const collection = createCollection("DATS CKS");
    collection.baseUrl = "https://api.tarimorman.gov.tr/dats/cks";
    workspace.collections.push(collection);

    const { user } = await renderApp(studioMock(workspace));
    await user.click(screen.getByRole("button", { name: "New" }));
    await user.click(screen.getByRole("menuitem", { name: "Apinizer JWT request" }));

    expect((await screen.findAllByText("Apinizer Auth")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Environments" }));
    expect((screen.getByRole("textbox", { name: "Folder base URL" }) as HTMLInputElement).value)
      .toBe("https://api.tarimorman.gov.tr");
    await user.click(screen.getByRole("button", { name: "Editor" }));
    expect((screen.getByRole("textbox", { name: "Request URL" }) as HTMLInputElement).value)
      .toBe("{{baseUrl}}/auth/jwt");
  });

  it("saves a response token for a folder and applies it to bearer requests", async () => {
    const workspace = createEmptyWorkspace("Folder token workspace");
    const collection = createCollection("Orders API");
    const folder = createFolder("Orders");
    const protectedRequest = createRequest({
      name: "Protected orders",
      method: "GET",
      url: "/orders"
    });
    protectedRequest.auth = { type: "bearer", token: "{{accessToken}}" };
    folder.requests.push(
      createRequest({ name: "Get orders token", method: "POST", url: "/token" }),
      protectedRequest
    );
    collection.folders.push(folder);
    workspace.collections.push(collection);
    const api = studioMock(workspace);
    vi.mocked(api.sendRequest).mockResolvedValue({
      status: 200,
      statusText: "OK",
      durationMs: 4,
      sizeBytes: 31,
      headers: { "content-type": "application/json" },
      body: "{\n  \"access_token\": \"folder-token\"\n}",
      rawBody: "{\"access_token\":\"folder-token\"}"
    });

    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(await screen.findByRole("button", { name: "Save as folder token" }));
    expect(await screen.findByText(/Saved "ordersAccessToken" as the folder access token/i))
      .toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Protected orders/ }));
    await user.click(screen.getByRole("button", { name: "Auth" }));
    await user.click(screen.getByRole("button", { name: "Use folder token" }));
    expect((screen.getByRole("textbox", { name: "Token" }) as HTMLInputElement).value)
      .toBe("{{ordersAccessToken}}");

    await waitFor(() => {
      const savedWorkspaces = vi.mocked(api.saveWorkspace).mock.calls.map(([saved]) => saved);
      expect(savedWorkspaces.some((saved) => {
        const savedFolder = saved.collections[0]?.folders[0];
        const tokenVariable = saved.environments[0]?.variables.find(
          (variable) => variable.name === "ordersAccessToken"
        );
        return savedFolder?.accessTokenVariable === "ordersAccessToken" &&
          tokenVariable?.value === "folder-token" &&
          tokenVariable.secret === true;
      })).toBe(true);
    });
  });

  it("copies the generated export preview to the clipboard", async () => {
    const { user } = await renderApp();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(await screen.findByRole("button", { name: "Copy to clipboard" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain("/users");
    expect(await screen.findByText("Copied export content to the clipboard.")).toBeTruthy();
  });
});
