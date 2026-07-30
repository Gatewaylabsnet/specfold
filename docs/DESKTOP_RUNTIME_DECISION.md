# Desktop Runtime Decision

Status: accepted

## Decision

Specfold will remain on Electron for the current product line. The desktop shell
tracks the current supported Electron major, keeps renderer privileges narrow,
and isolates native capabilities behind typed IPC contracts.

A Tauri migration is not planned solely because the product scope or React
surface grows. Runtime changes require measurable user benefit that outweighs
the platform rewrite and regression risk.

## Context

Specfold's renderer is React and TypeScript, while the Electron main process
owns behavior that cannot safely live in the renderer:

- Native file and folder dialogs
- Atomic workspace, settings, backup, restore, and rollback
- OS-backed secret encryption
- System proxy resolution and HTTP execution
- Session-only multipart file grants
- Native menus, themes, external links, and release checks
- Windows, macOS, and Linux packaging

The v1.7.1 release packages are approximately 95-128 MB because Electron ships
a Chromium runtime. Tauri could materially reduce distribution size by using
the operating system webview, but it would require the native service layer to
be rewritten and requalified across three different webview implementations.

## Current Hardening Requirements

- `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`
- Restrictive packaged Content Security Policy
- A bounded `specfold://app` protocol instead of privileged `file://` pages
- Navigation and new-window creation denied in the renderer
- Permission requests denied except trusted clipboard writes
- IPC accepted only from the trusted main frame
- External links restricted to HTTPS
- Typed, narrow preload methods rather than raw Electron APIs
- Electron kept on a supported current release

## Tauri Re-evaluation Gate

Run a separate, disposable Tauri spike only when at least one of these is true:

- Download or installed size is demonstrably blocking adoption or distribution.
- Measured cold start or idle memory is outside an agreed product budget.
- Mobile support becomes a committed product requirement.
- The team has ongoing Rust ownership capacity.
- Electron maintenance or security updates become materially harder than a
  native-layer rewrite.

The spike must prove all of the following before migration is considered:

1. Import, export, request sending, proxy resolution, and multipart behavior are
   compatible with existing workspaces.
2. Secret storage, backup/restore rollback, and file-grant boundaries are at
   least as strong as the Electron implementation.
3. Native menus, themes, signing, release packaging, and updates work on
   Windows, macOS, and Linux.
4. Rendering and request behavior pass the same automated and smoke-test gates.
5. Package size, cold start, idle memory, and engineering effort show a
   meaningful improvement.

The spike belongs on an experiment branch and must not add unused Rust tooling
or a second production runtime to the main source tree.
