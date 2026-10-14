# Stable 1.11.0 preparation

Status: preparation only. No tag push, release, main merge or deployment is authorized by this checklist. Public downloads remain v1.9.4.

## Candidate and merge order

`codex/specfold-v1.11.0-release-prep` starts from `40d3cd2` and contains all of PR #4 and its parent PR #3. Preserve those drafts. The preparation draft should target `codex/specfold-guided-workflow` until that dependency is integrated.

After separate approval, merge order is **PR #3 -> PR #4 -> stable preparation PR**. Retarget/update each dependent branch after its parent lands, resolve any conflicts without discarding user changes, and verify the final integrated commit. Publishing a separate v1.10.0 release is not required before v1.11.0.

## Completed critical preparation

- Root, desktop, agent, core and lockfile versions declare 1.11.0; linked core dependency versions match.
- Update comparison uses SemVer precedence, including dev.1 -> stable, prerelease numeric ordering, metadata equality and invalid inputs. The stable channel rejects draft/prerelease metadata.
- A read-only release-version gate runs in release checks and before matrix packaging. A mismatched future tag fails before a release package can be published.
- Synthetic legacy schema-1 data verifies load/save, encrypted credentials, automatic preimage backup, full restore/settings snapshots, nested routing, unknown data extensions, native/OpenAPI import-export and disabled-by-default agent permissions.
- Existing MCP security fixes are retained in the candidate history; focused regressions cover masking, TLS isolation, JWT editor preservation, cancellation, plan expiry and data-changing-operation approval.

## Routine verification for the medium phase

1. Run final `release:check` and package verification against the final preparation commit. Do not reuse a dev.1 binary as a stable package.
2. Run the existing release workflow **tagless** on the preparation branch to build Windows/macOS/Linux candidates. Its publication job is skipped without a tag.
3. Verify eight expected public assets: two Windows EXEs, two macOS DMGs, two macOS ZIPs, one Linux AppImage and one DEB. Verify final app/helper versions, bundled helper integrity and every SHA256SUMS entry. Internal YAML/blockmap/debug metadata is excluded from release assets.
4. Exercise the new Windows packages through the packaged E2E suite; record macOS/Linux packaging and any GUI/client smoke checks actually performed. Do not claim unrun real-gateway, real-user-data or vendor-client verification.
5. Update final verification notes and the preparation draft with actual CI/artifact/checksum evidence. Signing/notarization remains optional under the existing policy; report unsigned status honestly without adding paid infrastructure.

## Ready publication sequence, not executed

After explicit publication/merge approval and successful final gates: integrate the PRs in order; ensure the chosen main commit declares 1.11.0; tag that exact commit as v1.11.0; let the existing workflow create its verified **draft** release; check package names/checksums and final notes; then publish it as stable. Verify the public release and latest-stable response before activating README/site download links.

Current update checks use GitHub `/releases/latest`; stable 1.11.0 will be newer than both v1.9.4 and 1.11.0-dev.1 after the comparison fix. A separate updater manifest is not required.

## Honest limitations

Apinizer management discovery requires an actual API contract. Real gateway credentials/production calls were not used. JSON-schema checks are a bounded subset, reports are masked snippets and in-memory history, and canceled operations can already have affected server state. Real user data is untouched; upgrade tests use synthetic historical-format fixtures and an authenticated test encryption adapter.
