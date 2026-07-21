# Specfold v1.3.1

## Added

- No user-facing feature additions; this release is a correctness and security hotfix.

## Changed

- Copied cURL now keeps enabled `application/x-www-form-urlencoded` fields.
- OpenAPI response examples now obey the Include example values option.
- Native Collection JSON export now reports likely literal secret values before copy/save.

## Security

- Literal request auth, sensitive values, and response examples are encrypted at rest when safe storage is available.
- When safe storage is unavailable, sensitive values are blanked rather than persisted in plaintext.

## Known limitations

- Existing platform signing/notarization limitations remain unchanged.

## Verification

- Typecheck, unit tests, and production build must pass on the final release commit.
