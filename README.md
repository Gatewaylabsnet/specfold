<p align="center">
  <img src="apps/desktop/build/logo.svg" width="96" height="96" alt="Specfold logo" />
</p>

<h1 align="center">Specfold</h1>

<p align="center">OpenAPI collection editor - a <a href="https://gatewaylabs.net">GatewayLabs</a> tool</p>

Local-first desktop tool to **import OpenAPI/Swagger, organize requests into collections/folders, add manual requests, test them, and export selected folders back to OpenAPI YAML/JSON**.

It is not a full Postman replacement. The core value is a tight loop:

```text
Paste OpenAPI/Swagger -> Import into collection/folder/request tree
      -> Add manual requests (JWT token, etc.)
      -> Edit and test requests
      -> Export a selected folder or the whole collection as OpenAPI YAML/JSON
```

Everything runs locally. No account, no cloud sync, no team workspace.

## Features

- Import OpenAPI 3.x, Swagger 2.0, the app's own Collection JSON, or a `curl` command: paste, open a file, or fetch from a URL.
- Copy any request as a `curl` command for sharing or scripting.
- Pick exactly which operations to import with per-operation checkboxes, select all / deselect all, and a live count.
- Auto-group imported endpoints by tag, first path segment, or a single folder.
- Collection / folder / request tree with search, inline rename, duplicate, delete, and drag-and-drop reordering.
- Query params, path params, headers, body, and auth: bearer, basic, or API key.
- Environments with `{{baseUrl}}`, `{{accessToken}}`-style variables. Variable values may reference other variables.
- Manual request templates for a generic JWT token request and an Apinizer JWT token request.
- Save a JSON response field straight into an environment variable without scripting.
- Send requests and view status, timing, size, headers, and body, with per-request response history.
- Export structure check before saving generated OpenAPI.
- Round-trip fidelity for imported OpenAPI operations, preserving schemas, security, and fields such as `deprecated` where possible.
- Keyboard shortcuts: `Ctrl+Enter` sends the active request, `Ctrl+S` saves the workspace.
- Cross-platform packaging for Windows, macOS, and Linux.

## Apinizer workflow

1. Paste the OpenAPI/Swagger document exported from Apinizer into **Import**.
2. In the left sidebar, open **Templates** -> **Apinizer JWT Token**.
   This adds a `POST {{baseUrl}}/auth/jwt` request:
   - `Content-Type: application/x-www-form-urlencoded`
   - no request auth
   - form body: `grant_type=password`, `username={{username}}`, `password={{password}}`, `client_id={{clientId}}`, `client_secret=-`
3. In **Environments**, create a `Local` environment and set `baseUrl`, `username`, `password`, and `clientId`.
   Mark secrets as secret so they are encrypted at rest.
4. Send the token request, then use **Save field to variable** on the response to store `access_token` into `{{accessToken}}`.
5. Other requests using bearer auth with `{{accessToken}}` now authenticate.
6. Select the folder you want and export it as OpenAPI YAML/JSON.

## Security and Data-Safety Notes

- **No silent data loss.** The workspace is written atomically, rotating backups are kept, and corrupt workspace files are quarantined instead of overwritten.
- **Secrets encrypted at rest.** Environment variables marked secret are encrypted with Electron `safeStorage` before being written to disk. If encryption is unavailable, secret values load back empty instead of being persisted as plaintext.
- **Leak-aware export.** Parameter/header values are not emitted as OpenAPI examples unless explicitly enabled. Export warnings flag literal values that look like secrets.
- **Folder-scoped exports stay lean.** Unused component schemas are pruned by default.
- **Valid OpenAPI output.** Duplicate `method + path` operations produce warnings instead of silently dropping requests.
- **Safer HTTP.** Requests have a configurable timeout, response bodies are capped, insecure TLS is opt-in, and outgoing requests use the system proxy with `HTTP_PROXY` / `HTTPS_PROXY` fallback.
- **Hardened desktop shell.** The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a packaged Content-Security-Policy.
- **Confirmations** guard destructive actions, and a single-instance lock prevents two windows from clobbering the same workspace file.

### Known Limitations / Follow-Ups

- Release builds are not code-signed yet unless signing credentials are supplied to the release workflow.
- macOS builds are not notarized yet unless Apple notarization credentials are supplied to the release workflow.
- SOCKS proxies are not supported; configure an HTTP(S) proxy for Specfold.
- Auto-update is not implemented in v1.0.

## Download

Tagged releases publish draft GitHub Release assets from `.github/workflows/release.yml` on any `v*` tag:

- Windows x64: portable `.exe` and NSIS installer.
- macOS x64 and arm64: `.dmg` and `.zip`.
- Linux x64: `.AppImage` and `.deb`.

Unsigned Windows builds may trigger SmartScreen. Unsigned and non-notarized macOS builds may require opening from Finder with **Open** to confirm Gatekeeper prompts. Signing and notarization are supported by the workflow when credentials are configured.

## Project Layout

```text
apps/desktop      Electron app (main / preload / React renderer)
packages/core     Import/export, HTTP prep, variable resolution, model
docs/             Product spec, architecture, import/export rules, red-team report
```

## Development

Requires Node.js >= 20 and npm >= 10.

```bash
npm install
npm run dev
npm run typecheck
npm test
```

## Build

```bash
npm run package:win:portable     # Windows portable .exe
npm run package:win:installer    # Windows NSIS installer
npm run package:win              # Windows portable + installer
npm run package:mac              # macOS dmg + zip, x64 + arm64; run on macOS
npm run package:linux            # Linux AppImage + deb, x64; run on Linux
```

Artifacts are written to `apps/desktop/dist`.

The app icon is generated from `apps/desktop/build/generate-icon.mjs`:

```bash
npm run icon --workspace @openapi-collection-studio/desktop
```

Tagging a release:

```bash
git tag v1.0.0
git push origin main
git push origin v1.0.0
```

## Security Review

See [`docs/REDTEAM_REPORT.md`](docs/REDTEAM_REPORT.md) for the v1.0 threat model, closed findings, and remaining release risks.
