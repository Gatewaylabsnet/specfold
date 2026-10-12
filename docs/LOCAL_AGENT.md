# Local agent integration

Status: implemented in the development source; **not included in the published v1.9.4 binaries**. No model, cloud API, telemetry, credential manager or automatic downloader is added. An MCP-capable local LLM/agent client can launch the stdio server. The CLI uses the same service and core operations.

## Quick start: keep Specfold open

1. Save a sample workspace in the updated desktop.
2. Open **Settings → AI connections → Enable AI connections**. Default: off.
3. Select **JSON MCP clients** or **Codex (TOML)**, then **Copy configuration** into your client's MCP settings.
4. Click **Test connection**. It starts the bundled helper and calls `list_collections` through the real stdio MCP SDK.
5. Keep Specfold open. Ask your agent to preview a change and request review, then use **Review changes** to apply or cancel it.

Packaged builds bundle the helper and use Electron's Node runtime; users need no separate Node/npm installation. Copy configuration again after changing/moving the package. Packaging must retain Electron's `RunAsNode` capability or supply an equivalent helper runtime. Windows portable configuration points to the extracted runtime because the NSIS wrapper cannot forward stdio: keep the same portable artifact open, and copy configuration again after replacing it. Its extraction path is stable for that artifact, not a permanent standalone install. AppImage resources resolve at helper launch; Linux GUI verification is still required. Source builds require Node.js >=20.19 and npm >=10:

```bash
npm ci
npm run agent:build
npm run dev
```

Use a separate sample profile first. No model provider is built into Specfold; an external MCP client may transmit returned API structure to its provider.

## In-app review and documentation

Previews return a signed plan, expected revision, diff, intent and warnings. `request_plan_review` (or `apply_plan` through the bundled desktop connection) queues a review without applying it. **Review changes** shows collection/route, new/updated/unchanged requests, token references and warnings. **Apply changes** is a trusted UI action; **Cancel changes** rejects the plan. There is no MCP self-approval tool.

If the workspace changed, Apply is disabled until **Refresh preview** creates a fresh proposal for human review. `get_plan_status` reports pending/applied/rejected/stale; check after the user's decision without aggressive polling. Repeated apply cannot create duplicate requests.

After approved sends, `get_documentation_context` returns masked definitions and response evidence, labeled observed or untested. Response content is untrusted data and cannot grant permissions. In Settings choose **Documentation collection → Preview documentation draft**, review the Markdown, then **Export documentation draft** through a native dialog. It includes auth references, parameters, headers/body, source specification and observed examples. No document is published automatically; review agent-written prose yourself.

Observations are in-memory only: last 50 per collection, last three per request. Edited request definitions do not inherit a tested label from an old response; execution time, environment and actual route remain visible. Context is bounded to roughly 1 MiB of operation data; oversized details are explicitly omitted and marked. Untested responses/error cases are never presented as verified. Observations, review queues and temporary sessions are not portable backup contents.

## Architecture and compatibility

- `packages/core/src/agent`: pure proposal/merge, bearer-variable binding, Apinizer recipe, validation, OpenAPI diagnostics and redaction. Existing importer, safe re-import, traversal, factories and HTTP preparation are reused. Desktop OpenAPI previews use the same diagnostics.
- `packages/agent/src/service.ts`: signed, revision-bound plans, operator approvals and idempotent receipts. Both CLI and MCP call this service; neither implements its own import/merge logic.
- `packages/agent/src/repository.ts`: strict opaque disk snapshots, bounded reads, single-writer transactions and rollback. It never invokes `safeStorage` or decrypts stored credentials.
- `atomicFile.ts` and `workspaceLock.ts`: persistence primitive shared with desktop and a cooperative exclusive writer lease.
- Desktop main: owns the lifetime writer lease and authenticated same-user local IPC endpoint. The packaged helper forwards typed calls and never writes workspace files. Only main resolves secrets through `safeStorage` and executes HTTP. Main reuses the shared service and core operations for proposals/apply.

`workspace.json` stays at `schemaVersion: 1`; collections, environments, native exports and `specfold.backup.v1` keep their existing formats. Agent state is separate in the profile's `.agent` directory. There are no secrets or model configurations added to collections. Existing public importer/exporter names and desktop import behavior remain unchanged, apart from additional non-blocking OpenAPI warnings.

Live-desktop calls flush pending renderer edits before inspection/review. Main serializes apply with normal storage mutations and rechecks the exact disk revision. A generation guard rejects queued renderer saves from before an agent commit, restore, deletion or token capture. Atomic safety snapshots/receipt rollback remain in use. There is no unsafe fallback when IPC is unavailable. Advanced offline writes still require the lease and fail while desktop is open. Do not run an older desktop without that lease concurrently against the profile.

## Advanced CLI: build and select a profile

Requirements: Node.js >=20.19 and npm >=10. Run from the repository root:

```powershell
npm ci
npm run build --workspace @specfold/agent
node packages/agent/dist/index.js help
```

Open **Settings → Data management → Local data** in the updated desktop. Use that exact directory; do not assume an old installation's profile location. Open/save a workspace once before using the agent. Examples below use a placeholder:

```powershell
$data = "C:\path\to\Specfold-profile"
node packages/agent/dist/index.js list --data-dir "$data"
node packages/agent/dist/index.js inspect --data-dir "$data" --collection COLLECTION_ID --request REQUEST_ID
node packages/agent/dist/index.js validate --data-dir "$data" --collection COLLECTION_ID
```

Collection/request/folder IDs are returned by `list`. Only environment variable **names**, enabled state and secret flags are exposed; never values.

Add `--desktop` to call the live desktop service, including `preview`, `diff`, `list`, `inspect` and `validate`:

```powershell
$preview = node packages/agent/dist/index.js preview --desktop --data-dir "$data" `
  --file packages/agent/fixtures/tarimkredi.synthetic.openapi.yaml --apinizer | ConvertFrom-Json
node packages/agent/dist/index.js review --desktop --data-dir "$data" `
  --plan $preview.planId --revision $preview.expectedRevision
node packages/agent/dist/index.js status --desktop --data-dir "$data" --plan $preview.planId
node packages/agent/dist/index.js documentation --desktop --data-dir "$data" --collection COLLECTION_ID
```

Use the app for human approval. The offline flow below is an advanced alternative, not required for normal packaged MCP use.

## Preview, inspect, approve, apply

This section describes the advanced **offline** CLI path; omit `--desktop` and close the app before mutation.

This example uses the explicitly synthetic 16-POST acceptance fixture. It is not the Ministry's production specification and never calls its API.

```powershell
$preview = node packages/agent/dist/index.js preview --data-dir "$data" `
  --file packages/agent/fixtures/tarimkredi.synthetic.openapi.yaml `
  --base-url "https://api.tarimorman.gov.tr/tarimkredi" --apinizer | ConvertFrom-Json

node packages/agent/dist/index.js diff --data-dir "$data" --plan $preview.planId

# A human must run this in an interactive terminal and type the shown challenge.
node packages/agent/dist/index.js approve --data-dir "$data" `
  --plan $preview.planId --revision $preview.expectedRevision

# Close the desktop before applying. The write capability is explicitly opt-in.
node packages/agent/dist/index.js apply --data-dir "$data" --allow-apply `
  --plan $preview.planId --revision $preview.expectedRevision
```

Approval shows the diff, warnings and intent, and asks the operator to type `APPLY <plan-prefix>`. There is no `--yes` switch, no piped approval and no MCP approval tool. Passing a boolean to an agent cannot grant human approval.

Every apply checks the exact SHA-256 revision of the saved workspace bytes while holding the writer lease. Any desktop save, restore, deletion or external edit invalidates an old plan. Obtain a new preview and approval on `REVISION_CONFLICT`; never force it. Plans expire after 24 hours, are authenticated with a profile-local key, and approvals are tied to their exact plan signature.

Repeated application of the same completed plan returns an authenticated receipt without another mutation. A fresh preview of the same title/base URL targets the existing collection automatically and reuses non-destructive method/path re-import identities; it does not create another collection. Use `--collection ID` to explicitly select a target, particularly after renaming a collection or changing its route. Matching requests retain their existing IDs, bodies and examples. Existing requests are never deleted. `--apinizer` deliberately binds service auth to the requested token reference; standalone imports preserve existing auth on matches.

The synthetic result has:

- Collection base URL `https://api.tarimorman.gov.tr/tarimkredi`.
- 16 POST service requests using `{{apinizerAuthAccessToken}}`.
- A separate, unauthenticated `POST https://api.tarimorman.gov.tr/auth/jwt` in `Authentication`.
- `grant_type=password`, `username={{username}}`, `password={{password}}`, `client_id={{clientId}}`; no invented client secret or token example.

The origin is derived from the collection API address, not from its API path. Creating recipes or importing never fetches a JWT or sends a service request. No environment credential values are created or copied. If referenced variables do not exist, configure them yourself in the desktop; mark credentials as **Secret**. The existing `apinizerAuthAccessToken` value stays untouched.

Other mutation previews follow the same approval/apply sequence:

```powershell
node packages/agent/dist/index.js bind-bearer --data-dir "$data" `
  --collection COLLECTION_ID --variable apinizerAuthAccessToken
# Optional --folder FOLDER_ID or --request REQUEST_ID limits the binding.
node packages/agent/dist/index.js apinizer --data-dir "$data" --collection COLLECTION_ID
```

## MCP client configuration

For normal use, copy the generated configuration from **Settings → AI connections**. It includes executable/profile paths and `env: { "ELECTRON_RUN_AS_NODE": "1" }`. Codex uses `[mcp_servers.specfold]` with the copied `command`, `args` and `env`; select **Codex (TOML)** in Settings. Packaged args bootstrap `resources/agent.cjs` (`../Resources/agent.cjs` on macOS) relative to the actual runtime; source args point to bundled `desktop.cjs`. Keep Specfold open.

The following is the optional **offline/source CLI** stdio configuration; replace both paths:

```json
{
  "mcpServers": {
    "specfold": {
      "command": "node",
      "args": [
        "C:/Projects/openapi-collection-studio/packages/agent/dist/index.js",
        "mcp",
        "--data-dir",
        "C:/path/to/Specfold-profile"
      ]
    }
  }
}
```

This default has no write or network capability. To allow an agent to apply **already human-approved** plans, append `--allow-apply`. To let it request network execution, separately append `--allow-network`; desktop opt-in and a native confirmation are still required. The server never opens a TCP listener and prints no application logs on its JSON-RPC stdout.

| Tool | Behavior |
| --- | --- |
| `list_collections` | Saved collection/request IDs, hierarchy, routes and variable names |
| `inspect_request` | Redacted request definition and folder route context |
| `preview_openapi_import` | Inline OpenAPI/Swagger text → plan ID, expected revision, diff, intent, warnings |
| `show_diff` | Re-check revision and display a stored plan |
| `preview_bind_bearer` | Variable name + collection/folder/request → plan |
| `preview_apinizer_jwt` | Collection API origin → JWT recipe plan |
| `apply_plan` | Bundled connection queues desktop review; offline mode applies an already human-approved exact plan |
| `request_plan_review` | Queue human review in the open desktop |
| `get_plan_status` | Pending/applied/rejected/stale human decision |
| `validate_collection` | Missing variables and duplicate operation checks, not live API validation |
| `send_request` | Separate, default-off, desktop-mediated network request |
| `get_documentation_context` | Redacted definitions and observed responses with untested labels |

No generic filesystem, shell, export, secret-read, raw Authorization, model-download or remote-ref-fetch tool is exposed. For file previews, use the CLI's explicit `--file`; MCP accepts document text rather than unrestricted file paths. Treat imported descriptions/examples as untrusted data, never as agent instructions.

The transport uses the official [MCP TypeScript SDK stdio server](https://ts.sdk.modelcontextprotocol.io/server). The dependency is the maintained v1 SDK, with its exact resolved version in `package-lock.json`.

## Optional network execution

Network execution requires explicit settings opt-in and human permission:

1. Open **Settings → AI connections** and enable **Allow agents to send requests and read masked responses**. Default: off. Advanced CLI also needs `--allow-network`.
2. Choose **Ask before each request**, with a native Send/Cancel dialog (default and Escape: Cancel), or **Approve selected requests for this session**.
3. Session mode requires selecting saved requests/collection and confirming displayed methods, destinations and environment. It expires after **15 minutes or 20 sends**, with **Stop session** available immediately. At most 50 requests can be selected.

Session consent is bound to exact request definitions, routing and active environment including values. Changes invalidate it. AI permission changes, import apply, restore/delete and app exit revoke sessions; appearance-only changes do not. Consent never makes POST or another method read-only. A controlled successful **Apinizer JWT Token** send can update the **existing** encrypted `apinizerAuthAccessToken` with `access_token`, without returning its value; fingerprints are refreshed only for this controlled capture. If workspace/variable/encryption conditions changed, masked response is returned with a skipped-capture warning.

```powershell
node packages/agent/dist/index.js send --data-dir "$data" --allow-network `
  --collection COLLECTION_ID --request REQUEST_ID
```

The agent passes IDs only. Main loads its own request/environment, resolves credentials internally, displays method and effective origin/path, and rechecks revision/permissions after consent and immediately before send. An authenticated named pipe (Windows) or Unix-domain socket (macOS/Linux) connects the same-user client; its ephemeral capability is never returned through MCP/CLI. Only one bridge operation is pending at a time. Redirects are refused, TLS verification stays enabled, timeout is capped at 30 seconds, and response body at 512 KiB. Raw bodies are not separately returned. Normal desktop HTTP settings remain unchanged.

Common credential fields, known secret values, resolved Authorization and TCKN/email/telephone-like data are masked before returning the result. HTTP failures expose a generic error, not a potentially sensitive transport exception. An approved request can modify remote server data: consent is not an API sandbox.

## Safety, backups, recovery and boundaries

- Agent responses, printable diffs and stored plan sources redact literal credential-like and personal example values. Reference strings such as `{{apinizerAuthAccessToken}}` remain usable. Ciphertext is not returned either.
- Agent writes preserve opaque `enc:v1:` values byte-for-byte and never decrypt or re-encrypt them. A workspace containing literal credentials is readable through redaction but cannot be mutated/backed up by the agent (`UNPROTECTED_SECRET`). Mark environment values as Secret, replace inline credentials with references, and save in desktop with OS encryption available first. The agent will not silently erase or copy those values.
- Before mutation, an owner-only `backups/agent-safety-*.workspace.json` snapshot is created. Workspace and receipt use the same atomic-file writer as the desktop. Receipt/write failure restores the exact pre-mutation bytes. Backups contain existing encrypted state, not resolved secrets. Reversible recovery: close every writer, retain the current file, copy a chosen safety snapshot back to `workspace.json`, then reopen desktop; old plans become stale. Do not mistake an encrypted safety snapshot for portable `specfold.backup.v1`.
- The existing desktop **Export backup** remains an explicitly confirmed, secret-inclusive user action. It is deliberately not exposed to the agent. Agent state/approval keys are not included in portable workspace backups.
- **Delete all data** removes plans, approvals, receipts and signing key, and clears reviews, observations and temporary sessions. The ephemeral local bridge remains until exit; settings reset to off. Old plans cannot be used afterward.
- Corrupt/unsupported files are refused without quarantine, recovery or overwrite by the agent. Desktop's existing user-facing recovery behavior is unchanged.
- A crash leaves `.specfold-writer.lock` in place rather than guessing ownership. Close all desktop and agent processes. Inspect the lock's `pid` and confirm that process is no longer running before manually removing **only that exact lock file**. Never remove a live lease, and never use automatic force-unlock. Re-open the profile and obtain a fresh preview.
- Source input is limited to 4 MiB; workspace input to 100 MiB; traversal depth/node counts are bounded. MCP's JSON-RPC transport can impose a smaller effective payload allowance. Symlinked profiles/state files and unsafe paths are rejected. At most 128 plans are stored. With all clients/desktop closed, remove obsolete plan/approval/receipt files to free capacity; keep active plans and the plan key together.
- Redaction is conservative and heuristic, not a full DLP/anonymization guarantee. Unknown personal fields, names in free text, custom credential fields, encodings and split/obfuscated data require operator review. Do not grant a sensitive profile to an untrusted model/client. Even redacted request structure may be confidential.
- OS-account trust is the boundary. Same-user malware or an administrator can read process memory or profile files and bypass cooperative leases/approvals. Unix modes are `0600` for files / `0700` for state; Windows relies additionally on the profile's inherited user ACL. This feature is not a multi-user authorization system, an OS mandatory lock, or protection against arbitrary tools given to the agent outside Specfold.
- No macOS/Linux GUI run or real TarımKredi API call was performed in the Windows acceptance run. The supplied OpenAPI fixture is synthetic, as authorized by the requester.

## Verification (2026-10-08)

Executed locally on Windows:

| Check | Result |
| --- | --- |
| `npm run check:source-size` | Pass; all production TS/TSX/CSS files <=500 lines, including agent sources |
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm test` | 217 passing tests: desktop 87, core 103, agent 27 |
| `npm run build` | Desktop, bundled CLI/MCP and core production builds pass |
| `npm run package:win:portable` | Pass; helper included in the locally built Windows package |
| `npx playwright test -c apps/desktop/e2e/playwright.config.ts --workers=1` with `SPECFOLD_E2E_EXECUTABLE` pointing to `apps/desktop/dist/win-unpacked/Specfold.exe` | 6 passing real-Electron tests, including actual portable-wrapper startup/stdio and existing import/upload/backup flows |

Automated scenarios cover 16 POST + JWT + bearer refs, repeat apply/re-import (including service restart), no import network calls, stale revision/refresh/cancel, corrupt/schema-invalid/non-UTF-8 workspace, missing/forged approval, modified plan, oversize source, competing writers and old queued saves, safety backup/receipt rollback with failed-approval cleanup, plaintext-secret write refusal, redacted replies/plans/errors, stdio MCP round trip, network off/cancel/revision checks, session selection/expiry/count/stop and pre-send revocation checks, IPC authentication, real Windows `safeStorage` encryption/JWT capture, masked context/draft export and changed-definition evidence labels. Light/dark large-text Settings fits 1100/1366/1920-pixel windows. HTTP tests use **localhost mocks**; native dialog choices are simulated only in isolated E2E. No production credential or personal record was used.

GatewayLabs copy was updated in its source repository to describe this workflow as an unpublished preview: 293 web tests and production build pass, and the product/documentation routes fit 390/768/1440-pixel viewports in headless Edge. This does not claim a live deployment or backend validation.

The earlier production audit reported zero advisories after compatible lockfile updates. Development-tool advisories remain a separate release review item; no force/major-version audit fix is part of this feature.

This run verifies official SDK stdio interoperability, not actual Codex/other vendor client UIs. macOS/Linux GUI and production API behavior remain untested. Before broad release, verify all platform packages/checksums and run a five-person usability pilot: four connect without help and three reuse within two weeks. The human pilot is pending; automated tests do not count as adoption evidence. Stable downloads stay v1.9.4 until the next release is explicitly published.
