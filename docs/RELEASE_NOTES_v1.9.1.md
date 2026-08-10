# Specfold v1.9.1

## Changed

- Postman and compatible source variables are no longer turned into a new environment automatically during import.
- The Import screen now offers **Import source variables as a new environment** for collections that need tokens, client IDs, or other reusable values.
- Choosing that option adds a separate source environment but keeps the currently active environment selected.
- Imported Postman `baseUrl` values continue to live at collection scope, so route resolution works without copying the value into an environment.
- Import completion explains when source variables were intentionally not added.

## Security

- Sensitive source variables are only written to the local environment store after the user explicitly opts in to importing them.

## Known limitations

- Release packages are not yet code-signed, and macOS packages are not notarized.
- Automatic download and installation of updates remain intentionally excluded.
- Imported scripts are not executed.

## Verification

- Source-size checks, ESLint, typecheck, the full automated test suite, production build, platform packages, and SHA-256 checksums pass on the final release commit.
