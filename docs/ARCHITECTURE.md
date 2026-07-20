# Architecture

## Layers

1. Electron bootstrap configures the single-instance lifecycle, window, CSP, and IPC registration.
2. Electron services own storage, HTTP, import-source traversal, native dialogs, and proxy handling.
3. The preload exposes one typed `StudioApi`; its contracts live in `apps/desktop/src/shared/contracts.ts` and are shared by main, preload, and renderer.
4. React controller hooks own workspace, import, request, export, and data-management workflows.
5. React screens and tree components render editor, import, environments, export, and settings views.
6. Core pure functions own the model, importers, exporters, variables, cURL conversion, and HTTP preparation.

Production TypeScript, TSX, and CSS source files are kept below 500 lines. Generated output under `out` and `dist` is excluded.

## Repository Layout

```text
apps/desktop/src/main
  index.ts              lifecycle bootstrap
  ipc.ts                typed IPC registration
  storage.ts            Electron dialogs and storage adapter
  storageService.ts     testable atomic persistence, backup, restore, rollback
  http.ts               request and import-URL HTTP clients
  uploadFiles.ts        session-only upload grants and bounded FormData assembly
  importSources.ts      bounded Postman v3 folder traversal
  window.ts             BrowserWindow and CSP
apps/desktop/src/shared/contracts.ts
apps/desktop/src/renderer
  app/use*Controller.ts controller hooks
  app/screens            Import, Editor, Environment, Export, Settings
  components/tree       collection/folder/request rows and drag/drop
  styles/sections       cascade-ordered style modules
packages/core/src
  importers/portable    Postman v2/v3, Insomnia, HAR, HTTP
  exporters/openapi/export
  model, variables, curl, http
```

## Data Flow

The renderer calls pure core import/export functions directly. Persistence, native file access, and outgoing HTTP cross the sandboxed preload bridge. IPC payloads use the shared contracts. Workspace mutations are serialized in main, while renderer autosave is debounced.

Multipart file bytes remain in the main-process boundary. A native picker registers a canonical local file under a random, session-only upload ID; the renderer receives only that ID plus display metadata. `Send` resolves approved IDs, revalidates the file, applies upload limits, and creates `FormData`. Imported or persisted IDs are not trusted, and multipart `Content-Type` is left to the fetch implementation so its boundary always matches the encoded body.

## Storage And Restore

- `workspace.json` and `app-settings.json` live under Electron `userData`.
- Workspace schema remains `schemaVersion: 1`; `ensureWorkspaceEnvironment` gives older workspaces an active environment.
- Writes use same-directory temporary files and atomic rename.
- Secret variables are encrypted with Electron `safeStorage`. If encryption is unavailable, plaintext secret values are never written and the renderer shows a persistent warning.
- Complete backups use `specfold.backup.v1`, intentionally contain readable secrets after explicit confirmation, and are written with `0600` permissions where supported.
- Restore input is capped at 100 MB and validates the root schema, workspace arrays/version, and settings.
- Restore creates a safety copy, writes workspace then settings serially, and rolls both files back if either write fails.
- Multipart upload IDs are transient and stripped from workspace, collection, and backup serialization. File contents and local paths are never persisted.

## Desktop Security Boundary

The renderer uses `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and packaged CSP. It cannot access Node or the filesystem directly. Import scripts are treated as data and are never executed.
