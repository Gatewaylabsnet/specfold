# Red Team Report - Specfold v1.0

**Date:** 2026-07-14
**Scope:** `apps/desktop`, `packages/core`, packaging config, and release workflow.
**Method:** Static review, threat modeling, and release-readiness review. Dynamic fuzzing was not performed.

## Executive Summary

The original pre-v1 review identified four release-blocking classes of risk: silent data loss, export leaks, plaintext secrets, and weak desktop shell hardening. The v1.0 hardening pass closes those blockers and leaves two operational release risks: Windows code signing and macOS notarization.

Specfold is still a local REST client. It intentionally sends arbitrary user-configured HTTP requests. That behavior is product scope, not a vulnerability by itself.

## Closed v1.0 Findings

- **Workspace data loss:** Closed. Workspace writes are atomic, backups rotate, corrupt workspace files are quarantined, destructive actions require confirmation, and a single-instance lock prevents concurrent writers.
- **Plaintext secret persistence:** Closed. Secret environment variables are encrypted through Electron `safeStorage`; unavailable encryption causes secret values to load empty instead of being persisted as plaintext.
- **Export secret leakage:** Closed for default behavior. Literal examples are opt-in, secret-like values produce warnings, and unused components are pruned by default.
- **Duplicate method/path overwrite:** Closed. Export produces visible warnings rather than silently hiding collisions.
- **Round-trip fidelity gaps:** Closed for the main v1.0 path. Imported OpenAPI operations retain source details where possible and overlay user edits during export.
- **HTTP resource exhaustion:** Closed. Requests have configurable timeout and response body caps.
- **Internal TLS support:** Closed. Insecure TLS is available as an explicit opt-in setting with UI warning.
- **Corporate HTTP(S) proxy support:** Closed for system and environment proxy paths. The app resolves the Electron system proxy and falls back to `HTTP_PROXY` / `HTTPS_PROXY`; `NO_PROXY` is honored for env proxy fallback.
- **Electron shell hardening:** Closed. Electron is upgraded to the v43 line, the preload is loaded as CommonJS, renderer sandbox is enabled, context isolation stays on, node integration stays off, and packaged builds set CSP.
- **Platform release coverage:** Closed. The release workflow builds Windows, macOS, and Linux assets.

## Remaining Risks

- **Unsigned Windows builds:** Open until a code-signing certificate is configured. The workflow is prepared for signing credentials, but v1.0 artifacts may be unsigned.
- **Non-notarized macOS builds:** Open until Apple Developer notarization credentials are configured. Users may see Gatekeeper prompts for unsigned/non-notarized builds.
- **SOCKS proxy support:** Open. HTTP(S) proxies are supported; SOCKS proxies return a clear unsupported-proxy error.
- **Large-document performance:** Partially open. Size caps and safer parsing reduce risk, but very large imports/exports can still run on the renderer thread.

## v1.0 Release Gate

Before tagging `v1.0.0`, all of the following must pass:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run package:win`
- Release workflow dry run or tag-triggered matrix build for Windows, macOS, and Linux.
- Manual layout smoke at `1100x720`, `1366x768`, and `1920x1080`, including long collection/folder/request names.
- Packaged-app smoke for import, create request, send request, export, save/reload, and settings persistence.

## Post-1.0 Priority

1. Configure Windows code signing.
2. Configure macOS signing and notarization.
3. Add auto-update.
4. Add advanced proxy UI, including authenticated and SOCKS proxies.
5. Move heavy import/export parsing off the renderer thread.
