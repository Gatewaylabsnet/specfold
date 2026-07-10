import { stringify as stringifyYaml } from "yaml";
import type {
  ApiRequest,
  AuthConfig,
  Collection,
  Folder,
  KeyValue,
  ResponseExample
} from "../../model/types";
import { findFolder, flattenRequests, visitFolders } from "../../model/traversal";

export type OpenApiExportFormat = "yaml" | "json";

export interface OpenApiExportOptions {
  format: OpenApiExportFormat;
  folderIds?: string[];
  useFolderNamesAsTags: boolean;
  includeRequestExamples: boolean;
  includeResponseExamples: boolean;
  includeBearerJwtSecurityScheme: boolean;
  includeAllComponents: boolean;
}

interface RequestExportItem {
  request: ApiRequest;
  folderPath: Folder[];
}

type AnyRecord = Record<string, unknown>;

export function exportCollectionToOpenApi(
  collection: Collection,
  options: OpenApiExportOptions
): string {
  const document = exportCollectionToOpenApiDocument(collection, options);
  if (options.format === "json") {
    return JSON.stringify(document, null, 2);
  }
  return stringifyYaml(document, { indent: 2 });
}

export function exportCollectionToOpenApiDocument(
  collection: Collection,
  options: OpenApiExportOptions
): AnyRecord {
  const selectedRequests = selectRequests(collection, options.folderIds);
  const components = buildInitialComponents(collection, options);
  const paths: AnyRecord = {};
  const tagNames = new Set<string>();

  for (const item of selectedRequests) {
    const path = pathFromRequest(item.request);
    const method = item.request.method.toLowerCase();
    const tags = tagsForRequest(collection, item, options);
    tags.forEach((tag) => tagNames.add(tag));
    const authSecurity = securityForAuth(item.request.auth, components, options);

    const pathItem = (paths[path] ?? {}) as AnyRecord;
    pathItem[method] = {
      summary: item.request.name,
      description: item.request.description,
      operationId: item.request.openApi?.operationId,
      tags,
      parameters: parametersForRequest(item.request),
      requestBody: requestBodyForRequest(item.request, options),
      responses: responsesForRequest(item.request, options),
      security: authSecurity.length > 0 ? authSecurity : undefined
    };
    paths[path] = stripUndefined(pathItem);
  }

  const document: AnyRecord = {
    openapi: "3.0.3",
    info: {
      title: collection.name,
      version: collection.version ?? "0.1.0",
      description: collection.description
    },
    servers: serverList(collection),
    tags: [...tagNames].sort().map((name) => ({ name })),
    paths,
    components: Object.keys(components).length > 0 ? components : undefined
  };

  return stripUndefined(document);
}

function selectRequests(collection: Collection, folderIds?: string[]): RequestExportItem[] {
  if (!folderIds || folderIds.length === 0) {
    return flattenRequests(collection).map(({ request, folderPath }) => ({
      request,
      folderPath
    }));
  }

  const selected = new Map<string, RequestExportItem>();
  for (const folderId of folderIds) {
    const folder = findFolder(collection, folderId);
    if (!folder) {
      continue;
    }
    collectFolderRequests(folder, [folder], (request, folderPath) => {
      selected.set(request.id, { request, folderPath });
    });
  }
  return [...selected.values()];
}

function collectFolderRequests(
  folder: Folder,
  path: Folder[],
  visitor: (request: ApiRequest, folderPath: Folder[]) => void
): void {
  folder.requests.forEach((request) => visitor(request, path));
  for (const child of folder.folders) {
    collectFolderRequests(child, [...path, child], visitor);
  }
}

function buildInitialComponents(
  collection: Collection,
  options: OpenApiExportOptions
): AnyRecord {
  const components: AnyRecord = {};
  if (options.includeAllComponents) {
    const importedComponents = asRecord(collection.openApi?.components);
    for (const [key, value] of Object.entries(importedComponents)) {
      if (key === "definitions") {
        components.schemas = value;
      } else {
        components[key] = value;
      }
    }
  }
  return components;
}

function serverList(collection: Collection): Array<{ url: string }> {
  const servers = collection.openApi?.servers?.filter(Boolean) ?? [];
  if (servers.length > 0) {
    return servers.map((url) => ({ url }));
  }
  return [{ url: "{{baseUrl}}" }];
}

function pathFromRequest(request: ApiRequest): string {
  if (request.openApi?.path) {
    return request.openApi.path;
  }

  let url = request.url.trim().replace(/^\{\{\s*baseUrl\s*\}\}/, "");
  if (!url) {
    return "/";
  }

  if (/^https?:\/\//i.test(url)) {
    const parsed = new URL(url);
    url = parsed.pathname;
  } else {
    url = url.split("?")[0] ?? url;
  }

  return url.startsWith("/") ? url : `/${url}`;
}

function tagsForRequest(
  collection: Collection,
  item: RequestExportItem,
  options: OpenApiExportOptions
): string[] {
  if (options.useFolderNamesAsTags && item.folderPath.length > 0) {
    return [item.folderPath[item.folderPath.length - 1].name];
  }
  if (item.request.openApi?.tags && item.request.openApi.tags.length > 0) {
    return item.request.openApi.tags;
  }
  return [item.folderPath[item.folderPath.length - 1]?.name ?? collection.name];
}

function parametersForRequest(request: ApiRequest): AnyRecord[] {
  const params: AnyRecord[] = [];
  for (const item of request.pathParams.filter(isEnabledKeyValue)) {
    params.push(parameterObject(item, "path", true));
  }
  for (const item of request.queryParams.filter(isEnabledKeyValue)) {
    params.push(parameterObject(item, "query", false));
  }
  for (const item of request.headers.filter(isEnabledKeyValue)) {
    if (item.key.toLowerCase() === "content-type" || item.key.toLowerCase() === "authorization") {
      continue;
    }
    params.push(parameterObject(item, "header", false));
  }
  return params;
}

function parameterObject(item: KeyValue, location: string, required: boolean): AnyRecord {
  return {
    name: item.key,
    in: location,
    required,
    description: item.description,
    schema: { type: inferPrimitiveType(item.value) },
    example: item.value || undefined
  };
}

function requestBodyForRequest(
  request: ApiRequest,
  options: OpenApiExportOptions
): AnyRecord | undefined {
  if (request.body.mode === "none") {
    return undefined;
  }

  const contentType = request.body.contentType ?? "application/json";
  const media: AnyRecord = {
    schema: request.body.schema ?? { type: "object" }
  };
  if (options.includeRequestExamples && request.body.raw) {
    media.example = parseJsonOrString(request.body.raw);
  }

  return {
    required: true,
    content: {
      [contentType]: media
    }
  };
}

function responsesForRequest(
  request: ApiRequest,
  options: OpenApiExportOptions
): AnyRecord {
  if (!options.includeResponseExamples || request.responseExamples.length === 0) {
    return {
      "200": {
        description: "Successful response"
      }
    };
  }

  const responses: AnyRecord = {};
  for (const example of request.responseExamples) {
    const contentType = example.contentType ?? "application/json";
    responses[String(example.status)] = {
      description: example.name,
      headers: headersForResponse(example),
      content: {
        [contentType]: {
          example: parseJsonOrString(example.body ?? "")
        }
      }
    };
  }
  return responses;
}

function headersForResponse(example: ResponseExample): AnyRecord | undefined {
  const headers: AnyRecord = {};
  for (const header of example.headers.filter(isEnabledKeyValue)) {
    if (header.key.toLowerCase() === "content-type") {
      continue;
    }
    headers[header.key] = {
      schema: { type: inferPrimitiveType(header.value) },
      example: header.value
    };
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function securityForAuth(
  auth: AuthConfig,
  components: AnyRecord,
  options: OpenApiExportOptions
): AnyRecord[] {
  if (auth.type === "none") {
    return [];
  }

  const securitySchemes = ensureSecuritySchemes(components);
  if (auth.type === "bearer" && options.includeBearerJwtSecurityScheme) {
    securitySchemes.BearerAuth = {
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT"
    };
    return [{ BearerAuth: [] }];
  }

  if (auth.type === "basic") {
    securitySchemes.BasicAuth = {
      type: "http",
      scheme: "basic"
    };
    return [{ BasicAuth: [] }];
  }

  if (auth.type === "apiKey") {
    const name = auth.key || "ApiKey";
    securitySchemes.ApiKeyAuth = {
      type: "apiKey",
      in: auth.in,
      name
    };
    return [{ ApiKeyAuth: [] }];
  }

  return [];
}

function ensureSecuritySchemes(components: AnyRecord): AnyRecord {
  const existing = asRecord(components.securitySchemes);
  components.securitySchemes = existing;
  return existing;
}

function isEnabledKeyValue(item: KeyValue): boolean {
  return item.enabled && Boolean(item.key.trim());
}

function inferPrimitiveType(value: string): "boolean" | "number" | "string" {
  if (value === "true" || value === "false") {
    return "boolean";
  }
  if (value.trim() !== "" && Number.isFinite(Number(value))) {
    return "number";
  }
  return "string";
}

function parseJsonOrString(value: string): unknown {
  if (!value.trim()) {
    return {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)).filter((item) => item !== undefined) as T;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const result: AnyRecord = {};
  for (const [key, child] of Object.entries(value as AnyRecord)) {
    if (child !== undefined) {
      result[key] = stripUndefined(child);
    }
  }
  return result as T;
}

function asRecord(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as AnyRecord)
    : {};
}

