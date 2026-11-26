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
        components.schemas = structuredClone(value);
      } else {
        components[key] = structuredClone(value);
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

/** Include the local components a refreshed source operation actually uses.
 *  "Include all" still controls unreferenced source components. */
export function includeReferencedComponents(output: AnyRecord, source: AnyRecord, operation: AnyRecord): void {
  const visited = new Set<string>();
  const next = [operation as unknown];
  while (next.length) {
    for (const pointer of referencePointers(next.pop())) {
      const ref = /^#\/components\/([^/]+)\/([^/]+)/.exec(pointer);
      if (!ref && !Object.hasOwn(asRecord(source.schemas), pointer)) continue;
      const section = ref ? decodeRefToken(ref[1]) : "schemas", name = ref ? decodeRefToken(ref[2]) : pointer;
      const definitions = asRecord(source[section]), id = JSON.stringify([section, name]);
      if (visited.has(id) || !Object.hasOwn(source, section) || !Object.hasOwn(definitions, name)) continue;
      visited.add(id);
      if (!Object.hasOwn(output, section)) output[section] = {};
      Object.defineProperty(output[section], name, { value: structuredClone(definitions[name]), enumerable: true, configurable: true, writable: true });
      next.push(definitions[name]);
    }
  }
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
  for (const pointer of referencePointers(value)) {
    const match = /^#\/(?:components\/schemas|definitions)\/([^/]+)/.exec(pointer);
    if (match) names.add(decodeRefToken(match[1]));
    else if (!pointer.startsWith("#") && !pointer.includes("/")) names.add(pointer); // Discriminator mappings can name a schema.
  }
  return [...names];
}

function referencePointers(value: unknown): string[] {
  const pointers: string[] = [];
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (Array.isArray(item)) {
      for (const child of item) pending.push(child);
      continue;
    }
    const node = asRecord(item);
    if (typeof node.$ref === "string") pointers.push(node.$ref);
    for (const pointer of Object.values(asRecord(asRecord(node.discriminator).mapping))) {
      if (typeof pointer === "string") pointers.push(pointer);
    }
    for (const child of Object.values(node)) pending.push(child);
  }
  return pointers;
}

export function decodeRefToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

