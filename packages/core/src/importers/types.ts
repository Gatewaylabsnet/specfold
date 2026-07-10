import type { Collection, GroupingStrategy } from "../model/types";

export type SourceTextFormat = "json" | "yaml";
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

