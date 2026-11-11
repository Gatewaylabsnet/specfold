# Specfold 1.12.1

## Fixed

- Specfold can reopen a workspace after an abnormal exit leaves a writer lock behind. The desktop, CLI and MCP share the same recovery code.
- A valid abandoned lock is kept as a sibling `.specfold-writer.lock.stale-<nonce>` file before Specfold acquires a new lease. This works for both the workspace and the separate agent plan-state lock. Recovery itself does not edit workspace data or settings.
- An active or reused PID, an inconclusive process check, or a malformed lock still blocks writes. A filesystem that does not support safe archival or an interrupted recovery may require the [manual recovery procedure](LOCAL_AGENT.md#safety-backups-recovery-and-boundaries).

## Verification and upgrade

Regression tests exercise live, crashed and concurrent writer processes, malformed locks and ambiguous ownership. A Windows Electron test opens an existing collection with a stale lease and verifies the archived bytes and new owner. The release pipeline also verifies the public packages and checksums, packaged Windows workflows, and both Windows installer scopes.

No storage or backup format changed from [1.12.0](RELEASE_NOTES_v1.12.0.md). Close Specfold before upgrading and keep a backup. Windows builds remain unsigned, macOS builds are not notarized, and updates are downloaded manually from [GitHub Releases](https://github.com/Gatewaylabsnet/specfold/releases/tag/v1.12.1).
