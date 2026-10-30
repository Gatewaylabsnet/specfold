# Local unsigned update candidate: 1.12.0-dev.1

This preparation record is based on 1.11.0 commit `3c7f42f1743720461c02001ec53b88578306ac5b`. The user subsequently authorized commit, push and prerelease publication. See [1.12.0-dev.1 release notes](RELEASE_NOTES_v1.12.0-dev.1.md) and the GitHub release for final publication status. No new certificate, credentials, production service call or production installation is included.

## Existing-installation update

The Windows NSIS candidate keeps `productName: Specfold`, `appId: net.gatewaylabs.specfold`, the existing executable name, user-data location and installer policy. It is intended to update the existing installation. It does not introduce a second permanent application or a new profile location. The unpacked build and isolated-profile launcher are QA assets only.

**The candidate is unsigned.** No progress in certificate/signing is claimed. Use ordinary Windows installation/security policy; do not bypass SmartScreen, UAC, endpoint protection or file permissions. An existing installation under a protected directory may require permissions this per-user, non-elevating installer cannot obtain; this preparation does not change ACLs or elevate it. The installer registry/elevation lifecycle is separate from the runtime profile test and must not be described as verified merely because the packaged app starts.

Before any real update: close Specfold normally, export a complete backup through the existing desktop backup action and retain a snapshot of its data directory while closed. Keep the verified 1.11.0 runtime/installer and the original backup outside the installer output. The app/profile/collection/environment identities and encrypted secret format remain unchanged. No real user profile is read or modified by the synthetic test suite.

## Rollback boundary

New no-code rule definitions are stored as metadata in their saved test setup. The older 1.11.0 workflow validator cannot interpret that extension. Do not claim a direct, lossless downgrade after using new features.

The tested rollback route is: close the candidate normally, restore the **pre-update** workspace/settings snapshot, then reopen with the verified 1.11.0 runtime. The encrypted values remain encrypted and decrypt under the same Windows user. Collections, environments, old setup/authentication and settings from that snapshot must match. No HTTP request is needed for this check. Snapshot rollback restores a point in time; changes made after the snapshot are not included. Export current work separately before any actual rollback.

Native installer execution against the production installation has not occurred. Isolated runtime/profile upgrade and snapshot rollback are tested separately from NSIS registry registration and protected-directory replacement. The installed 1.11.0 stays untouched.

## New feature boundaries

- **Synthetic JSON test data** is in the request's Body tab. An integer seed yields repeatable local drafts for supported constraints; examples/defaults and string/numeric/structured enums or constants are not copied (they may contain identifiers or private data). Credential/personal fields are omitted or block generation if required. Review and explicit apply replace only that request's body. Generated data is not silently promoted to documented guided-test evidence. Formats, patterns, unions and complex schemas may require manual input.
- **No-code response rules** are in workflow Authentication. Add a request-specific JSON-pointer rule, review it, then Save & preview. Supported rules: exists, type, numeric range and number/boolean/null equality. No scripts, arbitrary regex, string constants or sensitive-field paths. Rules run only inside the existing one-use approved workflow. Non-JSON, truncated or oversized content blocks rule evaluation. Rule assertion text omits actual/expected values and field paths; persistent summaries retain only opaque rule identity/outcome. Existing full reports may still include separately masked response content; explicit full-report export remains a different action from saving a safe summary.
- **Contract changes** appear in safe re-import preview: supported request/response variance, required inputs, enum/type/size restrictions, operations, media/status and declared authentication. Unsupported keywords, refs, serialization changes and missing inherited-security evidence are unknown. No remote refs are fetched. Safe merge retains requests rather than deleting removed operations. If shared component definitions changed and the safe merge retained older metadata, future semantic comparisons require a fresh baseline; uncertainty is persisted explicitly. No full OpenAPI compatibility or historical run equivalence is claimed.
- Apinizer management discovery remains unimplemented until an actual verified contract and authorized access are supplied. The existing optional issuer preset is unchanged.

## Verification

Use one worker and sequential builds. Tests use only temporary synthetic profiles and loopback mocks. Include full core/agent/desktop suites, schema/rule privacy tests, packaged token/scenario/rule/draft/contract journeys, and an explicit 1.11.0-to-candidate-to-snapshot-rollback test. Record exact results beside candidate `manifest.json` and keep the production installation unchanged.
