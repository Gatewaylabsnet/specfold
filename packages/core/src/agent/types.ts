import type { Collection } from "../model/types";

export type AgentMutation =
  | { kind: "import-openapi"; text: string; baseUrl?: string; targetCollectionId?: string; apinizer?: boolean }
  | { kind: "bind-bearer"; collectionId: string; variableName: string; requestId?: string; folderId?: string }
  | { kind: "create-apinizer"; collectionId: string; baseUrl?: string };

/** Proposed collection only, never a copy of environments or the whole workspace. */
export interface AgentProposal {
  collection: Collection;
  targetCollectionId?: string;
  warnings: string[];
  diff: {
    added: string[];
    changed: string[];
    retained: number;
    requestCount: number;
  };
}
