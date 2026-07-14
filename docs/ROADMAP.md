# Roadmap

## v1.0

- Import OpenAPI 3.x, Swagger 2.0, Collection JSON, and curl commands.
- Edit imported and manual requests in a local collection tree.
- Manage environments and encrypted secret variables.
- Send variable-resolved requests from the Electron main process.
- Export a whole collection or selected folders to OpenAPI YAML/JSON or Collection JSON.
- Preserve imported OpenAPI operation details where possible during export.
- Guard export against common secret leaks and unused component sprawl.
- Package Windows, macOS, and Linux release artifacts.
- Run the renderer with sandbox, context isolation, node integration off, and packaged CSP.

## Post-1.0

- Configure production code-signing certificates for Windows release builds.
- Configure Apple signing and notarization for macOS release builds.
- Add auto-update.
- Add advanced proxy configuration UI, including authenticated proxies and SOCKS support.
- Move heavy import/export work off the renderer thread for very large API documents.
- Add broader packaged-app smoke tests on real Windows, macOS, and Linux machines.
