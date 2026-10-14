# Specfold v1.11.0-dev.1 - Development draft

This development candidate adds a guided API test workflow on top of the separate v1.10.0 MCP readiness candidate. It is prepared for a draft pull request; no release, tag, merge or deployment is authorized for this scope.

## Added

- **Test workflow** with four steps: Connection, Authentication, Test preview and Results. Advanced variable references stay collapsed until needed; the existing request editor remains available.
- Saved reference-only connection profiles for an OpenAPI file, URL or existing collection. Importing a source creates a new collection and preserves existing requests. Authentication defaults use profile-specific variable names.
- Generic no-auth, bearer, basic and header/query API-key authentication, plus an optional Apinizer password-grant preset with a configurable issuer endpoint and optional client-secret reference. Credentials are entered only in desktop password fields and saved through OS secure storage.
- Input provenance checks against documented examples/defaults. Generated, missing, edited, sensitive or unsupported inputs are skipped with reasons. Required body inputs cannot become input-free tests by changing the saved body mode.
- Saved, expiring test previews; explicit selection of operations that may change data; native approval showing the actual destinations and issuer endpoint. Runs are sequential and limited to 20 sends including authentication, with strict TLS, no redirects and no retries.
- Separate status and supported JSON-schema assertions, distinct passed/failed/skipped/blocked results, masked bounded response snippets, run IDs and user-controlled JSON export. The last ten reports remain in memory, including canceled runs.
- Four MCP tools using saved IDs: `list_connection_profiles`, `preview_test_plan`, `run_test_plan` and `get_test_report`. Agent runs retain the existing opt-in network permissions and cannot approve their own runs.

## Validation

- 435 local unit/integration tests passed: core 220, agent 52, desktop 163. All ran sequentially with one worker and a 2 GiB Node heap cap.
- Nine packaged Windows E2E tests passed, including the four-step UI, synthetic issuer authentication, explicit POST/native consent, response assertion failures, credential encryption/masking, export, MCP cancellation/disconnect and existing desktop regressions.
- Lint, typecheck, source-size checks, core build, helper/desktop build and Windows portable packaging passed. Production dependency audit: zero vulnerabilities.
- Manifests, lockfile, packaged app and MCP helper use `1.11.0-dev.1`; the packaged helper matches the built bundle. The portable test build is unsigned.

Only loopback synthetic APIs and synthetic credentials were used. Real gateway behavior and macOS/Linux packaging are unverified for this development scope. The v1.10.0 candidate's existing multi-platform evidence remains separate. No release, tag, merge or deployment occurred.

## Scope limits

The Apinizer preset obtains an `access_token` from a configured issuer; it does not sign JWTs or discover projects through a management API. A real management connector requires the actual API contract. No production account, API key or API endpoint was used for development verification.

Schema validation supports a bounded subset. Unsupported composition, `pattern`, `format`, unresolved references and truncated bodies are explicitly blocked; a status-only pass does not prove response shape or business correctness. Multipart/files and unsupported form bodies require manual testing. Inline URL query inputs require documented query-parameter provenance before guided execution.

Canceling stops the client and subsequent sends but cannot undo server-side work. Reports are in-memory history with bounded masked snippets; export them before closing if they need to be retained. Redaction is heuristic, so exported API data still requires review before sharing.

See the [guided workflow guide](guided-test-workflow.md) and [MCP setup](LOCAL_AGENT.md).
