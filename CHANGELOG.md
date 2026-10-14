# Changelog

## 1.11.0

- Optional bundled local MCP integration with masked inspection, revision-bound previews, desktop review and separately approved execution.
- Guided Connection → Authentication → Test preview → Results workflow, saved reference-only profiles and masked status/schema reports.
- Generic authentication plus an optional Apinizer issuer preset: fresh token per approved run, no local JWT signing, automatic 401 retry or management-project discovery.
- API-key masking, isolated TLS verification, JWT capture preserving pending editor changes, cancellation/disconnect handling and authenticated expired-plan cleanup.
- SemVer update comparison and matching manifest, lockfile, dependency and tag gates; synthetic legacy-data upgrade/backup/restore coverage.

See [release notes](docs/RELEASE_NOTES_v1.11.0.md) for installation, validation and scope. Earlier unpublished 1.10.0/dev.1 candidates are superseded; old dev.1 binaries need a one-time manual stable download.

## Earlier published releases

See [1.9.4](docs/RELEASE_NOTES_v1.9.4.md) and versioned release notes in docs.
