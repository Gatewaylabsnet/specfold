<p align="center">
  <img src="apps/desktop/build/logo.svg" width="96" height="96" alt="Specfold logo" />
</p>

<h1 align="center">Specfold</h1>

<p align="center">OpenAPI collection editor · a <a href="https://gatewaylabs.net">GatewayLabs</a> tool</p>

Local-first Windows desktop tool to **import OpenAPI/Swagger, organize requests into collections/folders, add manual requests (e.g. a JWT token request), test them, and export selected folders back to OpenAPI YAML/JSON**.

It is not a full Postman replacement. The core value is a tight loop:

```
Paste OpenAPI/Swagger  →  Import into collection/folder/request tree
      →  Add manual requests (JWT token, etc.)
      →  Edit & test requests
      →  Export a selected folder or the whole collection as OpenAPI YAML/JSON
```

Everything runs locally. No account, no cloud sync, no team workspace.

## Features

- Import OpenAPI 3.x, Swagger 2.0, the app's own Collection JSON, or a **`curl` command** — **paste, open a file, or fetch from a URL**.
- **Copy any request as a `curl` command** for sharing or scripting.
- **Pick exactly which operations to import**: the Import screen lists every method + path with checkboxes, plus *Select all* / *Deselect all* and a live count.
- Auto-group imported endpoints by tag, first path segment, or a single folder.
- Collection / folder / request tree with a Postman-style editor:
  - **search/filter** across request names, URLs, and methods,
  - **rename** (inline, double-click or the pencil icon), **duplicate**, and **delete** for collections, folders, and requests,
  - **drag-and-drop** to reorder requests and move requests/folders between folders.
- Query params, path params, headers, body, and auth (bearer / basic / API key).
- Environments with `{{baseUrl}}`, `{{accessToken}}`-style variables (multi-level: a variable value may reference another variable).
- Manual request templates: a generic **JWT token request** and an **Apinizer JWT token** request (OAuth2 password grant, form-encoded) — both dropped into an `Auth` folder ready to wire up.
- **Save a response field straight into an environment variable** (e.g. `access_token` → `{{accessToken}}`) without any scripting.
- Send requests and view status, timing, size, headers, and body — with **per-request response history** to compare recent runs.
- **Export structure check**: a badge confirms the generated document is structurally valid OpenAPI (or lists the concrete issues) before you save/send it.
- **Round-trip fidelity**: requests imported from OpenAPI 3.x export from their original operation, preserving parameter/response schemas, OAuth2 scopes, and fields like `deprecated`, with your edits overlaid.
- Keyboard shortcuts: `Ctrl+Enter` sends the active request, `Ctrl+S` saves the workspace.
- Export a selected folder or the whole collection to OpenAPI YAML/JSON, or the app's Collection JSON.
- Portable Windows build; CI runs typecheck, tests, and build on every push.

## Apinizer workflow

A common flow when working with an Apinizer API gateway:

1. Paste the OpenAPI/Swagger document exported from Apinizer into **Import**.
2. In the editor sidebar, open the **Templates** dropdown → **Apinizer JWT Token (OAuth2)**.
   This adds a `POST {{baseUrl}}/auth/jwt` request into an `Auth` folder:
   - `Content-Type: application/x-www-form-urlencoded`
   - Basic auth with `{{clientId}}` / `{{clientSecret}}`
   - body: `grant_type=password&username={{username}}&password={{password}}&scope={{scope}}`
3. In **Environments**, create a `Local` environment and set `baseUrl`, `clientId`,
   `clientSecret`, `username`, `password` (and `scope` if your setup uses it). Mark
   secrets as *secret* so they are encrypted at rest.
4. **Send** the token request, then use **Save field to variable** on the response to
   store `access_token` into `{{accessToken}}`.
5. Other requests referencing `{{accessToken}}` (bearer auth) now authenticate.
6. Select the folder you want and **Export** it as OpenAPI YAML/JSON to hand off.

Adjust the token path, fields, or auth placement in the request editor to match your
specific Apinizer deployment — the template is a starting point.

## Security & data-safety notes

This app handles API definitions and credentials, and its exports are meant to be shared. Recent hardening:

- **No silent data loss.** The workspace is written atomically (temp file + rename), rotating backups are kept in a `backups` folder under the app's user-data directory, and a workspace file that cannot be read or parsed is *quarantined* (renamed to `workspace.corrupt-<timestamp>.json`) rather than overwritten.
- **Secrets encrypted at rest.** Environment variables marked *secret* are encrypted with the OS keychain (Electron `safeStorage`, DPAPI on Windows) before being written to disk. If encryption is unavailable on the platform, secret values are not persisted in plaintext — they load back empty.
- **Leak-aware export.** Parameter/header values are **not** emitted as OpenAPI examples unless you explicitly opt in. When you do, the export screen scans for literal values that look like secrets (tokens, API keys, JWTs, `password`-style fields) and warns before you send the file to anyone.
- **Folder-scoped exports stay lean.** Unused component schemas are pruned by default, so exporting one folder does not ship the entire API's data models.
- **Valid OpenAPI output.** Server URLs containing `{{variables}}` are omitted (a `{{baseUrl}}` server is invalid OpenAPI), the source `3.0.x`/`3.1.x` version is preserved, and duplicate `method + path` operations produce a visible warning instead of silently dropping requests.
- **Safer HTTP.** Requests have a configurable timeout, are aborted when they exceed it, and response bodies are capped at a configurable size to avoid out-of-memory on huge/streaming responses. An opt-in "allow insecure TLS" setting supports internal CAs / self-signed gateways (off by default, with a warning).
- **Hardened import.** `$ref` resolution refuses to walk into the prototype chain (`__proto__`/`constructor`/`prototype`).
- **Confirmations** guard destructive actions (new workspace, delete environment), and a single-instance lock prevents two windows from clobbering the same workspace file.

### Known limitations / follow-ups

- Renderer `sandbox` is left off because the preload ships as an ESM module (Electron only loads sandboxed preloads as CommonJS). `contextIsolation` is on and `nodeIntegration` is off; a production Content-Security-Policy is applied.
- HTTP proxy support is not yet implemented — see `docs/REDTEAM_REPORT.md`.
- The portable build and installer are not code-signed yet.

## Download

Tagged releases publish a Windows **portable `.exe`** and an **NSIS installer** as
GitHub release assets (built by `.github/workflows/release.yml` on any `v*` tag).

The build is **not code-signed yet**, so Windows SmartScreen may warn on first run
("Windows protected your PC" → *More info* → *Run anyway*). Signing is on the roadmap.

## Project layout

```
apps/desktop      Electron app (main / preload / React renderer)
packages/core     Import/export, HTTP prep, variable resolution, model (framework-agnostic, unit-tested)
docs/             Product spec, architecture, import/export rules, red-team report
```

## Development

Requires Node.js >= 20 and npm >= 10.

```bash
npm install
npm run dev            # launch the Electron app in dev mode
npm run typecheck      # type-check all workspaces
npm test               # run unit tests (packages/core)
```

## Build

```bash
npm run package:win:portable     # portable .exe
npm run package:win:installer    # NSIS installer
npm run package:win --workspace @openapi-collection-studio/desktop  # both
```

Artifacts are written to `apps/desktop/dist`.

The app icon is generated (no external tools) from
`apps/desktop/build/generate-icon.mjs`; regenerate it with
`npm run icon --workspace @openapi-collection-studio/desktop`.

Tagging a release:

```bash
git tag v0.1.0 && git push origin v0.1.0   # triggers the Release workflow
```

## Security review

See [`docs/REDTEAM_REPORT.md`](docs/REDTEAM_REPORT.md) for the threat model, findings, and the prioritized action list this hardening pass is based on.
