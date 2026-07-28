# Specfold v1.7.0

## Added

- Settings -> About now shows the installed Specfold version, platform, architecture, license, current release link, and download page.
- Manual update checking now compares the installed version with the latest GitHub Release and reports whether a newer version is available.
- Update results provide release notes and download links without downloading or installing anything automatically.

## Changed

- The main workspace header no longer repeats the Specfold logo and product name.
- The active environment selector is now a compact one-line control in the top bar.
- The About panel is now the dedicated place for product identity and version information.

## Security

- Update checks are read-only GitHub Release metadata requests.
- Automatic package download, automatic installer launch, and auto-update installation are intentionally not included.
- External links are opened through the main process and limited to `http` and `https` URLs.

## Known limitations

- Release packages are not yet code-signed, and macOS packages are not notarized.
- Automatic update download and installation are not included; install v1.7.0 manually from GitHub Releases.
- SOCKS proxies and browser-based OAuth login are not included.

## Verification

- Source-size checks, typecheck, automated tests, production build, platform packages, and SHA-256 checksums must pass on the final release commit.
