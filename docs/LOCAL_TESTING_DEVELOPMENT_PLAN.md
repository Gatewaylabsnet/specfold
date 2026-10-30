# Local testing development plan

Development on Specfold 1.11.0, base commit `3c7f42f1743720461c02001ec53b88578306ac5b`. Preserve the completed token-binding, contextual workflow and MCP explanation changes. The original local-only implementation scope excluded commit/push/publication; the user subsequently authorized those steps for the 1.12.0-dev.1 prerelease. No real service requests, new credentials, certificates or permissions are included. See [release notes](RELEASE_NOTES_v1.12.0-dev.1.md) for scope and verification.

Current local candidate: **1.12.0-dev.1**, retaining the existing Specfold application identity. The user's updated installation preference supersedes the earlier unpacked-only first deliverable: prepare an unsigned update installer, preserve user data, and verify runtime upgrade/backup rollback with synthetic profiles. Do not modify the production installation. See [candidate installation and rollback](LOCAL_UPDATE_CANDIDATE.md).

Phases 2-4 now have local implementations and focused tests. Synthetic generation is deliberately a manual-body draft helper: explicit apply does not bless generated values as specification evidence for guided sends. No-code rules support exists/type/range and number/boolean/null equality; string constants are excluded. Contract differences cover a bounded subset; unsupported constraints and incomplete/stale metadata remain unknown. Phase 5 remains blocked on contract/access evidence.

## Baseline capabilities and original gaps

| Area | Existing implementation | Gap to address |
| --- | --- | --- |
| Local candidate | Electron build, Windows packaging and isolated-profile E2E harness | A separately named, traceable candidate containing the uncommitted UX changes |
| Test scenarios | Saved connection profiles and editable request selections in expiring plans | Selection presets surviving restart; profiles already supply API/environment/auth references |
| History | Ten in-memory masked reports, explicit JSON export | Optional persistent summaries and bounded comparison without saving API content |
| Test data | Example/default provenance and schema checks; generated/missing inputs skipped | A reviewed synthetic-data draft helper; generated data must never become verified source evidence implicitly |
| Business rules | Status and supported response-schema assertions | Bounded declarative rules with explicit unsupported/blocked results |
| Contract differences | Safe re-import diff/merge exists | Semantic severity and explanations beyond a textual or operation-level change |
| Apinizer | Optional supplied-specification and JWT issuer preset | Management discovery has no verified contract or authorized access; do not invent endpoints |

## Phase 0: local candidate (first deliverable)

The first UX candidate retained version 1.11.0 and was packaged separately for QA using local Electron, `-p never` and blocked external download proxies. The subsequent 1.12.0-dev.1 candidate follows the user's updated preference for an unsigned installer updating the same Specfold identity. Record base commit, a source-content digest including untracked sources, and SHA-256 of installer/EXE/ASAR/helper. Do not include user profiles, workspace data or secrets. Test the packaged EXE using isolated temporary profiles and loopback mock APIs. Production installation stays unchanged during this preparation.

Acceptance: package starts; import/send/export, multipart file consent and backup/delete/restore regressions pass; helper can perform read-only MCP operations. Existing source safety tests remain green. Packaging/signature/platform limits are reported explicitly. An unpacked Windows candidate is acceptable before a distributable installer/portable launcher; do not call it installer-tested.

## Phase 1: saved scenarios and safe history (implement first)

### Selection scenarios

Save the selected request set of an existing test setup. Do not duplicate credentials, request bodies, URLs, headers, source examples, arbitrary labels, runnable plans or approvals. Persist opaque workspace/profile/request fingerprints with generated scenario numbers. The UI resolves current metadata from the current workspace only. Bound storage to 32 scenarios; allow deletion.

Opening a scenario resolves the saved setup and request IDs against current data, then calls the existing fresh-preview path. If any request/setup is missing, fail with a clear stale-selection error rather than selecting a partial or default set. Saving and opening a scenario sends no API requests. Review changed inputs, blocked rows, destinations and data-changing methods again. Running still consumes a plan and invokes the existing native consent dialog every time.

Acceptance: restart retains selection; outside-workspace scenarios are hidden; missing/deleted requests block reopening; no plan/revision/approval survives in storage; re-open generates a new plan; cancel, stale revision and consumed-plan protections continue to pass.

### Persistent summary history and comparison

Default is no persistent run history. Offer an explicit **Save safe summary** action after a run. Project reports into an allowlisted schema: opaque IDs, generated labels, validated timestamps, run/result/assertion status enums, HTTP status numbers, bounded durations and computed totals. Never persist request names, destinations, query/path values, bodies, headers, response samples, error messages, assertion messages, authentication messages or arbitrary text. This omits sensitive content instead of assuming masking detects every secret/PII value. Existing in-memory report and explicit report export retain their separate behavior and warnings.

Store at most 50 summaries atomically in a separate local library file, excluding it from normal workspace backups. Support deletion and clearing. **Delete all local data** must remove this file too. Validate bounded files on read; corrupt data must not silently overwrite or import arbitrary fields. No MCP tool receives new write/approval capability.

Compare only summaries from the same workspace and test setup, matching opaque request identities. Show status transitions, newly present/absent requests and duration changes. Explain that identical request IDs do not prove identical inputs, environment values or contract revisions. The comparison never executes, retries or approves a request.

Acceptance: adversarial response secrets, PII, URLs, header values and assertion/error strings never occur in persisted bytes; storage remains bounded; corrupt/oversized files fail safely; delete-all removes history; cross-setup comparison is rejected; source and packaged synthetic tests cover saving, restart/reload and fresh consent.

## Phase 2: synthetic test-data helper

Depends on Phase 1 selection and input-provenance rules. Start with deterministic local draft generation for supported primitive schema constraints, bounded nested objects/arrays and explicit seeds. No production sampling, AI/network calls or secrets. Explain unsupported schema constructs. Keep generated values marked generated until a person deliberately accepts them as test input; acceptance does not claim they came from the API specification.

Acceptance: repeatable output from seed, supported constraint validation, strict size/depth limits, sensitive-property defaults empty, no generation for credential fields, previewable edits, cancel leaves requests unchanged, and no send/permission change on generation. Existing example/default evidence keeps precedence.

## Phase 3: no-code business-rule checks

Depends on reviewed test inputs and summary statuses. Add a small typed rule model: field exists, primitive type, numeric range, equality to a reviewed non-secret constant. No scripts, eval, arbitrary regex, templates or dynamic remote lookup. Evaluate bounded parsed JSON locally during an already approved run. Persist only rule identifier and outcome in safe history, never actual/expected values or field paths. Handle unsupported, missing, truncated and non-JSON content explicitly.

Acceptance: clear rule preview, limits on count/depth/body, no credential comparison constant in metadata, deterministic evaluation, blocked is distinct from failed, no automatic retries, secret/PII fixtures absent from history, and stale rules require a fresh preview.

## Phase 4: meaningful OpenAPI contract differences

Build on existing import/diff infrastructure and supported schema parser. Add normalized operation identity and severity for removed operations, newly required inputs, narrowed types/enums/ranges, auth requirements and documented response changes. Distinguish breaking, additive and unknown/unsupported rather than pretending full OpenAPI compatibility. Keep local refs bounded; do not fetch external refs.

Acceptance: golden fixtures for parameter/body/status/schema/security changes, stable ordering independent of JSON formatting, explicit uncertainty for unsupported keywords, selected non-destructive merge, no implicit deletion and no network. Do not base runtime run-comparison claims on this until contract fingerprints are designed without hashing credential values.

## Phase 5: optional Apinizer discovery (blocked on evidence)

Requires a supplied actual management API contract, supported product/version details, approved access scope and explicit authorization. Review endpoints, pagination, project/API visibility, export formats and auth lifecycle before implementation. Keep management credentials separate from gateway issuer credentials and environments. First implementation should be read-only discovery and a reviewable import draft. No inferred endpoints, account login, credential collection or management requests in the present local-only work.

Acceptance after dependencies arrive: mocked contract tests, least-privilege scope, pagination/error/expiry coverage, redacted diagnostics, no credential persistence outside secure storage, reviewed import, and a separately authorized real-access smoke test.

## Verification and delivery policy

Run lint/typecheck, focused tests, full relevant suites and builds sequentially with one test worker and a bounded Node heap. Use only temporary user-data paths and loopback mocks. Keep the installed 1.11.0 and default profile untouched. Record candidate hashes, source base/digest, exact test counts and untested installer/portable/macOS/Linux/external-client paths. The 1.12.0-dev.1 local candidate version distinguishes the unsigned update from the installed stable binary; it does not authorize publication or a production installation.
