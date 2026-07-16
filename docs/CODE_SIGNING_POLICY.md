# Code Signing Policy

## Status

Specfold has applied for free code signing provided by SignPath.io, certificate
by SignPath Foundation. Release artifacts must be treated as unsigned until
this status explicitly states that SignPath signing is active and the
artifact's signature has been verified.

## Scope

Only official Specfold release artifacts built from the public
[`Gatewaylabsnet/specfold`](https://github.com/Gatewaylabsnet/specfold)
repository may be submitted for signing. The source revision, build workflow,
package version, and published checksums must correspond to the release being
approved.

## Team roles

- Committers and reviewers: GatewayLabs repository maintainers with write or
  maintain access. The public project maintainer is
  [Orkun Kocatürk (`@Orkkoc`)](https://github.com/Orkkoc).
- Approver: [Orkun Kocatürk (`@Orkkoc`)](https://github.com/Orkkoc). Each
  signing request requires explicit approval after the release checks pass.

No contributor may approve a signing request for an artifact whose source or
build provenance cannot be matched to the public repository.

## Build and release controls

- GitHub Actions runs typechecking and automated tests before packaging.
- Release packages are produced by the repository's public release workflow.
- The workflow verifies the expected Windows, macOS, and Linux asset set and
  publishes SHA-256 checksums.
- Signing approval is separate from authoring the code change and is granted
  only for an identified release revision.
- Multi-factor authentication is required for the GitHub and SignPath accounts
  used to maintain, approve, or sign releases.

## Privacy

Specfold has no telemetry, account system, hosted workspace, or automatic
cloud synchronization. It does not transfer information to another networked
system unless the user specifically requests a network operation, such as
sending an API request or fetching an import document from a URL. Workspace
data, environments, request history, settings, and secrets are stored locally.

## Revocation and incident response

If a signed artifact cannot be traced to an approved public source revision,
contains unexpected code, or is suspected of compromise, distribution will be
stopped and SignPath Foundation will be notified so the applicable signing
certificate or artifact can be reviewed and revoked when necessary.
