# Specfold v1.6.0

## Added

- Compact, Default, and Large text-density preferences, persisted with the rest of the local application settings.
- A concise resolved-route summary that identifies the effective base URL and whether it came from the environment, collection, or nearest folder.

## Changed

- The request editor now sits above the response inspector so both use the full available width.
- Compact text density is the default for a clearer, denser desktop workspace.
- Base URL controls use a simpler two-part layout: editable scope and resolved route.

## Fixed

- Requests with an inherited base URL no longer report that `baseUrl` is missing when the value is supplied by their environment or folder hierarchy.
- Empty or whitespace-only collection base URLs no longer hide a valid environment base URL.
- Route previews always use the active request's real folder chain, even when another tree row was selected previously.

## Security

- No security model changes. Local-first storage, encrypted secret persistence where supported, and session-only upload grants remain unchanged.

## Known limitations

- Release packages are not yet code-signed, and macOS packages are not notarized.
- Auto-update is not included; install v1.6.0 manually from GitHub Releases.
- SOCKS proxies and browser-based OAuth login are not included.

## Verification

- Source-size checks, typecheck, 142 automated tests, production build, platform packages, and SHA-256 checksums must pass on the final release commit.
