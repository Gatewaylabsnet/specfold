# Specfold v1.9.2

## Fixed

- Added a direct **Manage** action beside the active environment selector and kept the Environments screen available from the sidebar.
- Environment profile operations now update only the changed profile instead of cloning a complete collection tree. This removes the visible stalls that could occur in workspaces with several large folders.
- Environment names, variables, and collection or folder base URLs retain a local edit draft and save on blur or Enter, rather than writing the workspace on every keystroke.
- **Delete all data** now displays progress and invalidates queued or in-flight renderer saves before deleting local content. A late save can no longer recreate removed workspace data.

## Data integrity

- The deletion flow still requires the existing confirmation and `DELETE ALL` phrase, removes the documented local data scope, and creates one fresh `Specfold` environment when it completes.
- Restore and workspace replacement also invalidate older save operations before applying their new state.

## Verification

- Source-size check, lint, TypeScript checks, desktop and core test suites, and production build passed before release.
- Added renderer coverage for opening environment management from the top bar, saving an environment name on blur, and the guarded delete-all-data flow.

## Known limitations

- Packages are not code-signed or macOS-notarized yet.
- Automatic download and installation of updates is not implemented; use **Help -> Check for Updates** to open the release page.
