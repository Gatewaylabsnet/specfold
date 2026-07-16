# Specfold v1.1.0

## Added

- Postman Collection v2.0/v2.1 JSON and Postman v3 multi-file YAML folder imports.
- Insomnia v4/v5, HAR 1.2, and `.http`/`.rest` imports.
- Operation selection before import and URL-based document import.
- Renameable default `Specfold` environment with final-environment protection.
- Complete backup export, validated restore with safety copy, and full local-data deletion.
- SHA-256 checksum file for all release packages.

## Changed

- Application, Electron, tree, styles, importer, and OpenAPI exporter modules are split into production files below 500 lines.
- IPC types are shared by main, preload, and renderer.
- Release packages can be built and verified manually without first creating a tag.
- Public release assets exclude builder debug/updater metadata and blockmaps.

## Security

- Secret values are never written in plaintext when Electron secure storage is unavailable; a persistent warning reports the condition.
- Restore accepts only `specfold.backup.v1`, caps input at 100 MB, validates structure, re-encrypts secrets, and rolls back on partial failure.
- Postman folder traversal skips symlinks and scripts and enforces depth, file-count, and byte limits.
- Complete backup files use restrictive permissions where supported and still require explicit secret-disclosure confirmation.

## Known limitations

- Windows packages are unsigned and may trigger SmartScreen.
- macOS packages are unsigned and not notarized, so Gatekeeper prompts may appear.
- Complete backups intentionally contain readable secret values.
- Auto-update, SOCKS proxies, remote `$ref` fetching, and imported script execution are not included.
