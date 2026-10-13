# Specfold local MCP server and CLI

Development source for the proposed [Specfold v1.10.0 release](../../docs/RELEASE_NOTES_v1.10.0.md). This private workspace package is **not published to npm** and is **not included in v1.9.4 desktop downloads**. v1.10.0 is not published yet. Do not use an `npx` install command for it.

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

Local checks and the Windows portable package's seven E2E scenarios pass. Candidate [9604df0](https://github.com/Gatewaylabsnet/specfold/commit/9604df07f8ebdad45f345f0e97c8fc8ce7c7224a) also passes [CI](https://github.com/Gatewaylabsnet/specfold/actions/runs/38371144773) and the [tagless multi-platform package gate](https://github.com/Gatewaylabsnet/specfold/actions/runs/38371138382); all eight downloaded [bundle](https://github.com/Gatewaylabsnet/specfold/actions/runs/38371138382/artifacts/11798414937) packages independently match their expected names and SHA-256 checksums. macOS/Linux GUI checks, actual vendor-client setup and the five-person usability pilot remain pending. [Draft PR #3](https://github.com/Gatewaylabsnet/specfold/pull/3) is not a published release. Read the recovery guide before manually removing either a profile writer lease or an agent state lease.

[Full setup, MCP configuration, CLI commands, tool list, limits, tests and recovery](../../docs/LOCAL_AGENT.md). Licensed under [Apache-2.0](../../LICENSE).
