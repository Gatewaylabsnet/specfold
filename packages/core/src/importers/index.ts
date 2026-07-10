import { importOpenApiDocument } from "./openapi/importOpenApi";
import { importSwagger2Document } from "./swagger2/importSwagger2";
import { countOperations, parseApiText } from "./shared";
import type { ImportOptions, ImportPreview, ImportResult } from "./types";

export * from "./types";
export * from "./shared";
export * from "./openapi/importOpenApi";
export * from "./swagger2/importSwagger2";

export function previewApiDocument(text: string): ImportPreview {
  const parsed = parseApiText(text);
  const counts = countOperations(parsed.document);
  return {
    title: parsed.title ?? "Imported API",
    version:
      typeof parsed.document.info === "object" && parsed.document.info !== null
        ? String((parsed.document.info as Record<string, unknown>).version ?? "")
        : undefined,
    kind: parsed.kind,
    format: parsed.format,
    ...counts
  };
}

export function importApiDocument(text: string, options: ImportOptions): ImportResult {
  const parsed = parseApiText(text);
  if (parsed.kind === "openapi3") {
    return importOpenApiDocument(parsed.document, parsed, options);
  }
  return importSwagger2Document(parsed.document, parsed, options);
}

