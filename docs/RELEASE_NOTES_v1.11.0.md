# Specfold v1.11.0 - Unpublished preparation

Stable release preparation combines the MCP safety candidate from [PR #3](https://github.com/Gatewaylabsnet/specfold/pull/3), the guided workflow from [PR #4](https://github.com/Gatewaylabsnet/specfold/pull/4), and the final update/version safeguards. Public downloads remain v1.9.4. No v1.11.0 tag, release, main merge or website deployment has been performed.

## Added

- Optional local MCP helper with desktop-owned approval, saved-request execution, redacted inspection and documentation context. Existing opt-in permissions remain required.
- Four-step guided testing: Connection, Authentication, Test preview and Results. Generic authentication and an optional configurable Apinizer issuer preset use encrypted environment credentials and reference-only profiles.
- Real-example/default provenance, explicit selection and native approval of data-changing operations, bounded sequential execution, separate status/schema assertions and masked exportable reports.
- Read-only release metadata validation: root/desktop/agent/core manifests, lockfile and linked workspace dependency versions must match; a future release tag must match that version exactly.

## Fixed

- Update comparison now treats stable versions as newer than their prereleases, handles numeric prerelease identifiers correctly, ignores build metadata and prevents equal-version/downgrade notifications. Invalid versions and malformed release metadata do not imply an update or echo raw parser data. The previously built, unpublished dev.1 binary retains its old comparator: its users need a one-time manual download of the stable package.
- Draft or prerelease metadata cannot be offered through the stable update channel. Updates are checked through GitHub's published stable `/releases/latest` endpoint; no separate updater YAML feed or automatic installation is introduced.
- The combined candidate retains custom API-key masking, verified/insecure TLS isolation, targeted JWT capture preserving editor changes, cancellation through consent/IPC/HTTP, and authenticated expired-plan cleanup.

## Verification and remaining scope

The prior dev.1 candidate passed 435 tests and nine packaged Windows E2E tests. Stable-preparation verification covers changed update logic, version gates, legacy schema-1 upgrade/backup/import/export, and retained critical security behavior. Final CI, all-platform package checks, runtime versions and checksum evidence are recorded in the preparation draft and its delivery dossier against the same final commit. Earlier candidate artifacts must not be relabeled as 1.11.0; publication requires the completed preparation checklist.

Upgrade fixtures use synthetic data in compatible 1.9.4/1.10.0 formats, not archived old binaries or real user data. Packaged Windows E2E evidence must identify the new stable candidate; macOS/Linux GUI or keychain checks must only be claimed when actually performed. No real account, gateway token or production API was used.

Apinizer management-project discovery and real gateway verification are outside the validated scope. The preset requests issuer tokens; it does not sign JWTs or automatically retry expired-token requests. Schema checks are a bounded subset; unsupported rules are blocked. Multipart/files and unsupported form bodies require manual testing. Cancellation cannot undo server-side work; reports remain in memory unless exported.

See the [preparation checklist](RELEASE_PREPARATION_v1.11.0.md) and [workflow guide](guided-test-workflow.md).
