# Specfold 1.12.0-dev.1 — reviewed API testing (prerelease)

This prerelease adds reviewed token binding, reusable test selections and content-free history, local synthetic JSON drafts, declarative response rules and supported-subset OpenAPI differences. Stable **1.11.0 remains the latest stable release**. This is a test channel, not a claim of complete OpenAPI compatibility or production installer validation.

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

## Windows update and rollback

**Windows packages are unsigned.** No signing certificate was created. Use ordinary Windows security policy; do not bypass SmartScreen/UAC, endpoint protection or filesystem permissions.

The installer retains the Specfold product name, `net.gatewaylabs.specfold` AppId and existing installation identity. On the verified test machine the existing all-users registration is `836d1068-ee73-544e-8774-8b0d0e92cf99`, targeting `C:\Program Files\Specfold`; the candidate derives the same GUID. It is intended to update the existing installation, not install a second permanent app. Normal permissions for the existing directory still apply.

Before a real update, close Specfold normally and retain a complete backup plus a closed-app workspace/settings snapshot. Isolated tests opened the same synthetic 1.11.0 profile with the candidate and restored its pre-update snapshot using 1.11.0 again. Collections, settings, setup identity and encrypted credential values were preserved. The real installed binary and user profile were not modified.

Older 1.11.0 workflow validators cannot interpret new rule definitions. The validated rollback is **pre-update snapshot restoration while closed**, followed by the verified 1.11.0 runtime. It restores that point in time and does not include subsequent edits. Native NSIS registry/elevation installation was not executed against the production installation; runtime/profile tests do not claim that validation.

## Verification and boundaries

Local verification: **233 core + 55 agent + 262 desktop tests**, three version-gate tests, all-workspace typecheck/build, lint/source-size/diff checks. Packaged Windows E2E covers token privacy, scenario restart, rules, synthetic draft/contract preview, MCP approval/cancellation and 1.11.0 profile upgrade/snapshot rollback. Tests use only temporary synthetic profiles and loopback APIs.

The intermittent permission-save failure was reproduced with the correct new value reaching the main process, followed by Windows EPERM during atomic replacement. After the fix, 30 diagnostic repetitions passed; three actual EPERM events recovered through the bounded retry. Temporary diagnostics were removed before final packaging. The final package passed all 12 local scenarios three times (36 passes), including isolated upgrade/snapshot rollback, with the original permission gestures and checks unchanged.

The NSIS payload's EXE, ASAR and helper were extracted without installation and matched the tested runtime's SHA-256 hashes. Local installer/application Authenticode status was `NotSigned`. Publication uses the existing GitHub workflow: platform builds/tests, Windows packaged checks, verified asset set/checksums and a draft release. Consult the actual Actions/release status for remote results; local numbers are not a substitute for remote CI.

Not claimed: native installer registry/elevation lifecycle, macOS/Linux interactive GUI/keychain testing, vendor-client UI certification, full schema/contract conformance, synthetic guided-input approval, string rule constants, automatic retries, or Apinizer management discovery. Apinizer discovery still requires an actual verified contract and authorized access.

See [guided workflow](guided-test-workflow.md), [development plan](LOCAL_TESTING_DEVELOPMENT_PLAN.md), [update/rollback record](LOCAL_UPDATE_CANDIDATE.md), and [MCP setup](LOCAL_AGENT.md).
