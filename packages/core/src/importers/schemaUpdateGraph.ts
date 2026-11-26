import { contractObject as object } from "./contractSchemaDiff";

const unsafe = new Set(["__proto__", "constructor", "prototype"]);
const literals = new Set(["example", "value", "default", "const", "enum"]);
const maps = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas", "dependencies", "content", "headers", "responses", "examples", "callbacks", "links", "encoding"]);
const unsupported = new Set(["$id", "$anchor", "$dynamicAnchor", "$dynamicRef", "$recursiveRef", "$recursiveAnchor", "$schema"]);

type Components = Record<string, unknown>;
export interface ComponentRef { kind: string; name: string }
export const componentKey = ({ kind, name }: ComponentRef): string => JSON.stringify([kind, name]);

/** Fixed, user-safe diagnostics. Never put source values or references in these errors. */
export class OpenApiSchemaUpdateError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

function readSegments(ref: unknown): string[] {
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    throw new OpenApiSchemaUpdateError("Schema update only supports local references to OpenAPI components.", "SCHEMA_UPDATE_REF_UNSUPPORTED");
  }
  let parts: string[];
  try {
    // Reject URI escapes for now: the existing importer and exporter interpret
    // JSON Pointer escapes, not percent-encoded fragments.
    if (ref.includes("%")) throw new Error();
    parts = ref.slice(2).split("/").map((part) => {
      if (/~(?![01])/.test(part)) throw new Error();
      return part.replaceAll("~1", "/").replaceAll("~0", "~");
    });
  } catch {
    throw new OpenApiSchemaUpdateError("A component reference uses an unsupported JSON Pointer.", "SCHEMA_UPDATE_REF_UNSUPPORTED");
  }
  if (parts.length < 3 || parts[0] !== "components" || parts.some((part) => !part || unsafe.has(part))) {
    throw new OpenApiSchemaUpdateError("Schema update only supports local references to OpenAPI components.", "SCHEMA_UPDATE_REF_UNSUPPORTED");
  }
  return parts.slice(1);
}

export function makeComponentGraph(components: Components, budget: { left: number }) {
  const entries = new Map<string, { ref: ComponentRef; value: unknown }>();
  const edges = new Map<string, string[]>();
  function references(roots: unknown[]): string[] {
    const found = new Set<string>();
    function add(ref: unknown) {
      const [kind, name, ...pointer] = readSegments(ref);
      const section = object(components[kind]);
      let target = Object.hasOwn(section, name) ? section[name] : undefined;
      const value = target;
      for (const key of pointer) {
        target = target && typeof target === "object" && Object.hasOwn(target, key)
          ? (target as Record<string, unknown>)[key] : undefined;
      }
      if (!(target && typeof target === "object" && !Array.isArray(target)) &&
          !(kind === "schemas" && typeof target === "boolean")) {
        throw new OpenApiSchemaUpdateError("A local component reference could not be resolved. Fix the OpenAPI reference before refreshing schemas.", "SCHEMA_UPDATE_REF_UNRESOLVED");
      }
      const component = { kind, name };
      const key = componentKey(component);
      entries.set(key, { ref: component, value });
      found.add(key);
    }
    function visit(value: unknown, asMap = false): void {
      if (--budget.left < 0) throw new OpenApiSchemaUpdateError("The schema reference graph exceeds the safe inspection limit.", "SCHEMA_UPDATE_LIMIT");
      if (Array.isArray(value)) { value.forEach((item) => visit(item)); return; }
      const node = object(value);
      if (!asMap && Object.hasOwn(node, "$ref")) add(node.$ref);
      if (!asMap && Object.hasOwn(node, "discriminator")) {
        for (const pointer of Object.values(object(object(node.discriminator).mapping))) {
          if (typeof pointer === "string" && Object.hasOwn(object(components.schemas), pointer)) {
            add(`#/components/schemas/${pointer.replaceAll("~", "~0").replaceAll("/", "~1")}`);
          } else add(pointer);
        }
      }
      for (const [key, child] of Object.entries(node)) {
        if (!asMap && unsupported.has(key)) {
          throw new OpenApiSchemaUpdateError("This contract uses a schema dialect, anchor or dynamic reference that cannot be refreshed safely.", "SCHEMA_UPDATE_REF_UNSUPPORTED");
        }
        if (!asMap && (key === "$ref" || key === "discriminator" || literals.has(key) ||
          (key === "examples" && Array.isArray(child)))) continue;
        visit(child, !asMap && maps.has(key));
      }
    }
    roots.forEach((root) => visit(root));
    return [...found];
  }
  return {
    reachable(roots: unknown[]): ComponentRef[] {
      const queue = references(roots);
      const seen = new Set<string>();
      for (let cursor = 0; cursor < queue.length; cursor++) {
        if (--budget.left < 0) throw new OpenApiSchemaUpdateError("The schema reference graph exceeds the safe inspection limit.", "SCHEMA_UPDATE_LIMIT");
        const key = queue[cursor];
        if (seen.has(key)) continue;
        seen.add(key);
        let next = edges.get(key);
        if (!next) {
          next = references([entries.get(key)!.value]);
          edges.set(key, next);
        }
        queue.push(...next);
      }
      return [...seen].map((key) => entries.get(key)!.ref);
    }
  };
}
