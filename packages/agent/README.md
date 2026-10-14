# Specfold local MCP server and CLI

The bundled helper is included in published [Specfold v1.11.0](https://github.com/Gatewaylabsnet/specfold/releases/tag/v1.11.0). This private workspace package is **not published to npm**; do not use an `npx` install command for it. Packaged desktop users need no separate Node installation.

The local stdio server and CLI share one service and the existing core importer, safe re-import and request preparation logic. They support redacted inspection, OpenAPI previews/diffs, in-app human approval, bearer variable binding, Apinizer JWT recipes, collection validation, permission-controlled sends and redacted documentation context.

From the repository root, with Node.js >=22.19 and npm >=10:

```bash
npm ci
npm run agent:build
node packages/agent/dist/index.js help
npm run dev
node packages/agent/dist/index.js list --desktop --data-dir /absolute/path/to/sample-profile
```

For normal MCP setup, use **Settings → AI connections** in the updated desktop: enable, copy JSON/Codex TOML, test, and keep Specfold open. Packaged builds bundle the helper and use Electron's runtime; users need no separate Node installation. Use an isolated sample profile first. Only main writes; review and approve proposals in the app. AI connections and networking default off. Network permission is per request or selected-request session (15 minutes / 20 sends), revocable in Settings. Observed masked responses are available to an agent and the built-in documentation draft; untested requests are labeled.

Advanced CLI `--desktop` calls the same open-desktop service. Offline CLI approval/apply remains available with explicit flags and the desktop closed; its writer lease rejects competing mutations. No agent can approve itself.

The agent never decrypts stored secrets. Sensitive fields are masked heuristically; this is not a DLP guarantee or a sandbox for other tools an agent may possess. Same-OS-user trust applies, and an older desktop without the lease must not run concurrently against the same profile.

Typed API-key auth values and known literal credentials are masked even when a custom header/query name is unfamiliar. Agent sends always verify TLS independently of insecure desktop requests. Canceling a send or closing its MCP/IPC connection aborts pending consent and transport work; remote effects already performed cannot be rolled back. JWT capture merges only the unchanged token variable into the editor, retaining newer manual edits. At capacity, expired authenticated plans and their matching signed approvals are reclaimed under a separate state lease; receipts and active plans remain.

Saved profiles support `list_connection_profiles`, `preview_test_plan`, `run_test_plan` and `get_test_report`. Native final approval authorizes one bounded sequential run. The optional Apinizer preset obtains a fresh issuer token for each approved run; no local JWT signing, automatic 401 retry or management-project discovery is added. See the [guided workflow usage guide](../../docs/guided-test-workflow.md).

[Final integrated CI](https://github.com/Gatewaylabsnet/specfold/actions/runs/38582615898) and the [tagged three-platform build](https://github.com/Gatewaylabsnet/specfold/actions/runs/38583387156) passed at `caf4cb486744c9ec614fb0a79fda93d401c3d57c`: 497 source tests, three version gates and nine packaged Windows E2E scenarios. All eight published package hashes match the checksum manifest and asset digests. macOS/Linux GUI, actual vendor-client setup and real gateway checks are not claimed; human testing is planned for October 15, 2026. Windows packages are unsigned, macOS packages are not notarized, and old dev.1 binaries require a one-time manual stable download. Read the recovery guide before manually removing either writer lease.

[Full setup, MCP configuration, CLI commands, tool list, limits, tests and recovery](../../docs/LOCAL_AGENT.md). Licensed under [Apache-2.0](../../LICENSE).
