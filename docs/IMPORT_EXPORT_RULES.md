# Import And Export Rules

## Import

- JSON parse is attempted first; YAML parse is attempted if JSON parsing fails.
- OpenAPI 3.0 and 3.1 are accepted.
- Swagger 2.0 is accepted at a basic level.
- Postman Collection v2.0/v2.1 JSON and schema v3 multi-file YAML folders are accepted.
- `.http` and `.rest` files accept request lines, headers, inline query values, bodies, `###` separators, `@name`, and file variables. Executable scripts and file-backed bodies are not run.
- Local `$ref` values are resolved where practical.
- Remote `$ref` values are preserved but not fetched.
- Operations are grouped by tags, first path segment, or a single folder.
- Imported request URLs use `{{baseUrl}}` plus the OpenAPI path.
- Query, path, and header parameters become editable key/value rows.
- JSON request bodies use examples when present, otherwise a simple schema-derived example.
- Simple bearer, basic, and API key auth are mapped to internal auth settings.

## Export

- OpenAPI exports target version `3.0.3`.
- Folder names become tags when the UI option is enabled.
- Selected folders are exported recursively.
- Query, path, and header rows become OpenAPI parameters.
- JSON bodies become `requestBody` content.
- Response examples are included when enabled.
- Bearer auth becomes `components.securitySchemes.BearerAuth`.
- Basic and API key auth are represented when present.
- Imported components are retained in MVP; unused component removal is planned later.
- Collection JSON preserves the internal collection model.
- Complete backup JSON preserves the workspace and application settings. It includes readable environment secret values only after an explicit warning.
