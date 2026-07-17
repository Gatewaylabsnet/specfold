# Specfold v1.1.1

## Added

- Copy generated OpenAPI or Collection JSON directly from the Export preview.
- Clear success or failure feedback after a clipboard copy attempt.

## Fixed

- Request name editing remains responsive in collections with multiple folders.
- Request names are committed once on Enter or when the field loses focus, avoiding repeated full-workspace and export work for every keystroke.
- OpenAPI export generation is deferred until the Export screen is opened.

## Security

- The public code-signing policy now records the submitted SignPath Foundation application.
- Release packages remain unsigned until the application is approved and the policy explicitly states that signing is active.

## Known limitations

- Windows packages may trigger SmartScreen while code signing is pending.
- macOS packages are not signed or notarized and may trigger Gatekeeper prompts.
- Auto-update is not included; install new versions manually from GitHub Releases.
