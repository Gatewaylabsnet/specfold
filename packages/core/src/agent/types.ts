import type { Collection } from "../model/types";
import type { OpenApiSchemaUpdateSummary } from "../importers/schemaUpdate";
import type { RequestBodyEdit } from "./requestBodyEdit";
import type { HeaderEdit } from "./requestHeadersEdit";

export type { RequestBodyEdit, JsonBodyPatch } from "./requestBodyEdit";
export type { HeaderEdit, HeaderTarget } from "./requestHeadersEdit";

export interface RequestEdit {
  requestId: string;
  body?: RequestBodyEdit;
  headers?: HeaderEdit[];
}

export interface RequestUpdateSummary {
  changed: boolean;
  requests: Array<{
    requestId: string;
    operation: string;
    changes: Array<{ scope: string; message: string }>;
    warnings: string[];
  }>;
}

export interface AgentRequestUpdate {
  kind: "update-request";
  collectionId: string;
  expectedRevision: string;
  updates: RequestEdit[];
  schemaUpdate?: { text: string; requestIds: string[] };
}

export type AgentMutation =
  | { kind: "import-openapi"; text: string; baseUrl?: string; targetCollectionId?: string; apinizer?: boolean }
  | { kind: "update-openapi-schema"; text: string; targetCollectionId: string; requestIds: string[]; expectedRevision: string }
  | AgentRequestUpdate
  | { kind: "bind-bearer"; collectionId: string; variableName: string; requestId?: string; folderId?: string }
  | { kind: "create-apinizer"; collectionId: string; baseUrl?: string };

/** Proposed collection only, never a copy of environments or the whole workspace. */
export interface AgentProposal {
  collection: Collection;
  targetCollectionId?: string;
  warnings: string[];
  schemaUpdate?: OpenApiSchemaUpdateSummary;
  requestUpdate?: RequestUpdateSummary;
  diff: {
    added: string[];
    changed: string[];
    retained: number;
    requestCount: number;
  };
}
