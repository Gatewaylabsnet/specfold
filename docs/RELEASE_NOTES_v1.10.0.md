# Specfold v1.10.0 — Draft

Status: release preparation, **not published**. Stable downloads remain [v1.9.4](https://github.com/Gatewaylabsnet/specfold/releases/tag/v1.9.4). These notes describe the current candidate and do not claim that a GitHub release, CI release bundle or verified public artifacts exist yet.

## Added

- Optional local MCP connection in **Settings → AI connections**, with copied JSON or Codex TOML configuration and a bundled-helper connection test. Keep Specfold open; packaged users need no separate Node installation.
- Twelve focused tools for redacted inspection, OpenAPI import previews, diffs, bearer-variable binding, Apinizer JWT recipes, validation, in-app review/status, controlled sends and documentation context. Agents cannot approve their own changes or read resolved secrets.
- Human review inside Specfold, stale-preview refresh/cancel, revision-bound signed plans and idempotent applies. Workspace writes remain owned by desktop main; the advanced offline CLI retains explicit interactive approval.
- Separate, default-off network permission: approve each request or selected requests for a session limited to 15 minutes or 20 sends. Session permission is bound to request definitions, routing and environment values, and can be revoked.
- Masked response observations and a documentation draft that distinguishes observed from untested behavior. Export requires human review; nothing is published automatically.

## Fixed during release review

- Literal values in typed API-key authentication are masked even when the header/query name is custom. Known bearer/basic/API-key literals are also scrubbed from reflected data; variable references remain usable.
- Agent requests retain certificate verification during simultaneous insecure desktop requests. Verified/insecure direct and proxy connections use separate pools instead of changing a process-wide TLS flag.
- Automatic encrypted JWT capture merges only an unchanged token variable into the current editor state. Pending request/environment edits survive, and a newer manual token edit, rename or removal wins.
- MCP cancellation, helper stdin closure and local IPC disconnect/timeout/shutdown cancel pending native consent and HTTP work. Cancellation is checked before send, token capture and observation recording; it cannot undo effects already performed by the remote API.
- The 128-plan limit no longer remains exhausted solely by expired signed plans. Bounded cleanup authenticates expired plans and matching approvals, preserves active plans and receipts, and never reclaims unrecognized or symlinked files. A separate agent state lease serializes previews and expiry; refreshed expired plans require new approval.

## Compatibility and setup

v1.10.0 is a minor release because it adds an optional user feature while keeping `workspace.json` schema version 1, native collections and `specfold.backup.v1` unchanged. Existing import/export workflows remain available, and both AI connection and network permissions default off. No account, model provider, cloud sync or automatic updater is added.

Source development requires **Node.js >=22.19 and npm >=10**, matching the existing Undici 8 dependency. The private agent package is not published to npm; do not install it through `npx`. Copy setup from the candidate desktop rather than guessing executable/profile paths. Windows portable configuration refers to that artifact's extracted runtime and must be copied again after replacement. See [complete setup, security boundaries and recovery](LOCAL_AGENT.md).

## Verification recorded for this preparation

| Check | Result |
| --- | --- |
| Source-size, lint, typecheck | Pass |
| Unit/renderer/agent tests | 263 pass: desktop 112, core 103, agent 48 |
| Production build | Pass |
| Source Electron/SDK scenarios | 3 pass, including the new credential/JWT/disconnect safety scenario |
| Windows portable v1.10.0 build | Pass; unsigned status verified |
| Packaged Windows regression/E2E | All 7 scenarios pass |
| Local package identity | ASAR, running Electron and MCP server report 1.10.0; 13 desktop output files and `agent.cjs` byte-match built source |
| Production dependency audit | `npm audit --omit=dev`: 0 vulnerabilities |
| Independent changed-source secret review | No real secrets found; only a synthetic TLS fixture key |
| CI and tagless Windows/macOS/Linux release bundle | Pending |
| Public artifact/commit identity and checksums | Pending |
| Actual Codex/other vendor-client UI setup | Pending |
| macOS/Linux GUI and five-person usability pilot | Pending |

Current local results must be tied to the final release commit and supplemented with multi-platform CI/public artifact checks before publication. The existing release workflow creates a **draft** only on a version tag; manual workflow runs verify packages without publishing. No public v1.10.0 download links are asserted here.

## Known limitations

- Packages remain unsigned, and macOS packages are not notarized. Automatic update download/installation is unavailable.
- Masking is conservative and heuristic, not a general DLP guarantee. Same-OS-user trust applies; a cloud-backed MCP client may send returned API structure to its provider.
- An approved send can change remote data. Cancellation is not rollback, and uncertain remote outcomes need inspection before retry.
- After a crash, either `.specfold-writer.lock` or `.agent/.specfold-writer.lock` may require careful manual recovery. Never remove a live lease or the whole state directory to clear a busy error.
- Actual vendor-client UI checks, macOS/Linux GUI checks and the human pilot remain outstanding. Pilot targets are four of five people connecting without help and three returning within two weeks; automated tests are not adoption evidence.
