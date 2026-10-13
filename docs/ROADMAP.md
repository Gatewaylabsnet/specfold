# Roadmap

## v1.0 (Released)

- Local OpenAPI/Swagger collection editing, environments, request sending, cURL, OpenAPI/Collection export, encrypted secrets, hardened Electron shell, and Windows/macOS/Linux packages.
- `v1.0.3` remains available for users who need the previous stable release.

## v1.1.0

- Postman Collection v2.0/v2.1, Postman v3 folders, Insomnia v4/v5, HAR 1.2, and `.http`/`.rest` imports.
- Operation selection, folder traversal limits, script/symlink skipping, and portable-format warnings.
- Default renameable `Specfold` environment and final-environment protection.
- Complete backup export, 100 MB validated restore, pre-restore safety copy, atomic rollback, and full local deletion.
- No plaintext secret persistence when secure storage is unavailable.
- Production modules below 500 lines with shared IPC contracts and format-specific import/export modules.
- React Testing Library coverage and tagless release-package verification with `SHA256SUMS.txt`.

## v1.3.1-v1.7

- Correctness and secret-safety hotfixes for cURL, native exports, response examples, and literal request credentials.
- System/Light/Dark appearance, Import Doctor, route inspection, response copy/save-example tools, and named connection profiles.
- Safe re-import diffs, Postman v2.1 and `.http` export, plus portable OAuth token recipes.
- Multipart upload testing, inherited base URL fixes, compact request/response layout, and text density preferences.
- About panel with installed version metadata and manual GitHub Release update checks.

Acceptance criteria and release gates: [v1.3.1-v1.5 delivery plan](V1_3_TO_V1_5_DELIVERY_PLAN.md).

## v1.10.0 Local Agent — Release Preparation

Implemented: copied JSON/Codex setup, bundled runtime, real connection test, open-desktop human review/apply, serialized single writer with editor flush/revision/generation guards, stale-preview refresh/cancel, selected-request consent expiry/count/revocation, encrypted JWT capture, masked observations and documentation preview/export.

Engineering acceptance: synthetic 16 POST + separate JWT + bearer references, no duplicate apply, no import HTTP calls, old renderer-save rejection, stale revision refresh, default-off execution and redacted documentation tested on Windows. Stable packages remain v1.9.4; no publication is implied by this source work.

Release preparation adds semantic literal-credential masking, isolated TLS connection pools, JWT capture that preserves pending/manual editor changes, cancellation from MCP through consent and HTTP, and authenticated expired-plan cleanup. The [draft release notes](RELEASE_NOTES_v1.10.0.md) track these changes. Current local source-size/lint/typecheck/build, 263 unit/renderer/agent tests, three source Electron/SDK scenarios and all seven Windows packaged E2E scenarios pass. The unsigned Windows portable v1.10.0 package matches its built source; production dependency audit reports zero vulnerabilities. Multi-platform CI/release verification remains pending; results must be tied to the release commit before publication.

Remaining launch evidence: multi-platform package/checksum verification, actual client UI checks, and five human testers (four self-service connections; three repeat uses within two weeks). Automated tests do not complete the usability pilot.

## Later

- Windows code signing.
- Apple signing and notarization.
- Automatic update download and installation after signed release infrastructure exists.
- Authenticated/SOCKS proxy UI.
- Worker-thread parsing for very large documents.
- Broader packaged-app automation on physical platform runners.
