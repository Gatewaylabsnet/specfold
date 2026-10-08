# Specfold local MCP server and CLI

Development source preview for [Specfold](https://github.com/Gatewaylabsnet/specfold). This private workspace package is **not published to npm** and is **not included in v1.9.4 desktop downloads**. Do not use an `npx` install command for it.

The local stdio server and CLI share one service and the existing core importer, safe re-import and request preparation logic. They support redacted collection inspection, OpenAPI import previews/diffs, revision-bound human-approved apply, bearer variable binding, Apinizer JWT recipes, and collection validation.

From the repository root, with Node.js >=20.19 and npm >=10:

```bash
npm ci
npm run agent:build
node packages/agent/dist/index.js help
node packages/agent/dist/index.js list --data-dir /absolute/path/to/sample-profile
node packages/agent/dist/index.js mcp --data-dir /absolute/path/to/sample-profile
```

Select the exact saved profile path in the updated desktop's Settings. Use an isolated sample profile first. Writes and network access default to off. A desktop writer lease rejects concurrent mutation, and a human must approve the exact plan in an interactive terminal. Network execution separately requires the updated desktop, explicit opt-ins and confirmation for every request.

The agent never decrypts stored secrets. Sensitive fields are masked heuristically; this is not a DLP guarantee or a sandbox for other tools an agent may possess. Same-OS-user trust applies, and an older desktop without the lease must not run concurrently against the same profile.

[Full setup, MCP configuration, CLI commands, tool list, limits, tests and recovery](../../docs/LOCAL_AGENT.md). Licensed under [Apache-2.0](../../LICENSE).
