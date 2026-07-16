import type { ApiRequest, Folder } from "../../../model/types";

export type OpenApiExportFormat = "yaml" | "json";

export interface OpenApiExportOptions {
  format: OpenApiExportFormat;
  folderIds?: string[];
  useFolderNamesAsTags: boolean;
  includeRequestExamples: boolean;
  includeResponseExamples: boolean;
  includeBearerJwtSecurityScheme: boolean;
  includeAllComponents: boolean;
  pruneUnusedComponents?: boolean;
  includeParameterExamples?: boolean;
  preferSourceOperation?: boolean;
}

export type ExportWarningKind = "secret" | "conflict" | "invalid-path" | "invalid-server";

export interface ExportWarning {
  kind: ExportWarningKind;
  message: string;
}

export interface OpenApiExportResult {
  content: string;
  document: AnyRecord;
  warnings: ExportWarning[];
}

export interface RequestExportItem {
  request: ApiRequest;
  folderPath: Folder[];
}

export type AnyRecord = Record<string, unknown>;
