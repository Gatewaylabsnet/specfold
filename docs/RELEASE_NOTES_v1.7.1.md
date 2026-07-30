# Specfold v1.7.1

## Changed

- About now opens from the application top bar instead of occupying space in Settings.
- The About experience is an accessible dialog with a close button, backdrop close, Escape-key support, and initial keyboard focus.
- Settings can now use up to 960 px of content width and still collapses to a single responsive column on narrow windows.
- Product version, platform, architecture, license, release links, download links, and manual update checks remain available in About.

## Security

- Update checks remain read-only GitHub Release metadata requests.
- Automatic package downloads, installer launches, and update installation are not included.
- External links continue to be opened through the main process and are limited to `http` and `https`.

## Known limitations

- Release packages are not yet code-signed, and macOS packages are not notarized.
- Install v1.7.1 manually from GitHub Releases after verifying the published checksum.
- SOCKS proxies and browser-based OAuth login are not included.

## Verification

- Source-size checks, typecheck, automated tests, production build, platform packages, and SHA-256 checksums must pass on the final release commit.
