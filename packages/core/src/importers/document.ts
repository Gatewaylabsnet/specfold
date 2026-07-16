import { parseCollectionJson } from "../exporters/collection-json/collectionJson";
import { importApiDocument, previewApiDocument } from "./index";
import { asRecord, asString, isRecord, type AnyRecord } from "./shared";
import type { ImportOptions } from "./types";
import { importHarDocument, isHarDocument } from "./portable/har";
import { importHttpFile, looksLikeHttpFile } from "./portable/http";
import { importInsomniaExport, isInsomniaExport } from "./portable/insomnia";
import { importPostmanCollection, isPostmanCollection } from "./portable/postman";
import { importPostmanV3Folder, previewPostmanV3Folder } from "./portable/postmanV3";
import { previewCollections } from "./portable/shared";
import type { ImportDocumentPreview, ImportDocumentResult } from "./portable/types";

export type { ImportDocumentKind, ImportDocumentPreview, ImportDocumentResult, PostmanV3FolderFile, PostmanV3FolderSource } from "./portable/types";
export { importHttpFile, importPostmanV3Folder, looksLikeHttpFile, previewPostmanV3Folder };

const SPECFOLD_SCHEMAS = new Set(["specfold.collection.v1", "openapi-collection-studio.collection.v1"]);

export function previewImportDocument(text: string): ImportDocumentPreview {
  if (looksLikeHttpFile(text)) return importHttpFile(text).preview;
  const json = tryParseJsonRecord(text);
  if (json) {
    if (isSpecfoldCollectionDocument(json)) {
      const collection = parseCollectionJson(text);
      return previewCollections("collection-json", "Specfold Collection JSON", [collection], [], "v1");
    }
    const portable = importPortableJson(json);
    if (portable) return portable.preview;
    if (!hasApiVersionMarker(json)) throw unsupportedJsonFormatError(json);
  }
  const preview = previewApiDocument(text);
  return {
    kind: preview.kind,
    label: preview.kind === "openapi3" ? "OpenAPI 3.x" : "Swagger 2.0",
    format: preview.format,
    title: preview.title,
    version: preview.version,
    collectionCount: 1,
    requestCount: preview.operationCount,
    containerCount: preview.pathCount,
    containerLabel: "paths"
  };
}

export function importDocument(text: string, options: ImportOptions): ImportDocumentResult {
  if (looksLikeHttpFile(text)) return importHttpFile(text);
  const json = tryParseJsonRecord(text);
  if (json) {
    if (isSpecfoldCollectionDocument(json)) {
      const collection = parseCollectionJson(text);
      return {
        kind: "collection-json",
        collections: [collection], environments: [],
        preview: previewCollections("collection-json", "Specfold Collection JSON", [collection], [], "v1"),
        warnings: []
      };
    }
    const portable = importPortableJson(json);
    if (portable) return portable;
    if (!hasApiVersionMarker(json)) throw unsupportedJsonFormatError(json);
  }
  const imported = importApiDocument(text, options);
  return {
    kind: imported.preview.kind,
    collections: [imported.collection], environments: [],
    preview: {
      kind: imported.preview.kind,
      label: imported.preview.kind === "openapi3" ? "OpenAPI 3.x" : "Swagger 2.0",
      format: imported.preview.format,
      title: imported.preview.title,
      version: imported.preview.version,
      collectionCount: 1,
      requestCount: imported.preview.operationCount,
      containerCount: imported.preview.pathCount,
      containerLabel: "paths"
    },
    warnings: imported.warnings
  };
}

function importPortableJson(document: AnyRecord): ImportDocumentResult | undefined {
  if (isPostmanCollection(document)) return importPostmanCollection(document);
  if (isInsomniaExport(document)) return importInsomniaExport(document);
  if (isHarDocument(document)) return importHarDocument(document);
  return undefined;
}

function isSpecfoldCollectionDocument(document: AnyRecord): boolean {
  return typeof document.schema === "string" && SPECFOLD_SCHEMAS.has(document.schema);
}

function hasApiVersionMarker(document: AnyRecord): boolean {
  return Object.prototype.hasOwnProperty.call(document, "openapi") ||
    Object.prototype.hasOwnProperty.call(document, "swagger");
}

function unsupportedJsonFormatError(document: AnyRecord): Error {
  const info = asRecord(document.info);
  const schema = asString(info.schema) ?? asString(document.schema);
  if (schema?.includes("postman") || Array.isArray(document.requests)) {
    return new Error("Unsupported Postman collection version. Export the collection as Postman Collection v2.0 or v2.1 JSON.");
  }
  return new Error("Unsupported JSON import format. Supported formats: OpenAPI 3.x, Swagger 2.0, Postman Collection v2.0/v2.1, Insomnia JSON v4/v5, HAR 1.2, and Specfold Collection JSON.");
}

function tryParseJsonRecord(text: string): AnyRecord | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
