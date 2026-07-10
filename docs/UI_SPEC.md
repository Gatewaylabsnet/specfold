# UI Spec

## Home

Shows workspace totals and quick actions for import, collection creation, JWT template creation, and opening the editor.

## Import

Provides a paste area, grouping strategy controls, preview, and import action. The importer detects JSON/YAML and OpenAPI/Swagger automatically.

## Editor

- Left sidebar: collections, folders, and requests.
- Center: method, URL, request name, move-to-folder control, and tabs for Params, Auth, Headers, and Body.
- Right: response status, timing, size, headers, and body.

## Environments

Users can create, rename, delete, and select environments. Variables use `{{variableName}}` syntax and can be marked secret for masked editing.

## Export

Users can choose OpenAPI YAML, OpenAPI JSON, or Collection JSON; choose whole collection or selected folders; preview generated output; and save through a native file dialog.

