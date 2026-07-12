# Product Spec

## Goal

Specfold is a Windows-first desktop REST API client for teams and individual developers who want an offline, account-free way to turn OpenAPI or Swagger definitions into editable API collections.

## Core Jobs

- Paste OpenAPI 3.x or Swagger 2.0 text into the UI.
- Preview document type, format, paths, and operations.
- Import requests into collections, folders, and nested folders.
- Manually create collections, folders, requests, and a JWT token request from a template.
- Edit request method, URL, params, headers, body, and auth.
- Create environments and use `{{variableName}}` variables.
- Send requests from Electron main process to avoid browser CORS issues.
- Export a full collection or selected folders as OpenAPI YAML, OpenAPI JSON, or Collection JSON.

## Non-Goals For MVP

- Cloud sync, accounts, collaboration, telemetry, or backend services.
- Auto-update.
- Administrator permissions for normal app usage.
- Remote `$ref` fetching.
- Automatic response-token extraction.

