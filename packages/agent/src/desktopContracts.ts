import type { AgentMutation } from "@openapi-collection-studio/core";

export type DesktopAgentCall =
  | { operation: "ping" }
  | { operation: "list" }
  | { operation: "inspect"; collectionId: string; requestId: string }
  | { operation: "validate"; collectionId: string }
  | { operation: "preview"; action: AgentMutation }
  | { operation: "diff"; planId: string }
  | { operation: "review"; planId: string; expectedRevision: string }
  | { operation: "status"; planId: string }
  | { operation: "send"; collectionId: string; requestId: string }
  | { operation: "documentation"; collectionId: string };

export interface AgentPlanReview {
  planId: string;
  expectedRevision: string;
  collection: { name: string; baseUrl?: string };
  diff: { added: string[]; changed: string[]; retained: number; requestCount: number };
  warnings: string[];
  intent: { kind: string; tokenVariable?: string; variableName?: string; apinizer?: boolean;
    targetCollectionId?: string; collectionId?: string; requestId?: string; folderId?: string; baseUrl?: string };
  status: "pending" | "applied" | "rejected" | "stale";
  collectionId?: string;
}

export interface AgentConnectionInfo {
  available: boolean;
  lastConnectedAt?: string;
  configuration: { command: string; args: string[]; env?: Record<string, string> };
  pending: AgentPlanReview[];
  session?: { collectionName: string; environmentName: string; remaining: number; expiresAt: number };
}

export interface AgentSessionSelection { collectionId: string; requestIds: string[] }
export type AgentPlanDiff = Omit<AgentPlanReview, "status" | "collectionId">;
export type AgentPreview = AgentPlanDiff & { approvalRequired: boolean; expiresAfterHours: number; networkRequests: number };
