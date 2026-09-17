# Specfold v1.9.4

## Fixed

- Selecting a folder or request found under a different collection now activates its owning collection before editing, duplicating, deleting, or sending it. Actions no longer target the previously active collection.
- Folder selection now opens a focused empty state with **New request**, **JWT request**, **Duplicate folder**, and **Delete folder** actions, so an empty folder remains useful without navigating elsewhere.
- Tree-row rename, duplicate, pin, and delete controls no longer begin a drag or re-select the row. Their accessible labels and item-specific tooltips make the actions clearer.
- Selected tree rows retain a clear visual state, and deep tree indentation uses a scoped CSS value so the request tree stays aligned at narrow widths.

## Quality

- Added renderer coverage for deleting a newly created folder, selecting and deleting a searched folder in a different collection, collection collapse, nested folder search, and folder row actions.
- Retained the existing local-first model: no account, cloud workspace, telemetry, or automatic update installation was added.

## Known limitations

- Packages are not code-signed or macOS-notarized yet.
- Automatic download and installation of updates is not implemented; use **Help -> Check for Updates** to open the release page.
