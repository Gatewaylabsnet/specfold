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

Release preparation adds semantic literal-credential masking, isolated TLS connection pools, JWT capture that preserves pending/manual editor changes, cancellation from MCP through consent and HTTP, and authenticated expired-plan cleanup. The [draft release notes](RELEASE_NOTES_v1.10.0.md) record 263 passing tests, local source/build checks, seven passing Windows packaged E2E scenarios and zero production dependency advisories. Candidate [9604df0](https://github.com/Gatewaylabsnet/specfold/commit/9604df07f8ebdad45f345f0e97c8fc8ce7c7224a) passes [CI](https://github.com/Gatewaylabsnet/specfold/actions/runs/38371144773) and the [tagless Windows/macOS/Linux package gate](https://github.com/Gatewaylabsnet/specfold/actions/runs/38371138382). [Draft PR #3](https://github.com/Gatewaylabsnet/specfold/pull/3) remains a release preparation; no v1.10.0 tag or GitHub Release is published.

Independent verification of the [9604df0 bundle](https://github.com/Gatewaylabsnet/specfold/actions/runs/38371138382/artifacts/11798414937) passed for all eight expected package names and SHA-256 hashes, with no extra assets. Remaining launch evidence: actual client UI checks, macOS/Linux GUI checks and five human testers (four self-service connections; three repeat uses within two weeks). Automated tests do not complete the usability pilot. Signing/notarization and a GatewayLabs website deployment are not claimed.

## Later

- Windows code signing.
- Apple signing and notarization.
- Automatic update download and installation after signed release infrastructure exists.
- Authenticated/SOCKS proxy UI.
- Worker-thread parsing for very large documents.
- Broader packaged-app automation on physical platform runners.
