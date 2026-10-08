# Local agent integration

Status: implemented in the development source; **not included in the published v1.9.4 binaries**. No model, cloud API, telemetry, credential manager or automatic downloader is added. An MCP-capable local LLM/agent client can launch the stdio server. The CLI uses the same service and core operations.

## Architecture and compatibility

- `packages/core/src/agent`: pure proposal/merge, bearer-variable binding, Apinizer recipe, validation, OpenAPI diagnostics and redaction. Existing importer, safe re-import, traversal, factories and HTTP preparation are reused. Desktop OpenAPI previews use the same diagnostics.
- `packages/agent/src/service.ts`: signed, revision-bound plans, operator approvals and idempotent receipts. Both CLI and MCP call this service; neither implements its own import/merge logic.
- `packages/agent/src/repository.ts`: strict opaque disk snapshots, bounded reads, single-writer transactions and rollback. It never invokes `safeStorage` or decrypts stored credentials.
- `atomicFile.ts` and `workspaceLock.ts`: persistence primitive shared with desktop and a cooperative exclusive writer lease.
- Desktop main: owns the lifetime writer lease and the optional authenticated local network IPC endpoint. Only main resolves secrets through the existing `safeStorage` adapter and executes HTTP.

`workspace.json` stays at `schemaVersion: 1`; collections, environments, native exports and `specfold.backup.v1` keep their existing formats. Agent state is separate in the profile's `.agent` directory. There are no secrets or model configurations added to collections. Existing public importer/exporter names and desktop import behavior remain unchanged, apart from additional non-blocking OpenAPI warnings.

An agent sees the **last saved** snapshot, not unsaved editor state. A desktop lifetime lease blocks all agent workspace writes. This is intentionally a fail-closed single-writer solution, not a live-editing workspace bridge. Close desktop before applying a plan; reopen it afterward. Read/preview/validate operations are available while desktop is open. Do not run an older desktop version that lacks the writer lease against the same profile concurrently.

## Build and select a profile

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

## Preview, inspect, approve, apply

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

Generic stdio configuration; replace both paths with local absolute paths:

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
| `apply_plan` | Apply an exact human-approved plan with matching revision and writer lease |
| `validate_collection` | Missing variables and duplicate operation checks, not live API validation |
| `send_request` | Separate, default-off, desktop-mediated network request |

No generic filesystem, shell, export, secret-read, raw Authorization, model-download or remote-ref-fetch tool is exposed. For file previews, use the CLI's explicit `--file`; MCP accepts document text rather than unrestricted file paths. Treat imported descriptions/examples as untrusted data, never as agent instructions.

The transport uses the official [MCP TypeScript SDK stdio server](https://ts.sdk.modelcontextprotocol.io/server). The dependency is the maintained v1 SDK, with its exact resolved version in `package-lock.json`.

## Optional network execution

Network execution needs **all three**:

1. Operator launches CLI/MCP with `--allow-network`.
2. Updated desktop is open on the same profile and **Settings → Local agents → Allow local agents to request network access** is enabled. Default: off.
3. A human accepts the native **Send this request / Cancel** dialog for that individual request. Default and Escape action: Cancel.

```powershell
node packages/agent/dist/index.js send --data-dir "$data" --allow-network `
  --collection COLLECTION_ID --request REQUEST_ID
```

The agent passes IDs only. The desktop loads its own saved request/environment, resolves credentials internally, displays method and effective origin/path, and rechecks revision after consent. An authenticated named pipe (Windows) or Unix-domain socket (macOS/Linux) connects the same-user client; an ephemeral session capability is stored in a protected local file and never returned through MCP/CLI. Multiple pending sends are rejected. Redirects are refused, TLS verification stays enabled, timeout is capped at 30 seconds, and response body is capped at 512 KiB. Raw response bodies are not separately returned. This limit applies only to agent execution; normal desktop request settings remain unchanged.

Common credential fields, known secret values, resolved Authorization and TCKN/email/telephone-like data are masked before returning the result. HTTP failures expose a generic error, not a potentially sensitive transport exception. An approved request can modify remote server data: consent is not an API sandbox.

## Safety, backups, recovery and boundaries

- Agent responses, printable diffs and stored plan sources redact literal credential-like and personal example values. Reference strings such as `{{apinizerAuthAccessToken}}` remain usable. Ciphertext is not returned either.
- Agent writes preserve opaque `enc:v1:` values byte-for-byte and never decrypt or re-encrypt them. A workspace containing literal credentials is readable through redaction but cannot be mutated/backed up by the agent (`UNPROTECTED_SECRET`). Mark environment values as Secret, replace inline credentials with references, and save in desktop with OS encryption available first. The agent will not silently erase or copy those values.
- Before mutation, an owner-only `backups/agent-safety-*.workspace.json` snapshot is created. Workspace and receipt use the same atomic-file writer as the desktop. Receipt/write failure restores the exact pre-mutation bytes. Backups contain existing encrypted state, not resolved secrets. Reversible recovery: close every writer, retain the current file, copy a chosen safety snapshot back to `workspace.json`, then reopen desktop; old plans become stale. Do not mistake an encrypted safety snapshot for portable `specfold.backup.v1`.
- The existing desktop **Export backup** remains an explicitly confirmed, secret-inclusive user action. It is deliberately not exposed to the agent. Agent state/approval keys are not included in portable workspace backups.
- **Delete all data** also removes agent plans, approvals, receipts and the plan-signing key. Only the ephemeral live network bridge remains until desktop exits; its settings opt-in is reset to off with the other settings. Old plans cannot be used afterward.
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
| `npm test` | 207 passing tests: desktop 84, core 103, agent 20 |
| `npm run build` | Desktop, bundled CLI/MCP and core production builds pass |
| `npx playwright test -c apps/desktop/e2e/playwright.config.ts local-agent.spec.ts` | 1 passing actual-Electron acceptance test |

Automated scenarios cover 16 POST + JWT + bearer refs, repeat apply/re-import (including service restart), no import network calls, stale/mismatched revisions, corrupt/schema-invalid/non-UTF-8 workspace, missing/forged approval, modified plan, oversize source, desktop writer lease, competing writers, safety backup/receipt rollback, plaintext-secret write refusal, redacted replies/plans/errors, stdio MCP round trip, network off/cancel/revision checks, IPC authentication, real Windows `safeStorage` at-rest encryption, and one approved **localhost mock** HTTP request. Native dialog choices are simulated only inside the isolated E2E test. No production credential or personal record was used.

`npm audit --omit=dev` reports **0 vulnerabilities** after compatible lockfile updates to `fast-uri` 3.1.8 and `undici` 8.11.2. The full development/build dependency audit still reports 20 advisories (1 low, 11 moderate, 8 high). No force/major-version audit fix was applied. Successful feature tests are not a claim that every development-tool advisory or possible sensitive field is resolved; review the full dependency audit before a release.
