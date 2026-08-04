# Specfold v1.9.0

## Added

- The Environment screen now includes a lightweight **Test connection** action. A reachable HTTP endpoint reports success even when it intentionally requires authentication or does not support `HEAD`.
- Responses can switch between **Raw JSON** and **Pretty JSON**, search response content, copy matching response text, and copy error details without selecting text manually.
- Frequently used requests can be pinned to the top of their folder. The global request search shortcut is **Ctrl/Cmd+K**.
- Import completion now reports the number of imported requests and folders.
- Settings show the local data location, automatic safety-backup information, and an **Open data folder** action.
- A concise first-run guide explains the import, route, and send workflow.

## Changed

- Environment base URLs are now edited only in **Environment**. Changing an environment default never replaces a collection or folder override.
- The Base URL routing view makes the scope explicit: an environment default, a collection override, or the nearest folder override. This keeps separate proxy routes isolated in one collection.
- Request and response workflows retain their adjustable horizontal layout and response text-size controls while adding a clearer response inspection path.
- Production TypeScript, TSX, and CSS source files remain under the repository's 500-line source-size limit.

## Security

- Connection testing reuses the configured timeout, proxy, and TLS settings and does not persist credentials or response content.
- Local data and backup locations are exposed only through an explicit user action in Settings.
- Automatic update downloads and installation remain intentionally excluded; update checks link to GitHub Releases.

## Known limitations

- Release packages are not yet code-signed, and macOS packages are not notarized.
- Install v1.9.0 manually from GitHub Releases after verifying the published checksum.
- SOCKS proxies, browser-based OAuth login, remote `$ref` fetching, and imported script execution are not included.

## Verification

- Source-size checks, ESLint, typecheck, 173 automated tests, production build, platform packages, and SHA-256 checksums must pass on the final release commit.
