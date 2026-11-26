import { flattenRequests, folderBaseUrl } from "../model/traversal";
import type { ApiRequest, Collection, OpenApiMetadata } from "../model/types";
import { assertBoundedWorkflowValue, resolveWorkflowReferences } from "../workflow/provenance";
import { validateWorkflowValue } from "../workflow/assertions";
import { contractCanonical, contractObject as object } from "./contractSchemaDiff";
import { stableRequestKey } from "./reimport";
import { makeComponentGraph, OpenApiSchemaUpdateError } from "./schemaUpdateGraph";
import { selectRequestBodyContent } from "./openapi/importOpenApi";
import { resolveLocalRef } from "./shared";

export { OpenApiSchemaUpdateError } from "./schemaUpdateGraph";

const MAX_REQUESTS = 500;
const MAX_CHANGES = 350;
const equal = (a: unknown, b: unknown) => contractCanonical(a) === contractCanonical(b);

export interface OpenApiSchemaUpdateOptions {
  requestIds: string[];
  approvedAffectedRequestIds?: string[];
}

interface OperationLabel { id: string; operation: string }

export interface OpenApiSchemaUpdateSummary {
  changed: boolean;
  selectedRequestIds: string[];
  affectedRequestIds: string[];
  selectedOperations: OperationLabel[];
  affectedOperations: OperationLabel[];
  requiresAcknowledgement: boolean;
  changes: Array<{ scope: string; message: string }>;
  warnings: string[];
}

const dialect = (metadata: OpenApiMetadata | undefined) =>
  metadata?.sourceFormat === "openapi3" ? /^3\.[01](?=\.|$)/.exec(metadata.documentVersion ?? "")?.[0] : undefined;
const roots = (request: ApiRequest): unknown[] => [request.openApi?.rawOperation, request.openApi?.rawParameters, request.body.schema];
const label = (request: ApiRequest): string => stableRequestKey(request).slice(0, 240);
const describe = (request: ApiRequest): OperationLabel => ({ id: request.id, operation: label(request) });

function sourceBodyEvidence(raw: Record<string, unknown>, components: Record<string, unknown>): {schema?: unknown; required?: boolean} {
  let body = object(raw.requestBody);
  const seen = new Set<string>();
  while (typeof body.$ref === "string") {
    if (seen.has(body.$ref) || seen.size >= 500) {
      throw new OpenApiSchemaUpdateError("The request body alias chain does not resolve to a body declaration.", "SCHEMA_UPDATE_REF_UNRESOLVED");
    }
    seen.add(body.$ref);
    body = object(resolveLocalRef({ components }, body));
  }
  const { contentType, media } = selectRequestBodyContent({ components }, body.content);
  return contentType ? { schema: media.schema, required: body.required === true } : {};
}

function index(requests: ApiRequest[]) {
  const ids = new Map<string, ApiRequest>();
  const keys = new Map<string, ApiRequest[]>();
  for (const request of requests) {
    if (ids.has(request.id)) throw new OpenApiSchemaUpdateError("The collection has duplicate request identities.", "SCHEMA_UPDATE_AMBIGUOUS");
    ids.set(request.id, request);
    const key = stableRequestKey(request);
    const list = keys.get(key) ?? [];
    list.push(request);
    keys.set(key, list);
  }
  return { ids, keys };
}

function schemaDetails(before: unknown, after: unknown, report: (message: string) => void,
  at = "", depth = 0): void {
  if (equal(before, after) || depth > 28) return;
  const old = object(before), next = object(after);
  const oldProperties = object(old.properties), newProperties = object(next.properties);
  const oldRequired = new Set(Array.isArray(old.required) ? old.required.filter((name) => typeof name === "string") : []);
  const newRequired = new Set(Array.isArray(next.required) ? next.required.filter((name) => typeof name === "string") : []);
  const field = (name: string) => `${at}${name}`.slice(0, 180);
  for (const key of [...new Set([...Object.keys(oldProperties), ...Object.keys(newProperties)])].sort()) {
    if (!Object.hasOwn(oldProperties, key)) report(`Added field: ${field(key)}.`);
    if (!Object.hasOwn(newProperties, key)) report(`Removed field: ${field(key)}.`);
    schemaDetails(oldProperties[key], newProperties[key], report, `${field(key)}.`, depth + 1);
  }
  for (const key of [...new Set([...oldRequired, ...newRequired])].sort()) {
    if (oldRequired.has(key) !== newRequired.has(key)) {
      report(`${newRequired.has(key) ? "Now required" : "No longer required"}: ${field(key)}.`);
    }
  }
  for (const key of ["items", "additionalProperties", "contains", "if", "then", "else", "not"] as const) {
    if (old[key] !== undefined || next[key] !== undefined) schemaDetails(old[key], next[key], report, `${field(key)}.`, depth + 1);
  }
  for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"] as const) {
    const a = Array.isArray(old[key]) ? old[key] : [], b = Array.isArray(next[key]) ? next[key] : [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      schemaDetails(a[i], b[i], report, `${field(key)}[${i}].`, depth + 1);
    }
  }
}

function conflictWarnings(existing: ApiRequest, source: ApiRequest, before: Collection,
  after: Collection, savedBaseUrl: string | undefined, warn: (message: string) => void): void {
  const oldMetadata = existing.openApi;
  const newMetadata = source.openApi;
  if (existing.method !== source.method || existing.url !== source.url ||
      (after.baseUrl && savedBaseUrl && after.baseUrl !== savedBaseUrl) ||
      !equal(oldMetadata?.servers, newMetadata?.servers) ||
      !equal(object(oldMetadata?.rawOperation).servers, object(newMetadata?.rawOperation).servers)) {
    warn("The saved HTTP method, URL and base URL were retained. Verify that they still route to the updated contract.");
  }
  if (existing.auth.type !== source.auth.type ||
      !equal(object(oldMetadata?.rawOperation).security ?? before.openApi?.security,
        object(newMetadata?.rawOperation).security ?? after.openApi?.security) ||
      !equal(before.openApi?.securitySchemes, after.openApi?.securitySchemes)) {
    warn("Authentication in the source may differ. Saved auth, JWT flows, security schemes and operation security declarations are retained.");
  }
  const declared = newMetadata?.rawParameters ?? [];
  if (!equal(oldMetadata?.rawParameters, declared) || declared.some((value) => {
    const parameter = object(value);
    const fields = parameter.in === "header" ? existing.headers
      : parameter.in === "query" ? existing.queryParams : parameter.in === "path" ? existing.pathParams : undefined;
    return fields && (parameter.required === true || parameter.in === "path") &&
      !fields.some(({ key, enabled }) => enabled && (parameter.in === "header"
        ? key.toLowerCase() === String(parameter.name).toLowerCase() : key === parameter.name));
  })) {
    warn("Declared path, query or header inputs differ or need review. Saved input fields were not changed.");
  }
  const savedContentType = existing.headers.find(({ key, enabled }) => enabled && key.toLowerCase() === "content-type")?.value;
  if (existing.body.contentType !== source.body.contentType || existing.body.mode !== source.body.mode ||
      (source.body.contentType && savedContentType &&
        savedContentType.split(";", 1)[0].trim().toLowerCase() !== source.body.contentType.split(";", 1)[0].trim().toLowerCase())) {
    warn("The documented body or media type differs from the saved input. Saved body mode and Content-Type were not changed.");
  }
}

function checkSavedBody(request: ApiRequest, schema: unknown, required: boolean | undefined,
  components: Record<string, unknown>, warn: (message: string) => void): void {
  if (request.body.mode === "none") {
    if (required) warn("The new contract requires a body but this request has none.");
    return;
  }
  if (!request.body.raw) {
    if (schema !== undefined || required) warn("Saved body compatibility could not be checked for this input. Review it before sending.");
    return;
  }
  if (request.body.mode !== "json" || schema === undefined || request.body.raw.length > 1_000_000 ||
      request.body.raw.startsWith("enc:v1:")) {
    if (schema !== undefined) warn("Saved body compatibility was not checked for its input format. Review it against the new contract.");
    return;
  }
  try {
    const value: unknown = JSON.parse(request.body.raw);
    const resolved = resolveWorkflowReferences(schema, { components });
    const schemaObject = object(resolved.value);
    const properties = object(schemaObject.properties);
    if (!resolved.unresolved && Object.keys(properties).length &&
        Object.keys(object(value)).some((key) => !Object.hasOwn(properties, key))) {
      warn("The saved JSON body contains fields not declared by the refreshed schema. They were not removed.");
    }
    const validation = resolved.unresolved ? undefined : validateWorkflowValue(value, resolved.value);
    if (validation?.outcome === "failed") {
      warn("The saved JSON body does not satisfy the new schema. The body was not changed.");
    } else if (validation?.outcome !== "passed") {
      warn("Saved body compatibility could not be established for this schema. Review it before sending.");
    }
  } catch {
    warn("Saved body compatibility could not be established. The body was not changed.");
  }
}

/**
 * Produce an isolated collection candidate, never mutating either input.
 * Apply callers must require `!summary.requiresAcknowledgement` and enforce
 * their own revision/approval boundary before saving the candidate.
 */
export function planOpenApiSchemaUpdate(target: Collection, incoming: Collection,
  options: OpenApiSchemaUpdateOptions): { collection: Collection; summary: OpenApiSchemaUpdateSummary } {
  if (!dialect(target.openApi) || dialect(target.openApi) !== dialect(incoming.openApi)) {
    throw new OpenApiSchemaUpdateError("Select an OpenAPI 3.0 or 3.1 collection and a new document using the same dialect.", "SCHEMA_UPDATE_FORMAT");
  }
  const selectedIds = new Set(options.requestIds);
  if (selectedIds.size === 0 || selectedIds.size !== options.requestIds.length || selectedIds.size > MAX_REQUESTS) {
    throw new OpenApiSchemaUpdateError("Select unique existing request IDs to refresh.", "SCHEMA_UPDATE_SELECTION");
  }
  if (Array.isArray(options.approvedAffectedRequestIds) &&
      (new Set(options.approvedAffectedRequestIds).size !== options.approvedAffectedRequestIds.length ||
       options.approvedAffectedRequestIds.length > MAX_REQUESTS)) {
    throw new OpenApiSchemaUpdateError("Acknowledged shared-schema impacts must be a unique request ID list.", "SCHEMA_UPDATE_SELECTION");
  }
  const locations = flattenRequests(target);
  const existing = locations.map(({ request }) => request);
  const source = flattenRequests(incoming).map(({ request }) => request);
  if (Math.max(existing.length, source.length) > MAX_REQUESTS) {
    throw new OpenApiSchemaUpdateError("Schema refresh supports up to 500 operations per collection or source.", "SCHEMA_UPDATE_LIMIT");
  }
  const currentIndex = index(existing), sourceIndex = index(source);
  const pairs = existing.filter(({ id }) => selectedIds.has(id)).map((current) => {
    const key = stableRequestKey(current);
    const matches = sourceIndex.keys.get(key) ?? [];
    if (currentIndex.keys.get(key)?.length !== 1 || matches.length > 1) {
      throw new OpenApiSchemaUpdateError("More than one operation has the same stable identity. Resolve the duplicate before refreshing schemas.", "SCHEMA_UPDATE_AMBIGUOUS");
    }
    if (current.openApi?.sourceFormat !== "openapi3" || matches.length !== 1 ||
        matches[0].openApi?.sourceFormat !== "openapi3" || !Object.keys(object(matches[0].openApi?.rawOperation)).length) {
      throw new OpenApiSchemaUpdateError("A selected request has no matching OpenAPI operation in the new document.", "SCHEMA_UPDATE_MISSING_MATCH");
    }
    return { current, updated: matches[0] };
  });
  if (pairs.length !== selectedIds.size) throw new OpenApiSchemaUpdateError("A selected request no longer exists in the target collection.", "SCHEMA_UPDATE_MISSING_MATCH");

  const currentComponents = object(target.openApi?.components);
  const sourceComponents = object(incoming.openApi?.components);
  try {
    assertBoundedWorkflowValue([currentComponents, existing.flatMap(roots)]);
    assertBoundedWorkflowValue([sourceComponents, pairs.flatMap(({ updated }) => roots(updated))]);
  } catch {
    throw new OpenApiSchemaUpdateError("The document contains unsupported data or exceeds the safe schema inspection limits.", "SCHEMA_UPDATE_LIMIT");
  }
  const budget = { left: 2_000_000 };
  const currentGraph = makeComponentGraph(currentComponents, budget);
  const incomingGraph = makeComponentGraph(sourceComponents, budget);
  const currentSchemas = object(currentComponents.schemas), incomingSchemas = object(sourceComponents.schemas);
  const changedSchemas = new Set<string>();
  const changes: OpenApiSchemaUpdateSummary["changes"] = [];
  const warnings: string[] = [];
  const add = (scope: string, message: string) => {
    if (changes.length < MAX_CHANGES) changes.push({ scope, message });
  };
  const warn = (message: string) => {
    if (warnings.length < MAX_CHANGES && !warnings.includes(message)) warnings.push(message);
  };

  const sourceDependencies = new Map<string, ReturnType<typeof incomingGraph.reachable>>();
  for (const { current, updated } of pairs) {
    const deps = incomingGraph.reachable(roots(updated));
    sourceDependencies.set(current.id, deps);
    for (const { kind, name } of deps) {
      if (kind === "schemas") {
        if (!Object.hasOwn(currentSchemas, name) || !equal(currentSchemas[name], incomingSchemas[name])) changedSchemas.add(name);
      } else if (!equal(object(currentComponents[kind])[name], object(sourceComponents[kind])[name])) {
        throw new OpenApiSchemaUpdateError("A selected operation depends on a new or changed non-schema component. Refresh schemas using a contract with the same auxiliary components or inline the affected definition.", "SCHEMA_UPDATE_AUX_COMPONENT");
      }
    }
  }
  const mergedComponents = changedSchemas.size ? {
    ...currentComponents,
    schemas: {
      ...currentSchemas,
      ...Object.fromEntries([...changedSchemas].map((name) => [name, incomingSchemas[name]]))
    }
  } : currentComponents;
  for (const name of changedSchemas) {
    const scope = `Schema ${name.slice(0, 160)}`;
    add(scope, Object.hasOwn(currentSchemas, name) ? "Shared schema definition updated." : "Schema definition added.");
    schemaDetails(currentSchemas[name], incomingSchemas[name], (message) => add(scope, message));
  }
  const mergedGraph = makeComponentGraph(mergedComponents, budget);
  if (changedSchemas.size) {
    // Retained (even unused) components must not acquire a newly dangling
    // pointer, e.g. an alias pointing below a removed property.
    for (const [kind, section] of Object.entries(currentComponents)) {
      for (const [name, definition] of Object.entries(object(section))) {
        if (kind === "schemas" && changedSchemas.has(name)) continue;
        let hadValidReferences = true;
        try { currentGraph.reachable([definition]); }
        catch {
          if (budget.left < 0) throw new OpenApiSchemaUpdateError("The schema reference graph exceeds the safe inspection limit.", "SCHEMA_UPDATE_LIMIT");
          hadValidReferences = false;
        }
        if (hadValidReferences) mergedGraph.reachable([definition]);
      }
    }
  }
  const affected = changedSchemas.size ? existing.filter((request) => {
    if (selectedIds.has(request.id)) return false;
    const currentDeps = currentGraph.reachable(roots(request));
    // Detect both the previous dependency and accidental adoption of a shared schema.
    const mergedDeps = mergedGraph.reachable(roots(request));
    return [...currentDeps, ...mergedDeps].some(({ kind, name }) => kind === "schemas" && changedSchemas.has(name));
  }) : [];
  for (const request of affected) warn(`${label(request)}: a shared schema changes. Review compatibility; this request's saved inputs and metadata are not rewritten.`);
  if (target.openApi?.contractSourceUncertain) warn("A previous safe re-import left mixed contract metadata. Refreshing selected requests does not establish a complete contract baseline.");

  const collection = structuredClone(target);
  if (changedSchemas.size) collection.openApi!.components = structuredClone(mergedComponents);
  const result = index(flattenRequests(collection).map(({ request }) => request));
  const baseUrls = new Map(locations.map(({ request, folderPath }) => [request.id, folderBaseUrl(folderPath) ?? target.baseUrl]));
  let changed = changedSchemas.size > 0;
  for (const { current, updated } of pairs) {
    const operation = label(current);
    const refreshed = structuredClone(updated.openApi!);
    const raw = object(refreshed.rawOperation);
    // This action only refreshes schema/source evidence, not authentication.
    // In particular an incoming declaration must not refer to an uninstalled
    // scheme or change the original operation's export auth behavior.
    const currentOperation = object(current.openApi?.rawOperation);
    if (Object.hasOwn(currentOperation, "security")) raw.security = structuredClone(currentOperation.security);
    else delete raw.security;
    mergedGraph.reachable([raw, refreshed.rawParameters, updated.body.schema]);
    const body = sourceBodyEvidence(raw, mergedComponents);
    const oldMetadata = { ...current.openApi, schemaRefreshed: undefined };
    const updatesCurrent = !equal(oldMetadata, refreshed) || !equal(current.body.schema, body.schema) ||
      current.body.required !== body.required ||
      sourceDependencies.get(current.id)!.some(({ kind, name }) => kind === "schemas" && changedSchemas.has(name));
    conflictWarnings(current, updated, target, incoming, baseUrls.get(current.id), (message) => warn(`${operation}: ${message}`));
    checkSavedBody(current, body.schema, body.required, mergedComponents, (message) => warn(`${operation}: ${message}`));
    if (!updatesCurrent) continue;
    changed = true;
    add(operation, "Source OpenAPI operation metadata and request schema refreshed; saved request and response examples retained.");
    if (current.body.required !== body.required) add(operation,
      body.required ? "Request body is now required." : "Request body is no longer required.");
    schemaDetails(current.body.schema, body.schema, (message) => add(operation, message));
    const request = result.ids.get(current.id)!;
    request.openApi = { ...refreshed, schemaRefreshed: true };
    if (body.schema === undefined) delete request.body.schema;
    else request.body.schema = structuredClone(body.schema);
    if (body.required === undefined) delete request.body.required;
    else request.body.required = body.required;
  }
  const selectedOperations = pairs.map(({ current }) => describe(current));
  const affectedOperations = affected.map(describe);
  const affectedRequestIds = affectedOperations.map(({ id }) => id);
  const approved = options.approvedAffectedRequestIds ?? [];
  const requiresAcknowledgement = !equal([...approved].sort(), [...affectedRequestIds].sort());
  if (changes.length >= MAX_CHANGES) changes.push({ scope: "Preview", message: "Schema detail was capped; the affected operation list is complete." });
  if (warnings.length >= MAX_CHANGES) warnings.push("Some additional compatibility warnings were omitted.");
  return { collection, summary: { changed, selectedRequestIds: selectedOperations.map(({ id }) => id),
    affectedRequestIds, selectedOperations, affectedOperations, requiresAcknowledgement, changes, warnings } };
}
