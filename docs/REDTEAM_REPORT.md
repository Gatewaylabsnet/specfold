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
- **IPC contract drift:** Closed. Main, preload, and renderer share typed contracts including secure-storage and restore results.
- **Public release metadata leakage:** Closed. Release artifacts exclude builder debug/updater YAML and blockmaps; only user packages and `SHA256SUMS.txt` enter the release bundle.

## Existing Controls Retained

Atomic workspace writes, rotating backups, corrupt-file quarantine, single-instance writer protection, export secret warnings, response/time limits, opt-in insecure TLS, system/environment HTTP(S) proxies, sandbox/context isolation/node-integration-off, packaged CSP, and source-operation OpenAPI fidelity remain in place.

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
