# Specfold v1.2.0

## Added

- Folder-scoped base URLs for collections that route different folders through different API gateways or proxies.
- Nearest-parent inheritance for nested folder base URLs, with direct editing from the collection tree.
- An Apinizer JWT request workflow that derives the authentication base URL from the collection API origin when possible.

## Changed

- Request URL resolution now follows: absolute request URL, nearest folder base URL, collection base URL, then environment base URL.
- OpenAPI export resolves folder-specific routing without mixing base URLs from unrelated folders.
- Base URL documentation now covers collection, folder, environment, and Apinizer precedence behavior.

## Security

- Existing local-first storage and encrypted secret handling remain unchanged.
- Release checksums are published in `SHA256SUMS.txt`; packages remain unsigned while the SignPath Foundation application is pending.

## Known limitations

- Windows packages may trigger SmartScreen while code signing is pending.
- macOS packages are not signed or notarized and may trigger Gatekeeper prompts.
- Auto-update is not included; install new versions manually from GitHub Releases.
- SOCKS proxies are not supported.
