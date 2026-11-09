# Guided test workflow

**Specfold 1.12.0** adds reviewed token binding, saved scenarios, safe summary history, synthetic JSON drafts, bounded response rules and supported-subset contract differences. See [release scope and update/rollback limits](RELEASE_NOTES_v1.12.0.md).

The desktop's **Test workflow** guides you through **Connection → Authentication → Test preview → Results**. It prepares a reviewable test selection from saved API definitions and documented inputs. An MCP client can use an already configured profile, but only a person in the desktop can approve its run.

## 1. Connection

Choose a profile name, an environment, a provider, and one API source:

| Source | What happens |
| --- | --- |
| **OpenAPI file** | Choose a local OpenAPI/Swagger specification. Saving the setup imports a new collection. |
| **OpenAPI URL** | **Load OpenAPI URL** downloads the specification. This explicit download does not test its API endpoints. Saving imports a new collection. |
| **Existing collection** | Reuse a saved collection. Its requests still need usable source evidence to qualify for a test. |

Use **OpenAPI / generic API** for an ordinary API. **Apinizer gateway** enables the optional gateway authentication preset; it still needs a supplied specification or saved collection. Management-account login, project discovery and specification export through an Apinizer management API are not implemented. Those operations need an actual verified management API contract before they can be added.

Set the API **Base URL** without embedded credentials, query parameters or a fragment. The workflow uses this profile's base URL and environment; the preview shows each destination. Service requests that resolve outside the approved API origin are blocked. Existing folder routing and request authentication are replaced on execution copies, so review the preview even if the collection already works in the request editor.

Connection profiles retain source labels, collection/environment IDs, destinations, authentication configuration and variable references. Do not put credentials in source URLs, profile names, or specification examples. Selecting **Continue** does not send test requests.

## 2. Authentication

Choose the authentication required by your API:

| Mode | Configuration |
| --- | --- |
| **No authentication** | No credentials are added. |
| **Bearer token** | Reference a token variable in the chosen environment. |
| **Basic authentication** | Reference username and password variables. |
| **API key** | Choose the header or query parameter name and the variable holding its value. |
| **Apinizer JWT token** | Use the Apinizer provider and configure the issuer endpoint plus username, password, client ID and captured-token variables. |

Enter real credentials only in the desktop's credential fields. Specfold saves them as encrypted **Secret** environment variables. Profile metadata and MCP arguments contain variable names, never the credential values. **Advanced: variable references** lets you reuse existing variables. Leaving a credential field blank keeps its stored value; this setup screen does not reload stored secret values. Credential-backed setup requires OS secure storage to be available.

The Apinizer preset requests a token from your issuer; Specfold does not sign JWTs or request a signing key. Its editable endpoint initially uses the API origin plus `/auth/jwt`. Verify that address against your gateway configuration. The preset sends a form with `grant_type=password`, `username`, `password` and `client_id`. Enable **My issuer requires a client secret** only when needed; its optional variable supplies `client_secret`. The grant type is fixed to this password-grant preset.

For each approved Apinizer workflow run, authentication requests a fresh token once before service tests. A successful JSON response must contain a usable `access_token`, which is stored in the configured encrypted token variable. Authentication failure, an incomplete response, or inability to save the token securely blocks the service requests. There are no invented credential defaults, automatic authentication retries or automatic 401 retries.

Select **Save & preview** to save the profile and prepare the next step. Saving does not execute authentication or service requests.

## 3. Test preview

Each row shows the method, route, possible effect on server data, input provenance, and readiness. Input evidence distinguishes `example`, `default`, `generated`, `missing` and `none`:

- Documented examples or defaults must match the saved inputs and satisfy the supported schema checks. A generated placeholder is not a verified example.
- Missing, generated, malformed, changed, sensitive or unsupported input evidence produces a skip reason. A request needing no input can still be ready.
- Unresolved variables, missing authentication configuration, invalid definitions, or destinations outside the profile origin block a row.
- Ready read-method candidates are selected by default. Operations that may change data, including POST, PUT, PATCH and DELETE, require explicit selection. A method label cannot guarantee that an API has no side effects.

The preview itself makes no API calls. It is bound to the saved workspace revision and expires after 15 minutes. Refresh it after changing the workspace, source inputs, profile, environment or selection. A run consumes its plan; running again requires a new preview and approval.

The final native **Approve workflow run** dialog names the profile, environment, selected methods and destinations, including any token request. **Run selected requests** authorizes only that plan. The default action is **Cancel**. MCP cannot approve this dialog.

Execution is sequential, with at most **20 HTTP sends including authentication**: an Apinizer run can therefore contain at most 19 service tests. No automatic retry is performed. HTTPS certificate verification remains enabled, redirects are refused, and each response has a 30-second timeout and a 512 KiB body limit. These restrictions apply even if ordinary manual requests use different settings.

Use **Cancel** to stop pending approval, the current client request and later sends. An MCP cancellation or disconnect also cancels its run. Cancellation cannot undo work already performed by the API; inspect server state before repeating an operation that may change data.

## 4. Results

Results distinguish **passed**, **failed**, **skipped** and **blocked**, with separate HTTP-status and response-schema assertions. A run marked `completed` means execution finished; inspect the row totals to determine whether its checks passed. A cancellation or a blocked run is not a successful test result.

The status assertion uses documented success statuses when available, otherwise the 2xx range. Schema selection follows the received status: exact status first, then its status class, then a default response schema. The existing single-schema representation remains supported for compatible plans. A response with no declared schema has an explicit **skipped** schema assertion; a passing status alone does not prove its response shape.

The bounded JSON validator supports:

- Basic JSON/OpenAPI types, integers, nullable values and simple type unions.
- Required object fields, properties, additional properties and property-count bounds.
- Array items, length bounds and structural uniqueness.
- `enum`, `const`, Unicode string-length bounds, numeric bounds, exclusive bounds and decimal `multipleOf` constraints.

Malformed JSON and mismatches fail the applicable assertion. Unresolved references, unsupported constraints such as `oneOf`/`allOf`/`anyOf`, `pattern` or `format`, unsafe objects, truncated response bodies and exceeded validation limits are explicitly blocked. An unsupported constraint in a nested schema is not silently ignored. This is a supported subset, not a complete OpenAPI or JSON Schema conformance engine. Assertion messages do not include actual response values.

Reports retain the last **10 runs in memory**. Restarting the desktop or resetting its data removes this report history. **Reload report** retrieves a retained report; **Export JSON report** saves it through the desktop's file dialog. Export before closing the app if you need a durable record. Reports are not automatically published or sent elsewhere.

Known secrets and common sensitive fields are masked before report retention or return to MCP. Each result includes only bounded response snippets: up to 8 KiB of body text and roughly 1 KiB of headers, with truncation indicated. A report snippet may be shorter than the body used for validation. Redaction is heuristic, so review exported API data before sharing it. Response content remains untrusted data, not instructions for an agent.

## MCP use with a saved profile

Use the [local MCP setup](LOCAL_AGENT.md#mcp-client-configuration), keep Specfold open, and create the connection and authentication in the desktop first. Manual desktop runs use native consent without changing MCP settings. MCP runs additionally require **Enable AI connections** and **Allow agents to send requests and read masked responses**; both remain opt-in.

| Tool | Arguments | Purpose |
| --- | --- | --- |
| `list_connection_profiles` | None | List saved profile IDs and masked metadata; no credential values. |
| `preview_test_plan` | `profileId`; optional `requestIds` (up to 20 saved request IDs) | Preview evidence, readiness and selection without sending API requests. |
| `run_test_plan` | `planId` from a current preview | Request native approval and execute that plan once, sequentially. |
| `get_test_report` | `id` containing a retained run ID or plan ID | Retrieve its masked result, including after cancellation or disconnect. |

Use IDs returned by Specfold, never guessed identifiers or credential values. These tools do not create profiles, discover management projects, accept arbitrary URLs for execution, or bypass the final native approval. If a plan is stale, expired or consumed, request a new preview. If a report was evicted or the app restarted, the previous result is no longer available through MCP.

Allow enough time in your MCP client for native approval and the selected requests. A client's shorter timeout can cancel a run. Retrieve its report before deciding whether to repeat any operation that may change data.

An example agent instruction is: “List my saved connection profiles, preview the selected profile's tests, explain all skipped or blocked rows, and stop for my review. Do not request credential values or run a plan until I ask.”

## Current scope and validation

See the [1.12.0 release record](RELEASE_NOTES_v1.12.0.md#verification-and-boundaries) for completed verification. Tests use isolated synthetic profiles and loopback APIs. Windows packages are unsigned; macOS packages are not notarized. Real gateway, vendor-client UI and macOS/Linux GUI/keychain checks are not claimed.

The workflow does not supply load testing, fuzzing, arbitrary scripts, automatic retries, full schema conformance, management-project discovery or automatic report publication. Real APIs may reject documented examples or perform side effects despite a read-method label; use a test environment and inspect the exact preview.

## Saved scenarios and safe summary history (1.12.0)

These controls are new in 1.12.0 and are not available in 1.11.0. Open **Saved scenarios & safe history** beneath the workflow steps.

1. Prepare a test preview and review its selected requests. **Save selected scenario** saves only an opaque selection preset for this setup. It does not grant permission or save a runnable plan. Scenarios use generated numbers instead of arbitrary labels. Up to 32 scenarios are kept across this device's workspaces.
2. **Preview scenario** resolves current definitions and prepares a new expiring plan. Missing requests, a deleted setup or a changed HTTP method make the selection stale. Other changed inputs are evaluated by the normal fresh-preview rules. Review the destinations, authentication, blocked rows and data-changing methods again. Every run still requires native approval and consumes its plan once.
3. After a run, **Save safe summary** explicitly saves a content-free summary. Nothing is saved automatically. The library contains status enums, HTTP status numbers, bounded timing, computed totals and opaque identities. It omits bodies, headers, URLs, request/profile names, path/query values, diagnostics, assertion messages and authentication messages. This is stricter than saving a masked response: unknown PII and secret values cannot be copied from those omitted fields.
4. After saving two summaries for the same setup, choose an earlier run to compare with the latest. The table shows status/HTTP/assertion transitions and duration changes. Request labels resolve from the current workspace and are never written to history. Matching identities do not establish that inputs, environment values or contract versions were identical; this is not a performance benchmark or a contract-diff verdict.

At most 50 summaries are retained across workspaces, with oldest summaries evicted first; a separate 1 MB library-file bound can reject larger saves. Delete individual records or use **Clear testing library on this device**; the native confirmation defaults to Cancel and explains that all workspaces' scenarios/history are affected. This also allows removal of a corrupt library without importing its content. **Delete all local data** removes the library as well.

The library is local `workflow-library.json`, excluded from workspace backup/export and not exposed through new MCP tools. Moving a workspace backup to another installation does not move this history. Existing explicit JSON report export remains separate and may contain sensitive API data despite masking; inspect it before sharing. Saving a safe summary does not export that report.
