import type { HttpMethod } from "../model/types";

export type WorkflowProvider = "openapi" | "apinizer";
export type WorkflowAuth =
  | { kind: "none" }
  | { kind: "bearer"; tokenVariable: string }
  | { kind: "basic"; usernameVariable: string; passwordVariable: string }
  | { kind: "apiKey"; key: string; in: "header" | "query"; valueVariable: string }
  | { kind: "apinizer"; endpoint: string; usernameVariable: string; passwordVariable: string;
      clientIdVariable: string; tokenVariable: string; clientSecretVariable?: string };

/** Reference metadata only. Credentials always live in encrypted environment variables. */
export interface ConnectionProfile {
  id: string;
  name: string;
  provider: WorkflowProvider;
  collectionId: string;
  environmentId: string;
  baseUrl: string;
  source: { kind: "file" | "url" | "existing"; label: string };
  auth: WorkflowAuth;
}

export interface TestInputEvidence {
  location: "body" | "path" | "query" | "header";
  field?: string;
  source: "example" | "default" | "generated" | "missing" | "none";
  valid: boolean;
  reason?: string;
}

export interface WorkflowTestRow {
  requestId: string;
  name: string;
  method: HttpMethod;
  route: string;
  effect: "read" | "may-change-data";
  selected: boolean;
  status: "ready" | "skipped" | "blocked";
  reason?: string;
  provenance: TestInputEvidence[];
  expectedStatuses: number[];
  responseSchema?: unknown;
  responseSchemas?: Record<string, unknown>;
}

export interface WorkflowTestPlan {
  id: string;
  profileId: string;
  profileName: string;
  collectionId: string;
  environmentId: string;
  environmentName: string;
  createdAt: string;
  expiresAt: string;
  revision: string;
  authentication?: string;
  warnings: string[];
  rows: WorkflowTestRow[];
}

export interface WorkflowAssertion {
  name: "status" | "schema";
  outcome: "passed" | "failed" | "skipped" | "blocked";
  message: string;
}

export interface WorkflowStepResult {
  requestId: string;
  name: string;
  method: HttpMethod;
  route: string;
  status: "passed" | "failed" | "skipped" | "blocked";
  reason?: string;
  httpStatus?: number;
  durationMs?: number;
  assertions: WorkflowAssertion[];
  response?: { headers: Record<string, string>; body: string; truncated?: boolean };
}

export interface WorkflowRunReport {
  id: string;
  planId: string;
  profileId: string;
  startedAt: string;
  completedAt: string;
  status: "completed" | "canceled" | "blocked";
  authentication?: { status: "passed" | "failed" | "blocked"; message: string };
  results: WorkflowStepResult[];
  totals: { passed: number; failed: number; skipped: number; blocked: number };
}
