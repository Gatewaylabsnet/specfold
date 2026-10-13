# Red Team Report - Specfold v1.1

**Date:** 2026-07-16

**Scope:** Desktop main/preload/renderer, core import/export, local storage, packaging, and release workflow.

**Method:** Static review, threat modeling, unit/integration tests, renderer tests, and production-build review. Dynamic fuzzing and third-party penetration testing were not performed.

## Executive Summary

v1.1 broadens the untrusted input surface and adds complete backup/restore. The release therefore treats portable imports, secret persistence, restore integrity, and release-asset hygiene as primary risks. The implemented controls close the identified release blockers; unsigned binaries and large-document renderer work remain known operational risks.

## Closed v1.1 Findings

- **Plaintext fallback when `safeStorage` is unavailable:** Closed. Secret values are blanked in the persisted copy, never written in plaintext, and a persistent renderer warning reports the condition.
- **Untrusted backup replacement:** Closed. Restore accepts only `specfold.backup.v1`, validates workspace/settings structure, caps reads at 100 MB, and re-encrypts plaintext secrets before disk writes.
- **Partial restore corruption:** Closed. A safety copy is created first; workspace/settings writes are serialized and atomic; failure rolls both files back.
- **Backup disclosure ambiguity:** Closed by explicit consent and documentation. Complete backups intentionally contain readable secrets and use `0600` permissions where supported.
- **Folder traversal/resource exhaustion:** Closed for configured bounds. Postman v3 traversal skips symlinks and scripts, ignores dependency/VCS directories, caps depth/files/bytes, and never executes imported code.
- **Importer parent cycles/malformed records:** Closed. Cycles are broken, unsupported records are skipped with warnings, and format-specific tests cover malformed/unsupported inputs.
- **IPC contract drift and malformed payloads:** Closed. Main, preload, and renderer share typed contracts; main also validates sender identity, runtime payload shape, and document/string size bounds before privileged operations.
- **Untrusted renderer navigation and IPC senders:** Closed. Packaged UI assets are served from a bounded custom protocol, navigation/new windows are denied, permissions default to denied, and every invoke handler validates the trusted main frame.
- **External URL protocol abuse:** Closed. Renderer and native-menu external navigation accepts HTTPS URLs only on the GatewayLabs/GitHub allowlist.
- **Public release metadata leakage:** Closed. Release artifacts exclude builder debug/updater YAML and blockmaps; only user packages and `SHA256SUMS.txt` enter the release bundle.

## Existing Controls Retained

Atomic workspace writes, rotating backups, corrupt-file quarantine, single-instance writer protection, export secret warnings, response/time limits, opt-in insecure TLS, system/environment HTTP(S) proxies, sandbox/context isolation/node-integration-off, packaged CSP, and source-operation OpenAPI fidelity remain in place.

## Multipart Upload Controls

- **Imported local-file exfiltration:** Blocked. Imports retain only disabled filename placeholders; arbitrary paths and imported upload IDs are never read.
- **Renderer filesystem access:** Blocked. Native selection and file reads stay in main; renderer receives random session-only IDs and display metadata.
- **Stale or forged selection:** Rejected. Send accepts only IDs currently registered by the native picker and revalidates the canonical file before encoding.
- **Boundary mismatch/header injection:** Avoided by removing manual multipart `Content-Type` values and letting `FormData` generate the matching boundary.
- **Copied cURL local-file reads:** Blocked. Text parts use `--form-string`; only explicit file placeholders use cURL's `--form @file` syntax, and conflicting framing headers are omitted.
- **Upload resource exhaustion:** Bounded to 200 total parts, 50 file parts, and 100 MB of file and text content per request. Response and timeout limits remain in force.

## Local Agent Source Preview — 2026-10-08

- External MCP helpers only forward typed local calls. Desktop main owns writes, flushes pending editor saves, checks revision and rejects pre-mutation renderer generations; safety backups and atomic receipt rollback remain shared with the offline CLI.
- UI review is the only live approval path. Agents cannot approve themselves; stale plans require a refreshed diff and repeated plans do not duplicate records.
- Connection/network defaults are off. Network approval is per-request or exact selected-request/environment session (15 minutes / 20 sends), revocable. Changes invalidate permission; controlled encrypted JWT capture alone refreshes approved fingerprints. POST consent does not imply read-only safety.
- Main resolves tokens and masks outputs. Observations are untrusted, session-only and bounded; documentation labels untested behavior and requires human review. No agent backup export or automatic publication exists.
- Residual risks: same-user malware/administrators, heuristic masking gaps and model-provider disclosure of returned API structure. Packaged helper depends on Electron RunAsNode being available. Windows SDK/Electron tests do not establish vendor-client UI or macOS/Linux GUI coverage. Human usability pilot and full release gates remain pending.

## v1.10.0 MCP Release Preparation — 2026-10-13

Five issues found during the release review have focused source changes and regression coverage. The current preparation passes source-size, lint, typecheck, 263 unit/renderer/agent tests, production build, three source Electron/SDK scenarios and all seven Windows packaged E2E scenarios. The unsigned Windows portable v1.10.0 package matches its built source; production audit reports zero vulnerabilities, and independent changed-source review found no real secrets (the TLS fixture key is synthetic). Multi-platform CI release validation and publication remain pending:

- **Literal credential disclosure:** Mask typed API-key auth values regardless of custom header/query names, and scrub known literal bearer/basic/API-key credentials from reflected data. General free-text/unknown-field masking remains heuristic.
- **TLS setting overlap:** Use separate verified and insecure direct/proxy pools instead of changing `NODE_TLS_REJECT_UNAUTHORIZED`. Agent sends retain explicit certificate verification while a manual insecure request is in flight.
- **Pending editor changes during JWT capture:** Merge only the captured token into current editor state and advance its save generation. Newer manual changes, including token edits/removal, are retained.
- **Abandoned network work:** Propagate MCP cancellation, stdin closure and local IPC disconnect/timeout/shutdown to native consent and HTTP. Check cancellation before send, token capture and observation recording. Remote effects already performed cannot be undone.
- **Expired plan exhaustion:** Under a separate `.agent/.specfold-writer.lock`, reclaim only expired authenticated plan files and matching signed approvals, scanning at most 128 candidates when capacity is full. Preserve active plans, receipts, unrecognized files and symlinks. Both profile and state leases require careful manual recovery after a crash.

The [v1.10.0 draft release notes](RELEASE_NOTES_v1.10.0.md) and [local agent guide](LOCAL_AGENT.md) track current verification and retain pending multi-platform CI/public artifact validation, real vendor-client UI checks, macOS/Linux GUI coverage and the human usability pilot. Historical v1.1 and 2026-10-08 results are not a pass for this candidate.

## Remaining Risks

- Windows builds are unsigned and may trigger SmartScreen.
- macOS builds are unsigned and not notarized, so Gatekeeper prompts remain.
- Complete backups are plaintext by design after explicit approval; users must protect the file.
- Large imports/exports still execute on the renderer thread within size limits.
- SOCKS proxies, remote `$ref` fetching, auto-update, and imported script execution are unsupported.

## v1.1.0 Release Gate

- `npm run typecheck`, `npm test`, and `npm run build` pass on the final commit.
- Manual `workflow_dispatch` produces two Windows EXEs, two macOS DMGs, two macOS ZIPs, one AppImage, one DEB, and checksums without updater/debug metadata.
- Restore round-trip, rollback, secure-storage-unavailable, delete scope, symlink/limit, import-format, base URL, export warning, and renderer interaction tests pass.
- Desktop/narrow screenshots show no viewport overflow and contain no secrets.
- Packaged smoke covers imports, collection movement/expansion, request send, base URL precedence, backup/restore, and clean deletion.
- Only after gates pass: merge to `main`, create annotated `v1.1.0`, inspect draft assets/checksums, complete smoke tests, then publish manually.
