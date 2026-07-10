type AnyRecord = Record<string, unknown>;

export interface OpenApiCheckResult {
  ok: boolean;
  issues: string[];
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "trace"];

/**
 * Lightweight, dependency-free structural check of a generated OpenAPI document.
 *
 * This is intentionally NOT a full JSON-Schema validation (that would need a
 * runtime-eval validator, which the app's Content-Security-Policy forbids).
 * It catches the mistakes that actually break downstream tools: missing
 * top-level fields, unresolved `{{variables}}` in paths/servers, operations
 * with no responses, and empty path items.
 */
export function checkOpenApiDocument(document: unknown): OpenApiCheckResult {
  const issues: string[] = [];

  if (!isRecord(document)) {
    return { ok: false, issues: ["Document root must be an object."] };
  }

  const version = document.openapi;
  if (typeof version !== "string" || !/^3\.\d/.test(version)) {
    issues.push('Missing or invalid "openapi" version (expected 3.x).');
  }

  const info = document.info;
  if (!isRecord(info)) {
    issues.push('Missing "info" object.');
  } else {
    if (typeof info.title !== "string" || info.title.trim() === "") {
      issues.push('Missing "info.title".');
    }
    if (typeof info.version !== "string" || info.version.trim() === "") {
      issues.push('Missing "info.version".');
    }
  }

  for (const server of Array.isArray(document.servers) ? document.servers : []) {
    const url = isRecord(server) ? server.url : undefined;
    if (typeof url === "string" && url.includes("{{")) {
      issues.push(`Server URL "${url}" contains a {{variable}} and is not a valid OpenAPI server.`);
    }
  }

  const paths = document.paths;
  if (!isRecord(paths) || Object.keys(paths).length === 0) {
    issues.push("Document has no paths.");
  } else {
    for (const [path, pathItem] of Object.entries(paths)) {
      if (!path.startsWith("/")) {
        issues.push(`Path "${path}" must start with "/".`);
      }
      if (path.includes("{{")) {
        issues.push(`Path "${path}" contains a {{variable}} (OpenAPI uses {param} templating).`);
      }
      if (!isRecord(pathItem)) {
        issues.push(`Path item "${path}" is not an object.`);
        continue;
      }
      const operations = Object.keys(pathItem).filter((key) => HTTP_METHODS.includes(key.toLowerCase()));
      if (operations.length === 0) {
        issues.push(`Path "${path}" has no operations.`);
      }
      for (const method of operations) {
        const operation = pathItem[method];
        if (!isRecord(operation)) {
          continue;
        }
        if (!isRecord(operation.responses) || Object.keys(operation.responses).length === 0) {
          issues.push(`Operation ${method.toUpperCase()} ${path} has no responses.`);
        }
      }
    }
  }

  return { ok: issues.length === 0, issues };
}
