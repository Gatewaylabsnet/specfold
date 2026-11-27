# Import And Export Rules

## Supported Imports

| Format | Input | Preserved |
| --- | --- | --- |
| OpenAPI 3.0/3.1 | JSON or YAML | Paths, operations, parameters, multipart bodies, responses, auth, components, servers |
| Swagger 2.0 | JSON or YAML | Paths, parameters, multipart `formData`, bodies, responses, security, host/basePath |
| Postman 2.0/2.1 | Collection JSON | Hierarchy, variables, auth, bodies, multipart placeholders, response examples |
| Postman 3 | Multi-file YAML folder | Definitions, hierarchy, requests, examples; scripts skipped |
| Insomnia 4/5 | Export JSON | Workspaces, folders, environments, auth, bodies, multipart placeholders, responses |
| HAR 1.2 | JSON | Requests, query/form values, multipart placeholders, headers, captured responses |
| HTTP files | `.http` / `.rest` | Variables, request lines, headers, inline bodies, named sections |
| Specfold | Collection JSON | Native collection model |
| cURL | Command text | Method, URL, headers, body, `-F/--form` fields, supported auth |

JSON detection runs before YAML/OpenAPI parsing. Unsupported JSON gets a format-specific message. Folder parent cycles are broken safely. Unknown HTTP methods, malformed entries, orphan examples, scripts, and file-backed bodies are skipped or warned about rather than executed.

Local `$ref` values are resolved where practical. Remote `$ref` values are retained but never fetched. Operations can be selected before import and grouped by tags, first path segment, or one folder.

Preview runs Import Doctor. Its warnings identify skipped, unsupported, or manual-completion items before the user imports; Preview never writes a collection. When a user explicitly chooses an existing collection as the import destination, safe re-import reports matched, added, and retained requests. It updates matches without deleting existing requests and retains their ID, auth, body, and saved examples.

OpenAPI diagnostics additionally warn about non-empty OAuth scopes on HTTP bearer schemes, schema/example type mismatches, and sensitive example data. Agent imports use these same warnings and redact credential-like/personal examples (including source metadata) before creating a signed plan. Desktop's ordinary import fidelity is unchanged; warnings are non-blocking. Neither import path executes requests or fetches remote references.

The optional [local agent](LOCAL_AGENT.md) accepts OpenAPI/Swagger JSON/YAML only, not arbitrary portable formats. Its mutation previews produce a diff and exact workspace revision. Applying requires human approval and a matching revision: through the desktop review when connected, or (for actions that support offline apply) from the CLI with the desktop closed. Auto-targeting repeated imports uses collection title/base URL and stable method/path identities; explicit collection ID selection is recommended after renaming or rerouting. No credential value or new environment is invented by the Apinizer recipe.

Multipart text values remain editable. File paths from imported OpenAPI/Swagger/Postman/Insomnia/HAR/cURL content are untrusted: only the base filename is retained as a disabled placeholder and the user must choose the file again through the native picker. Upload IDs, absolute paths, and file bytes are excluded from Collection JSON, OpenAPI, workspace persistence, and complete backups.

## Refresh OpenAPI Schemas Without Replacing Requests

In **Import → Update schemas and keep request data**, choose the existing OpenAPI collection, paste the new JSON/YAML or open a local file, select the saved requests, and choose **Preview schema update**. Review changed fields and required properties. If a changed shared schema also affects unselected requests, check the acknowledgement for the exact list before choosing **Apply schema update**. A newer workspace revision requires a new review. This flow does not require enabling AI connections, fetching a remote document, resolving credentials for a request, or sending network requests.

The update changes only source contract metadata, the selected requests' declared body schema/requiredness, and their reachable schema components. Saved payloads, form fields, routes, parameters, headers, auth, token flows, response examples, folders and environments are not overwritten. Conflicts are reported for review; this is not a full compatibility or input-validation verdict. New source operations are not imported and absent operations are not deleted. Unused definitions and security schemes are kept. An unselected request can see a changed shared definition once approved, but its inline source examples and its saved request data are not refreshed; select it explicitly if its source examples also need updating.

This mode supports at most 500 operations per collection/document, up to 4 MiB of source text, and the same OpenAPI 3.0 or 3.1 dialect as the collection. Ambiguous identities, unresolved references, external references or unsupported anchors/dynamic scopes prevent applying the update. A reachable new or changed non-schema component (such as a named request body or example) is not installed: keep that definition unchanged or inline it in the new source. Sensitive examples may be redacted before the signed plan is stored. The existing credential guard can block a write when saved credentials are still unprotected; fix the credential storage rather than bypassing the guard. Ordinary safe re-import does not change.

## URL And Environment Rules

- Every workspace has at least one environment; the final environment cannot be deleted.
- New collections copy the active environment `baseUrl`.
- Base URL precedence during request preparation is: absolute request URL, nearest folder, collection, then active environment.
- Nested folders inherit the nearest configured folder base URL; relative request paths are joined to the effective value.
- Folder access-token bindings are Specfold workspace metadata. Token values remain encrypted environment secrets; portable exports include a token only through the `{{variableName}}` references explicitly applied to requests.
- Automatic collection token bindings are local workspace metadata; standard collection exports do not carry the binding or generated secret. Explicit Auth references and the separately confirmed full backup retain their existing behavior.
- Imported OpenAPI servers and portable variables populate the relevant collection/environment fields.

## OpenAPI Export

- Public functions `exportCollectionToOpenApi`, `exportCollectionToOpenApiResult`, and `exportCollectionToOpenApiDocument` remain stable.
- Imported OpenAPI 3 operations prefer source-operation fidelity and overlay editable fields.
- A schema-refreshed request uses its new source body declaration, including an absent body, instead of reconstructing it from the retained request payload. With examples enabled, it uses the refreshed source body examples rather than inserting the saved payload. Referenced components needed by a refreshed operation are exported even if **Include all components** is off.
- Selected folders export recursively; folder names can become tags.
- Folder base URLs are emitted as OpenAPI operation-level `servers` when they differ from the collection server.
- Parameters, request bodies, responses, and supported security schemes are mapped back to OpenAPI.
- Multipart file fields export as `type: string, format: binary`; text fields export as string properties. Repeated/array fields and OpenAPI body/property required flags survive round trips. No local file reference or byte content is emitted.
- Literal examples are opt-in and secret-like values produce warnings.
- Unused component schemas are pruned by default for scoped exports.
- Duplicate method/path mappings and invalid variable paths/servers produce visible warnings.

## Portable Export

- **Specfold Collection JSON** is a full native collection document; it always includes the complete active collection.
- **Postman Collection v2.1 JSON** preserves collection/folder/request hierarchy, supported headers/auth/body modes, and a collection `baseUrl` variable when present.
- **HTTP file (`.http`)** emits request name comments, method/URL, enabled headers, bearer/API-key header auth, and supported JSON/raw/form bodies. Multipart file grants are intentionally not portable.
- All full-collection exports scan request auth, values, and response examples for likely literal secrets before saving or copying.

## Complete Backup

Backup is separate from collection/OpenAPI export. `specfold.backup.v1` contains workspace and settings, including readable secret values after an explicit warning. Restore accepts only that schema, caps input at 100 MB, validates structure, re-encrypts secrets before persistence, and rolls back on failure.
