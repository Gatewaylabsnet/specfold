import type { Collection, Environment } from "../../model/types";
import type { ApiDocumentKind, SourceTextFormat } from "../types";

export type ImportDocumentKind =
  | ApiDocumentKind
  | "collection-json"
  | "postman"
  | "insomnia"
  | "har"
  | "http-file";

export interface PostmanV3FolderFile {
  /** Forward-slash path relative to the selected collection root. */
  path: string;
  content: string;
}

export interface PostmanV3FolderSource {
  rootName: string;
  files: PostmanV3FolderFile[];
  skippedScriptCount?: number;
}

export interface ImportDocumentPreview {
  kind: ImportDocumentKind;
  label: string;
  format: SourceTextFormat;
  title: string;
  version?: string;
  collectionCount: number;
  requestCount: number;
  containerCount: number;
  containerLabel: "paths" | "folders";
}

export interface ImportDocumentResult {
  kind: ImportDocumentKind;
  collections: Collection[];
  environments: Environment[];
  preview: ImportDocumentPreview;
  warnings: string[];
}
