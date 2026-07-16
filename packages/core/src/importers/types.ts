import type { Collection, GroupingStrategy } from "../model/types";

export type SourceTextFormat = "json" | "yaml" | "text";
export type ApiDocumentKind = "openapi3" | "swagger2";

export interface ParsedApiDocument {
  format: SourceTextFormat;
  kind: ApiDocumentKind;
  version: string;
  title?: string;
  document: Record<string, unknown>;
}

export interface ImportOptions {
  grouping: GroupingStrategy;
  collectionName?: string;
  /**
   * When provided, only operations whose `"<method> <path>"` key (lowercase
   * method) is in this list are imported. Undefined imports everything.
   */
  operationKeys?: string[];
}

/** One selectable operation surfaced to the UI before import. */
export interface ImportOperationSummary {
  /** Stable selection key: `"<method> <path>"` with a lowercase method. */
  key: string;
  method: string;
  path: string;
  summary?: string;
  tags: string[];
}

export interface ImportPreview {
  title: string;
  version?: string;
  kind: ApiDocumentKind;
  format: SourceTextFormat;
  pathCount: number;
  operationCount: number;
}

export interface ImportResult {
  collection: Collection;
  preview: ImportPreview;
  warnings: string[];
}
