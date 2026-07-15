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
  schemaToExample,
  type AnyRecord
} from "../shared";
import { createCollection, createFolder, createId, createKeyValue } from "../../model/factory";
import type {
  ApiRequest,
  Collection,
  Folder,
  GroupingStrategy,
  HttpMethod,
  RequestBody
} from "../../model/types";
import type { ImportOptions, ImportPreview, ImportResult, ParsedApiDocument } from "../types";

export function importSwagger2Text(text: string, options: ImportOptions): ImportResult {
  const parsed = parseApiText(text);
  if (parsed.kind !== "swagger2") {
    throw new Error("Expected Swagger 2.0 document.");
  }
  return importSwagger2Document(parsed.document, parsed, options);
}

export function importSwagger2Document(
  document: AnyRecord,
  parsed: ParsedApiDocument,
  options: ImportOptions
): ImportResult {
  const info = getRecord(document, "info");
  const counts = countOperations(document);
  const preview: ImportPreview = {
    title: options.collectionName ?? asString(info.title) ?? "Imported Swagger Collection",
    version: asString(info.version),
    kind: parsed.kind,
    format: parsed.format,
    ...counts
  };

  const collection = createCollection(preview.title);
  collection.version = preview.version;
  collection.description = asString(info.description);
  collection.baseUrl = swaggerBaseUrl(document) || undefined;
  collection.openApi = {
    sourceFormat: "swagger2",
    documentVersion: parsed.version,
    title: preview.title,
    version: preview.version,
    servers: [swaggerBaseUrl(document)].filter(Boolean),
    basePath: asString(document.basePath),
    components: {
      definitions: getRecord(document, "definitions"),
      parameters: getRecord(document, "parameters"),
      responses: getRecord(document, "responses")
    },
    securitySchemes: collectSecuritySchemes(document)
  };

  const folderMap = new Map<string, Folder>();
  const paths = getRecord(document, "paths");
  const securitySchemes = collectSecuritySchemes(document);
  const selectedKeys = options.operationKeys ? new Set(options.operationKeys) : undefined;

  for (const [path, pathItemInput] of Object.entries(paths)) {
    const pathItem = asRecord(pathItemInput);
    for (const method of HTTP_METHODS) {
      const operation = asRecord(pathItem[method]);
      if (Object.keys(operation).length === 0) {
        continue;
      }
      if (selectedKeys && !selectedKeys.has(`${method} ${path}`)) {
        continue;
      }

      const request = swaggerOperationToRequest({
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

  return { collection, preview, warnings: [] };
}

function swaggerBaseUrl(document: AnyRecord): string {
  const scheme = asStringArray(document.schemes)[0] ?? "https";
  const host = asString(document.host);
  const basePath = asString(document.basePath) ?? "";
  return host ? `${scheme}://${host}${basePath}` : "";
}

function swaggerOperationToRequest(input: {
  document: AnyRecord;
  path: string;
  method: string;
  operation: AnyRecord;
  pathItem: AnyRecord;
  securitySchemes: AnyRecord;
}): ApiRequest {
  const { document, path, method, operation, pathItem, securitySchemes } = input;
  const tags = asStringArray(operation.tags);
  const headers = [];
  const queryParams = [];
  const pathParams = [];
  let body: RequestBody = { mode: "none" };

  const parameters = [
    ...asArray(pathItem.parameters),
    ...asArray(operation.parameters)
  ].map((parameter) => asRecord(resolveLocalRef(document, parameter)));

  for (const parameter of parameters) {
    const location = asString(parameter.in);
    const name = asString(parameter.name);
    if (!name) {
      continue;
    }
    if (location === "query") {
      queryParams.push(parameterToKeyValue(parameter));
    }
    if (location === "path") {
      pathParams.push(parameterToKeyValue(parameter, `{{${name}}}`));
    }
    if (location === "header") {
      headers.push(parameterToKeyValue(parameter));
    }
    if (location === "body") {
      const example = schemaToExample(parameter.schema);
      body = {
        mode: "json",
        contentType: firstJsonConsumeType(document, operation),
        raw: JSON.stringify(example, null, 2),
        schema: parameter.schema
      };
    }
  }

  if (body.mode === "json" && body.contentType) {
    headers.push(createKeyValue("Content-Type", body.contentType));
  }

  return {
    id: createId("req"),
    name:
      asString(operation.summary) ??
      asString(operation.operationId) ??
      `${method.toUpperCase()} ${path}`,
    description: asString(operation.description),
    method: method.toUpperCase() as HttpMethod,
    url: `{{baseUrl}}${path}`,
    queryParams,
    pathParams,
    headers,
    body,
    auth: authFromSecurity(operation.security, document.security, securitySchemes),
    responseExamples: swaggerResponseExamples(document, operation),
    openApi: {
      sourceFormat: "swagger2",
      documentVersion: asString(document.swagger),
      title: asString(getRecord(document, "info").title),
      version: asString(getRecord(document, "info").version),
      servers: [swaggerBaseUrl(document)].filter(Boolean),
      path,
      method,
      operationId: asString(operation.operationId),
      tags,
      rawOperation: operation
    }
  };
}

function firstJsonConsumeType(document: AnyRecord, operation: AnyRecord): string {
  const operationConsumes = asStringArray(operation.consumes);
  const documentConsumes = asStringArray(document.consumes);
  return (
    operationConsumes.find((value) => value.includes("json")) ??
    documentConsumes.find((value) => value.includes("json")) ??
    "application/json"
  );
}

function swaggerResponseExamples(document: AnyRecord, operation: AnyRecord) {
  const responses = getRecord(operation, "responses");
  const examples = [];
  for (const [statusText, responseInput] of Object.entries(responses)) {
    const response = asRecord(resolveLocalRef(document, responseInput));
    const examplesObject = getRecord(response, "examples");
    const exampleValue =
      examplesObject["application/json"] ??
      examplesObject["text/json"] ??
      schemaToExample(response.schema);
    const status = Number.parseInt(statusText, 10);
    examples.push(
      createResponseExample(
        asString(response.description) ?? `${statusText} response`,
        Number.isFinite(status) ? status : 200,
        "application/json",
        exampleValue
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
