# Specfold v1.4.0

## Added

- Persisted System, Light, and Dark appearance.
- Import Doctor warnings during non-destructive import Preview.
- Resolved request URL and missing-variable inspector before Send.
- Copy response content and save a response as a reusable example with a secret confirmation.

## Changed

- Connection profiles explain the relationship between a named environment, base URL, and variables more directly.

## Security

- Saving a response example asks for explicit confirmation when its headers or body look like they contain a secret.

## Known limitations

- Appearance selection does not change the operating system’s own high-contrast settings; those settings continue to be respected by native controls where available.

## Verification

- Theme preference migration, renderer interactions, import warnings, routing, response tools, typecheck, tests, and production build must pass on the final release commit.
