# Architecture

## Layers

1. Desktop shell: Electron main process owns local file access, native save dialogs, and HTTP sending.
2. Renderer UI: React/Vite app owns user workflows and editor state.
3. Core model: TypeScript domain types for workspace, collections, folders, requests, environments, auth, bodies, examples, and OpenAPI metadata.
4. Importers: Pure functions parse JSON/YAML and convert OpenAPI 3.x or Swagger 2.0 into the internal model.
5. Exporters: Pure functions convert collections or selected folders into OpenAPI 3.0.3 or Collection JSON.
6. Variable resolver: Pure functions resolve `{{variableName}}` tokens and report missing values before sending.
7. HTTP sender: Electron main process prepares and sends requests with Node `fetch`.
8. Storage: Isolated workspace persistence behind a simple load/save boundary.

## Repository Layout

```text
apps/desktop
  src/main      Electron process, storage, HTTP, dialogs
  src/preload   Typed bridge exposed to renderer
  src/renderer  React UI
packages/core
  src/model
  src/importers
  src/exporters
  src/variables
  src/http
  src/storage
```

## Data Flow

The renderer calls core import/export and variable-aware request editing functions. Workspace state is saved through the preload bridge to Electron main. Request sending goes through Electron main, where the request is resolved with the active environment and sent with Node `fetch`.

## Storage Behavior

Electron main stores `workspace.json` in `app.getPath("userData")`. The portable Windows executable and the future installer build both use this per-user data path. The first release does not write project data beside the executable and does not require administrator permissions for normal storage.
