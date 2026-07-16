import type { Collection } from "../../../model/types";
import { asRecord } from "./shared";
import type { AnyRecord, ExportWarning, OpenApiExportOptions } from "./types";

export function buildInitialComponents(
  collection: Collection,
  options: OpenApiExportOptions
): AnyRecord {
  const components: AnyRecord = {};
  if (options.includeAllComponents) {
    const importedComponents = asRecord(collection.openApi?.components);
    for (const [key, value] of Object.entries(importedComponents)) {
      if (key === "definitions") {
        components.schemas = value;
      } else {
        components[key] = value;
      }
    }
  }
  return components;
}

export function serverList(
  collection: Collection,
  warnings: ExportWarning[]
): Array<{ url: string }> | undefined {
  const servers = [collection.baseUrl, ...(collection.openApi?.servers ?? [])].filter(
    (url): url is string => Boolean(url)
  );
  const valid = servers.filter((url) => !url.includes("{{"));
  if (valid.length !== servers.length) {
    warnings.push({
      kind: "invalid-server",
      message:
        "Some server URLs contained {{variables}} and were omitted so the exported document stays valid OpenAPI."
    });
  }
  if (valid.length > 0) {
    return valid.map((url) => ({ url }));
  }
  // Returning undefined omits `servers` entirely, which is valid OpenAPI.
  // A `{{baseUrl}}` placeholder here would produce an invalid document.
  return undefined;
}

export function ensureSecuritySchemes(components: AnyRecord): AnyRecord {
  const existing = asRecord(components.securitySchemes);
  components.securitySchemes = existing;
  return existing;
}

/**
 * Keep only the component schemas that the exported paths (transitively)
 * reference. Prevents a folder-scoped export from shipping the entire API's
 * data models. Other component sections and securitySchemes are left intact.
 */
export function pruneUnusedComponents(paths: AnyRecord, components: AnyRecord): AnyRecord {
  const schemas = asRecord(components.schemas);
  if (Object.keys(schemas).length === 0) {
    return components;
  }

  const reachable = new Set<string>();
  // Seed from the paths AND every non-schema component section that ships in
  // the export (parameters/responses/... may hold $refs into schemas).
  const nonSchemaSections = Object.entries(components)
    .filter(([key]) => key !== "schemas")
    .map(([, value]) => value);
  const queue = collectSchemaRefNames([paths, nonSchemaSections]);
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (reachable.has(name) || !(name in schemas)) {
      continue;
    }
    reachable.add(name);
    for (const next of collectSchemaRefNames(schemas[name])) {
      if (!reachable.has(next)) {
        queue.push(next);
      }
    }
  }

  const prunedSchemas: AnyRecord = {};
  for (const name of reachable) {
    prunedSchemas[name] = schemas[name];
  }

  const next = { ...components };
  if (Object.keys(prunedSchemas).length > 0) {
    next.schemas = prunedSchemas;
  } else {
    delete next.schemas;
  }
  return next;
}

export function collectSchemaRefNames(value: unknown): string[] {
  const names = new Set<string>();
  const pattern = /#\/(?:components\/schemas|definitions)\/([^"/]+)/g;
  const serialized = JSON.stringify(value) ?? "";
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(serialized)) !== null) {
    names.add(decodeRefToken(match[1]));
  }
  return [...names];
}

export function decodeRefToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

