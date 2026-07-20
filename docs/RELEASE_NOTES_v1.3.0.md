# Specfold v1.3.0

## Added

- `multipart/form-data` body editing with text fields, file fields, repeated field names, and native file selection.
- Session-only upload grants for local files. Specfold sends selected files without storing file paths, file bytes, or upload tokens in the workspace.
- Safe multipart imports for OpenAPI, Swagger, Postman, Insomnia, HAR, and cURL sources.
- cURL import/export support for `-F`, `--form`, and `--form-string` fields.

## Changed

- Multipart requests let `fetch` generate the `Content-Type` boundary automatically and remove conflicting manual `Content-Type` or `Content-Length` headers before send.
- OpenAPI import prefers multipart file content over JSON alternatives when an operation offers both.
- OpenAPI export maps file fields to `type: string` and `format: binary`, preserving repeated fields as arrays where applicable.

## Security

- Imported file fields are disabled placeholders until the user explicitly selects a local file.
- Upload files are capped at 200 parts, 50 files, and 100 MB of file and text content per request.
- File selections expire with the app session and are cleared on restore, delete-all, reload, or renderer teardown.
- Collection JSON, OpenAPI exports, backups, copied cURL commands, and saved workspaces strip transient upload IDs and local paths.

## Known Limitations

- Windows packages may trigger SmartScreen while code signing is pending.
- macOS packages are not signed or notarized and may trigger Gatekeeper prompts.
- Auto-update is not included; install new versions manually from GitHub Releases.
- Selected files must be chosen again after an app restart, backup restore, or collection import.
