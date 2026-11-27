# Specfold 1.14.0

## Changed

- **Response first.** The response content opens automatically after sending an Auth request. Token and advanced variable controls are below it. Detected sensitive values are masked until you choose to reveal them.
- **Collection Bearer token.** Send an issuer request from the collection. A successful, unredirected JSON response with a valid top-level `access_token` or `accessToken` is captured when the issuer and secure storage checks pass. Later manual requests in the same collection and active environment can use it without adding an Authorization header by hand.

## Security and scope

- Capture recognizes POST routes ending in `/auth/jwt`, `/auth/token`, `/oauth/token`, `/oauth2/token`, `/connect/token`, and `/protocol/openid-connect/token`, plus other `/token` routes with a supported OAuth form grant. A declared token type must be Bearer.
- The secret is encrypted using the OS credential store. Use is restricted to the exact issuer origin (scheme, host, and port), over verified HTTPS or HTTP loopback. If a collection base URL is set, its origin must also match the issuer at capture time. Requests that use the captured token do not follow redirects.
- Existing explicit auth, Authorization headers and folder token bindings take precedence. Specfold does not send an additional request, refresh on a timer, or retry a failed request to get a token. MCP and guided tests retain their own auth and approvals.
- To switch this off, clear **Capture and use the collection token automatically** in the request editor's **Auth** tab. Unsupported response formats and separate issuer/API origins can still use the existing manual token binding flow.

## Verification and upgrade

The focused Electron regression test uses an isolated workspace and two local origins. It exercises response order and masking, ciphertext on disk, reopening, manual-auth precedence, redirect blocking and collection/origin boundaries. The release workflow verifies the eight platform packages, the checksum manifest, packaged Windows E2E and both Windows installer scopes.

Close Specfold and keep a complete backup and closed-app workspace snapshot before upgrading. Workspace and backup format versions are unchanged. Windows binaries remain unsigned and macOS packages are not notarized. Use the [release downloads](https://github.com/Gatewaylabsnet/specfold/releases/tag/v1.14.0) for a manual upgrade.
