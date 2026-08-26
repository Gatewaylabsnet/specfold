# Specfold v1.9.3

## Fixed

- Requests that use the common `{{baseURL}}`, `{{base_url}}`, or `{{base-url}}` spelling now resolve through the same absolute-request, folder, collection, then environment precedence as `{{baseUrl}}`.
- The resolved-route preview no longer reports an alias as missing when the effective scoped base URL is available.
- Empty or unresolved JWT and token endpoint requests now show a direct action to focus the editable request URL, with route configuration guidance when needed.
- Selecting an already active collection name now toggles its expanded state, in addition to the existing arrow control.

## Quality

- Added core and renderer coverage for base URL aliases, scoped collection routing, token endpoint guidance, and collection-name collapse behavior.
- Added packaged Windows Electron end-to-end coverage for import, routing, multipart file upload, backup/restore, and confirmed data deletion.

## Known limitations

- Packages are not code-signed or macOS-notarized yet.
- Automatic download and installation of updates is not implemented; use **Help -> Check for Updates** to open the release page.
