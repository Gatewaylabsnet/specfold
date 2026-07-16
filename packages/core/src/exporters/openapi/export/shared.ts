import type { KeyValue } from "../../../model/types";
import type { AnyRecord } from "./types";

export const VARIABLE_ONLY = /^\s*\{\{\s*[^}]+\s*\}\}\s*$/;

export function isEnabledKeyValue(item: KeyValue): boolean {
  return item.enabled && Boolean(item.key.trim());
}

export function inferPrimitiveType(value: string): "boolean" | "number" | "string" {
  if (value === "true" || value === "false") {
    return "boolean";
  }
  if (value.trim() !== "" && Number.isFinite(Number(value))) {
    return "number";
  }
  return "string";
}

export function parseJsonOrString(value: string): unknown {
  if (!value.trim()) {
    return {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)).filter((item) => item !== undefined) as T;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const result: AnyRecord = {};
  for (const [key, child] of Object.entries(value as AnyRecord)) {
    if (child !== undefined) {
      result[key] = stripUndefined(child);
    }
  }
  return result as T;
}

export function asRecord(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as AnyRecord)
    : {};
}
