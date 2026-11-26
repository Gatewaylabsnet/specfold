# Specfold 1.13.0

## Added

- **Update schemas and keep request data:** choose an existing OpenAPI collection and the operations to refresh. Preview added or removed fields, required-property changes and effects on other operations using a shared schema. Saved payloads, URLs, auth, JWT flows and response examples are retained. Ordinary safe re-import is unchanged.
- **Reviewed MCP request edits:** `preview_request_update` and `preview_request_updates` propose a body change, actual HTTP header edits, or both, across up to 25 requests in one collection. JSON Pointer patches address JSON fields independently from HTTP headers. The same plan can include an explicit OpenAPI schema refresh.
- **One desktop review:** previews identify the edited scopes without returning raw payload values. The workspace revision must match. A stale request edit needs a fresh MCP preview. Shared schema impacts require explicit acknowledgement. Approved changes are recorded atomically after a local safety backup.

## Fixed

- Prevent an editor save from overwriting existing encrypted values when they cannot be unlocked. Reopen the workspace after secure storage is available.
- Export the refreshed source request body and its schema references instead of overlaying the preserved runtime payload as a source example.

## Known limitations

- Schema refresh supports local component references within the same OpenAPI 3.0 or 3.1 dialect. Unresolved or remote references and changed referenced non-schema components can block a refresh.
- Structural JSON edits cannot patch an encrypted body. Multipart edits are text-only and do not select, read or upload files. Sensitive inputs use existing secret references rather than literal credentials.
- Preview and apply do not send any API requests or fetch a JWT. The installed MCP helper and desktop must be from the updated build to use the new tools.

## Verification and upgrade

The regression suite includes an isolated MKK fixture that refreshes three OpenAPI operations, removes only the intended JSON fields, edits actual HTTP headers, and preserves Apinizer JWT and Bearer bindings. It verifies cancellation, stale revisions, rollback and persistence across desktop restart. The release workflow checks the eight public packages and checksum manifest, packaged Windows workflows, and upgrade/rollback in both Windows installer scopes.

Close Specfold and keep a complete backup and closed-app workspace snapshot before upgrading. The workspace and backup format versions are unchanged. Existing all-users Windows installations need an already elevated installer. Windows packages remain unsigned; macOS packages are not notarized. Download updates manually from the [release page](https://github.com/Gatewaylabsnet/specfold/releases/tag/v1.13.0).

See the [schema refresh guide](IMPORT_EXPORT_RULES.md#refresh-openapi-schemas-without-replacing-requests) and [MCP request edit examples](LOCAL_AGENT.md#edit-saved-request-bodies-and-http-headers).
