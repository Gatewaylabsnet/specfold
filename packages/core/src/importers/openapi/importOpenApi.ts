import {
  asArray,
  asRecord,
  asString,
  asStringArray,
  authFromSecurity,
  collectSecuritySchemes,
  countOperations,
  createResponseExample,
  firstPathSegment,
  getRecord,
  HTTP_METHODS,
  parameterToKeyValue,
  parseApiText,
  resolveLocalRef,
  selectJsonLikeContent,
  exampleFromMedia,
  type AnyRecord
} from "../shared";
import { createCollection, createFolder, createKeyValue } from "../../model/factory";
import type {
  ApiRequest,
  Collection,
  Folder,
  GroupingStrategy,
  HttpMethod,
  RequestBody
} from "../../model/types";
import type { ImportOptions, ImportPreview, ImportResult, ParsedApiDocument } from "../types";

export function importOpenApiText(text: string, options: ImportOptions): ImportResult {
  const parsed = parseApiText(text);
  if (parsed.kind !== "openapi3") {
    throw new Error("Expected OpenAPI 3.x document.");
  }
  return importOpenApiDocument(parsed.document, parsed, options);
}

export function importOpenApiDocument(
  document: AnyRecord,
  parsed: ParsedApiDocument,
  options: ImportOptions
): ImportResult {
  const info = getRecord(document, "info");
  const counts = countOperations(document);
  const preview: ImportPreview = {
    title: options.collectionName ?? asString(info.title) ?? "Imported OpenAPI Collection",
    version: asString(info.version),
    kind: parsed.kind,
    format: parsed.format,
    ...counts
  };

  const collection = createCollection(preview.title);
  collection.version = preview.version;
  collection.description = asString(info.description);
  collection.openApi = {
    sourceFormat: "openapi3",
    documentVersion: parsed.version,
    title: preview.title,
    version: preview.version,
    servers: readServers(document),
    components: getRecord(document, "components"),
    securitySchemes: collectSecuritySchemes(document)
  };

  const folderMap = new Map<string, Folder>();
  const warnings: string[] = [];
  const paths = getRecord(document, "paths");
  const securitySchemes = collectSecuritySchemes(document);

  for (const [path, pathItemInput] of Object.entries(paths)) {
    const pathItem = asRecord(pathItemInput);
    for (const method of HTTP_METHODS) {
      const operation = asRecord(pathItem[method]);
      if (Object.keys(operation).length === 0) {
        continue;
      }

      const request = operationToRequest({
        document,
        path,
        method,
        operation,
        pathItem,
        securitySchemes
      });
      placeRequest(collection, folderMap, request, options.grouping, path, request.openApi?.tags ?? []);
    }
  }

  return { collection, preview, warnings };
}

function readServers(document: AnyRecord): string[] {
  return asArray(document.servers)
    .map((server) => asString(asRecord(server).url))
    .filter((url): url is string => Boolean(url));
}

function operationToRequest(input: {
  document: AnyRecord;
  path: string;
  method: string;
  operation: AnyRecord;
  pathItem: AnyRecord;
  securitySchemes: AnyRecord;
}): ApiRequest {
  const { document, path, method, operation, pathItem, securitySchemes } = input;
  const tags = asStringArray(operation.tags);
  const requestBody = requestBodyFromOperation(document, operation);
  const headers = [...requestBody.headers];
  const queryParams = [];
  const pathParams = [];

  const parameters = [
    ...asArray(pathItem.parameters),
    ...asArray(operation.parameters)
  ].map((parameter) => asRecord(resolveLocalRef(document, parameter)));

  for (const parameter of parameters) {
    const location = asString(parameter.in);
    if (!asString(parameter.name)) {
      continue;
    }
    if (location === "query") {
      queryParams.push(parameterToKeyValue(parameter));
    }
    if (location === "path") {
      pathParams.push(parameterToKeyValue(parameter, `{{${asString(parameter.name)}}}`));
    }
    if (location === "header") {
      headers.push(parameterToKeyValue(parameter));
    }
  }

  const responseExamples = responseExamplesFromOperation(document, operation);
  const name =
    asString(operation.summary) ??
    asString(operation.operationId) ??
    `${method.toUpperCase()} ${path}`;

  return {
    id: cryptoId("req"),
    name,
    description: asString(operation.description),
    method: method.toUpperCase() as HttpMethod,
    url: `{{baseUrl}}${path}`,
    queryParams,
    pathParams,
    headers,
    body: requestBody.body,
    auth: authFromSecurity(operation.security, document.security, securitySchemes),
    responseExamples,
    openApi: {
      sourceFormat: "openapi3",
      documentVersion: asString(document.openapi),
      title: asString(getRecord(document, "info").title),
      version: asString(getRecord(document, "info").version),
      servers: readServers(document),
      path,
      method,
      operationId: asString(operation.operationId),
      tags,
      rawOperation: operation
    }
  };
}

function requestBodyFromOperation(
  document: AnyRecord,
  operation: AnyRecord
): { body: RequestBody; headers: ReturnType<typeof createKeyValue>[] } {
  const requestBody = asRecord(resolveLocalRef(document, operation.requestBody));
  const { contentType, media } = selectJsonLikeContent(requestBody.content);
  if (!contentType || Object.keys(media).length === 0) {
    return { body: { mode: "none" }, headers: [] };
  }

  const bodyValue = exampleFromMedia(media);
  const body: RequestBody = {
    mode: contentType.includes("json") ? "json" : "raw",
    contentType,
    raw:
      typeof bodyValue === "string"
        ? bodyValue
        : JSON.stringify(bodyValue ?? {}, null, 2),
    schema: media.schema
  };

  return {
    body,
    headers: [createKeyValue("Content-Type", contentType)]
  };
}

function responseExamplesFromOperation(document: AnyRecord, operation: AnyRecord) {
  const responses = getRecord(operation, "responses");
  const examples = [];
  for (const [statusText, responseInput] of Object.entries(responses)) {
    const response = asRecord(resolveLocalRef(document, responseInput));
    const { contentType, media } = selectJsonLikeContent(response.content);
    if (!contentType || Object.keys(media).length === 0) {
      continue;
    }
    const status = Number.parseInt(statusText, 10);
    examples.push(
      createResponseExample(
        asString(response.description) ?? `${statusText} response`,
        Number.isFinite(status) ? status : 200,
        contentType,
        exampleFromMedia(media)
      )
    );
  }
  return examples;
}

function placeRequest(
  collection: Collection,
  folderMap: Map<string, Folder>,
  request: ApiRequest,
  strategy: GroupingStrategy,
  path: string,
  tags: string[]
): void {
  const folderName =
    strategy === "tags"
      ? tags[0] ?? "Untagged"
      : strategy === "firstPathSegment"
        ? firstPathSegment(path)
        : "Imported Requests";

  let folder = folderMap.get(folderName);
  if (!folder) {
    folder = createFolder(folderName);
    folder.openApi = { tags: [folderName] };
    folderMap.set(folderName, folder);
    collection.folders.push(folder);
  }

  folder.requests.push(request);
}

function cryptoId(prefix: string): string {
  return `${prefix}_${
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2, 12)
  }`;
}

