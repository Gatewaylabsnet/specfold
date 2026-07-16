import type { ApiRequest, AuthConfig, Collection, KeyValue, ResponseExample } from "../../../model/types";
import { resolveLocalRef } from "../../../importers/shared";
import { ensureSecuritySchemes } from "./components";
import { VARIABLE_ONLY, asRecord, inferPrimitiveType, isEnabledKeyValue, parseJsonOrString } from "./shared";
import type { AnyRecord, OpenApiExportOptions, RequestExportItem } from "./types";

export function pathFromRequest(request: ApiRequest): string {
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

export function tagsForRequest(
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

export function operationForRequest(
  request: ApiRequest,
  tags: string[],
  collection: Collection,
  components: AnyRecord,
  options: OpenApiExportOptions
): AnyRecord {
  const raw = sourceOperation(request, options);

  if (!raw) {
    const authSecurity = securityForAuth(request.auth, components, options);
    return {
      summary: request.name,
      description: request.description,
      operationId: request.openApi?.operationId,
      tags,
      parameters: parametersForRequest(request, options),
      requestBody: requestBodyForRequest(request, options),
      responses: responsesForRequest(request, options),
      security: authSecurity.length > 0 ? authSecurity : undefined
    };
  }

  // Fidelity mode: start from the imported operation so schemas, response
  // definitions, security scopes, and unmodeled fields (deprecated,
  // externalDocs, callbacks, ...) survive the round trip, then overlay the
  // fields the app lets the user edit.
  const operation = structuredClone(raw);
  operation.summary = request.name;
  operation.description = request.description ?? operation.description;
  operation.operationId = request.openApi?.operationId ?? operation.operationId;
  operation.tags = tags;
  operation.parameters = mergeParameters(request, asArrayValue(raw.parameters), collection, options);

  if (request.body.mode === "none") {
    delete operation.requestBody;
  } else if (!isRecordValue(operation.requestBody)) {
    operation.requestBody = requestBodyForRequest(request, options);
  } else if (options.includeRequestExamples && request.body.raw) {
    refreshBodyExample(operation.requestBody as AnyRecord, request.body.raw);
  }

  if (!isRecordValue(operation.responses) || Object.keys(operation.responses as AnyRecord).length === 0) {
    operation.responses = responsesForRequest(request, options);
  }

  if (Array.isArray(operation.security) && operation.security.length > 0) {
    // Original security requirements win (they keep OAuth2 scopes the app
    // cannot model); make sure the schemes they reference are exported too.
    copyReferencedSecuritySchemes(operation.security, collection, components);
  } else {
    const authSecurity = securityForAuth(request.auth, components, options);
    if (authSecurity.length > 0) {
      operation.security = authSecurity;
    }
  }

  return operation;
}

export function sourceOperation(request: ApiRequest, options: OpenApiExportOptions): AnyRecord | undefined {
  if (options.preferSourceOperation === false) {
    return undefined;
  }
  if (request.openApi?.sourceFormat !== "openapi3") {
    return undefined;
  }
  const raw = request.openApi.rawOperation;
  return isRecordValue(raw) && Object.keys(raw).length > 0 ? (raw as AnyRecord) : undefined;
}

/**
 * Keep the original parameter objects (including $refs) for parameters that
 * still exist by name+location, synthesize objects for user-added ones, and
 * drop originals the user deleted or disabled.
 */
export function mergeParameters(
  request: ApiRequest,
  rawParameters: unknown[],
  collection: Collection,
  options: OpenApiExportOptions
): AnyRecord[] {
  const pseudoDocument: AnyRecord = { components: asRecord(collection.openApi?.components) };
  const originals = rawParameters.map((parameter) => ({
    raw: parameter,
    resolved: asRecord(resolveLocalRef(pseudoDocument, parameter))
  }));
  const findOriginal = (name: string, location: string) =>
    originals.find(
      ({ resolved }) => resolved.name === name && resolved.in === location
    );

  const result: AnyRecord[] = [];
  const emit = (item: KeyValue, location: string, required: boolean) => {
    const original = findOriginal(item.key, location);
    if (original) {
      result.push(original.raw as AnyRecord);
    } else {
      result.push(parameterObject(item, location, required, options));
    }
  };

  for (const item of request.pathParams.filter(isEnabledKeyValue)) {
    emit(item, "path", true);
  }
  for (const item of request.queryParams.filter(isEnabledKeyValue)) {
    emit(item, "query", false);
  }
  for (const item of request.headers.filter(isEnabledKeyValue)) {
    const key = item.key.toLowerCase();
    if (key === "content-type" || key === "authorization") {
      continue;
    }
    emit(item, "header", false);
  }
  return result;
}

/** Update the example of the first JSON-like media type with the edited body. */
export function refreshBodyExample(requestBody: AnyRecord, rawBody: string): void {
  const content = asRecord(requestBody.content);
  const jsonKey =
    Object.keys(content).find((key) => key.includes("json")) ?? Object.keys(content)[0];
  if (!jsonKey) {
    return;
  }
  const media = asRecord(content[jsonKey]);
  media.example = parseJsonOrString(rawBody);
  content[jsonKey] = media;
  requestBody.content = content;
}

export function copyReferencedSecuritySchemes(
  security: unknown[],
  collection: Collection,
  components: AnyRecord
): void {
  const knownSchemes = asRecord(collection.openApi?.securitySchemes);
  if (Object.keys(knownSchemes).length === 0) {
    return;
  }
  const securitySchemes = ensureSecuritySchemes(components);
  for (const requirement of security) {
    if (typeof requirement !== "object" || requirement === null) {
      continue;
    }
    for (const name of Object.keys(requirement as AnyRecord)) {
      if (knownSchemes[name] !== undefined && securitySchemes[name] === undefined) {
        securitySchemes[name] = knownSchemes[name];
      }
    }
  }
}

export function isRecordValue(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asArrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parametersForRequest(request: ApiRequest, options: OpenApiExportOptions): AnyRecord[] {
  const params: AnyRecord[] = [];
  for (const item of request.pathParams.filter(isEnabledKeyValue)) {
    params.push(parameterObject(item, "path", true, options));
  }
  for (const item of request.queryParams.filter(isEnabledKeyValue)) {
    params.push(parameterObject(item, "query", false, options));
  }
  for (const item of request.headers.filter(isEnabledKeyValue)) {
    if (item.key.toLowerCase() === "content-type" || item.key.toLowerCase() === "authorization") {
      continue;
    }
    params.push(parameterObject(item, "header", false, options));
  }
  return params;
}

export function parameterObject(
  item: KeyValue,
  location: string,
  required: boolean,
  options: OpenApiExportOptions
): AnyRecord {
  const emitExample =
    options.includeParameterExamples === true &&
    Boolean(item.value) &&
    !VARIABLE_ONLY.test(item.value);
  return {
    name: item.key,
    in: location,
    required,
    description: item.description,
    schema: { type: inferPrimitiveType(item.value) },
    example: emitExample ? item.value : undefined
  };
}

export function requestBodyForRequest(
  request: ApiRequest,
  options: OpenApiExportOptions
): AnyRecord | undefined {
  if (request.body.mode === "none") {
    return undefined;
  }

  if (request.body.mode === "form") {
    const pairs = (request.body.form ?? []).filter(isEnabledKeyValue);
    const properties: AnyRecord = {};
    const example: AnyRecord = {};
    for (const pair of pairs) {
      properties[pair.key] = { type: "string" };
      if (options.includeRequestExamples) {
        example[pair.key] = pair.value;
      }
    }
    return {
      required: true,
      content: {
        "application/x-www-form-urlencoded": {
          schema: { type: "object", properties },
          example: options.includeRequestExamples ? example : undefined
        }
      }
    };
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

export function responsesForRequest(
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

export function headersForResponse(example: ResponseExample): AnyRecord | undefined {
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

export function securityForAuth(
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

