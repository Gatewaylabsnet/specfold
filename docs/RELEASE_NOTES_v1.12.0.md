# Specfold 1.12.0

Specfold 1.12.0 promotes reviewed API testing from the 1.12.0-dev.1 preview: reviewed token binding, reusable test selections and content-free history, local synthetic JSON drafts, declarative response rules and supported-subset OpenAPI differences.

## What changed

- Choose a JSON token field, preview the exact folder/collection requests affected, then explicitly confirm secure binding. Shared-variable overwrites outside the chosen scope are blocked. Credential values are not shown in the binding preview.
- Start the guided workflow from the selected collection/environment/authentication; keep a separate new-setup option. Advanced technical fields are collapsed. MCP setup separates bundled-helper self-test from external-client verification.
- Save request-selection scenarios. Reopening always creates a fresh expiring plan; every run consumes its plan and needs native consent again. Missing requests or changed HTTP methods invalidate saved selections.
- Save safe summaries only by explicit action. History excludes bodies, headers, URLs, names, diagnostics and rule definitions. Comparison shows request/status/assertion-outcome and timing differences without proving identical inputs or contracts. Storage is bounded and supports deletion/clearing.
- Generate seeded synthetic JSON drafts locally from supported schema constraints. No example/default or string/numeric enum/constant values are copied. Sensitive fields are omitted or block generation. Applying a reviewed draft changes only a manual request body; it does not promote generated values to documented guided-test evidence.
- Add bounded request-specific exists/type/range/number-boolean-null equality rules. No scripts, regex, string constants or sensitive paths. Inspect rule conditions in the fresh preview. Known-secret overlaps are blocked. Rule assertions omit values/paths; safe history keeps only opaque rule identity/outcome. Existing explicit full-report export may still contain masked API response content and must be reviewed before sharing.
- Inspect semantic contract changes during safe re-import. Supported evidence includes operations, required inputs, types/enums/bounds, response/media and declared authentication. Unsupported, unresolved or stale component evidence is marked unknown. Safe merge never deletes missing requests or sends API calls.
- Settings saves now occur outside React state updaters; old acknowledgements cannot overwrite newer explicit permission choices.
- Windows atomic file replacement retries temporary EPERM/EBUSY locks at most five times over 620 ms. Persistent failures preserve the previous destination and remain visible; no access rights or security settings are changed.

- Contract comparisons preserve annotation-like property and literal names; adding a constrained optional request property is compared against the previous additional-property policy rather than assumed compatible.

- Refresh the bundled Electron runtime to 43.8.7 and patch compatible HTTP, validation and transitive dependencies. The installed candidate's Electron version is checked, not inferred from the source manifest.

## Windows update and rollback

**Windows packages remain unsigned.** No signing certificate was created. The installer retains the Specfold name, `net.gatewaylabs.specfold` AppId, executable name and existing installation identity. It updates that installation rather than creating a second product.

Close Specfold normally before upgrading. Keep a complete backup and a closed-app snapshot of the data directory outside the installation directory. Backup exports may contain readable secrets; store them privately. Existing all-users installations in protected directories require an already elevated installer process. The unchanged installer does not elevate itself, bypass security warnings or change filesystem permissions.

The validated rollback design is to close Specfold, reinstall the verified 1.11.0 baseline and restore the **pre-update snapshot**, then reopen it. Older 1.11.0 workflow validators cannot interpret new rule definitions, so a direct lossless downgrade is not promised. Snapshot restoration returns to that point in time and excludes subsequent edits. Export current work separately before an actual rollback.

## Verification and boundaries

Local stable preparation passed 559 unit/integration tests (242 core, 55 agent, 262 desktop), three release-version tests, seven installer-guard/workflow tests, source-size, lint, typecheck and build.

Dependency verification: the production dependency audit reports zero known advisories, and the full audit reports no high/critical findings after runtime and compatible tooling updates. Sixteen development-tool findings remain: fifteen moderate dependency-chain entries from minimatch and one low esbuild Windows development-server advisory. These tools are not shipped in the application payload; the release does not claim a clean full-development audit. No forced major upgrade or audit-suggested toolchain downgrade is used.

Stable publication is gated on the full source suite, exact-commit CI, packaged Windows E2E, disposable Windows installer lifecycle checks, three-platform release builds, the expected eight assets and SHA-256 verification. Current run links and results are recorded in the GitHub release after verification. The existing user installation and real profile are not used as test fixtures.

Windows installer tests cover current-user and already elevated all-users contexts separately, using synthetic data only. They do not certify the interactive UAC/SmartScreen UI, every enterprise security policy or an automatic installer elevation flow. macOS/Linux builds and package inspection are distinct from interactive GUI/keychain tests; those interactive checks are not claimed. Windows remains unsigned and macOS is not notarized.

Other boundaries: external vendor-client certification, full schema/contract conformance, synthetic guided-input approval, string rule constants, automatic retries and Apinizer management discovery are not added. Apinizer discovery still requires an actual verified contract and authorized access.

See the [guided workflow](guided-test-workflow.md), [MCP setup](LOCAL_AGENT.md), and the [historical prerelease record](RELEASE_NOTES_v1.12.0-dev.1.md).
