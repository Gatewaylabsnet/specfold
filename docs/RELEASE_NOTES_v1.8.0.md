# Specfold v1.8.0

## Added

- Native File, Edit, View, Window, and Help menus expose Import, Export, Settings, About, update checks, documentation, and release notes.
- The request and response panels now use an accessible horizontal divider that supports pointer dragging, keyboard resizing, and double-click reset.
- Response body, header, and raw views have persistent A−/A+ text sizing from 11 px to 18 px.
- A response field can be saved as a folder access token. The value remains an encrypted environment secret while the folder stores only its variable name.
- Bearer requests can apply the nearest inherited folder token through **Use folder token**.

## Changed

- Import, Export, Environments, Settings, and About are lazy-loaded. The initial renderer bundle is split into focused application, React, icon, and core chunks.
- Storage validation was separated from persistence, and production source files remain below 500 lines.
- ESLint is now part of the local and CI release gate.
- Electron was updated to 43.2.0 and Undici to 8.9.0.
- README, architecture, product, UI, and import/export documentation now describe folder-scoped token workflows and the resizable editor.

## Security

- Packaged renderer assets use the bounded `specfold://app` protocol instead of `file://`.
- Renderer navigation and new windows are denied; permissions default to denied.
- IPC calls validate the trusted main frame and bound runtime payload shapes and sizes.
- External navigation is restricted to approved HTTPS GatewayLabs and GitHub destinations.
- Folder access-token variables are encrypted at rest even if their environment secret flag was manually disabled.
- Automatic update download and installation remain intentionally excluded.

## Known limitations

- Release packages are not yet code-signed, and macOS packages are not notarized.
- Install v1.8.0 manually from GitHub Releases after verifying the published checksum.
- SOCKS proxies, browser-based OAuth login, remote `$ref` fetching, and imported script execution are not included.

## Verification

- Source-size checks, ESLint, typecheck, 164 automated tests, production build, platform packages, and SHA-256 checksums must pass on the final release commit.
