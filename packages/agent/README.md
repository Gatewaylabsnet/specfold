# Specfold local MCP server and CLI

Development source preview for [Specfold](https://github.com/Gatewaylabsnet/specfold). This private workspace package is **not published to npm** and is **not included in v1.9.4 desktop downloads**. Do not use an `npx` install command for it.

The local stdio server and CLI share one service and the existing core importer, safe re-import and request preparation logic. They support redacted inspection, OpenAPI previews/diffs, in-app human approval, bearer variable binding, Apinizer JWT recipes, collection validation, permission-controlled sends and redacted documentation context.

From the repository root, with Node.js >=20.19 and npm >=10:

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

[Full setup, MCP configuration, CLI commands, tool list, limits, tests and recovery](../../docs/LOCAL_AGENT.md). Licensed under [Apache-2.0](../../LICENSE).
