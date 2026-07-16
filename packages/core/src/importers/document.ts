import { parseCollectionJson } from "../exporters/collection-json/collectionJson";
import { parse as parseYaml } from "yaml";
import {
  createCollection,
  createEnvironment,
  createFolder,
  createId,
  createKeyValue,
  createRequest
} from "../model/factory";
import type {
  ApiRequest,
  AuthConfig,
  Collection,
  Environment,
  EnvironmentVariable,
  Folder,
  HttpMethod,
  KeyValue,
  RequestBody,
  ResponseExample
} from "../model/types";
import { importApiDocument, previewApiDocument } from "./index";
import { asArray, asRecord, asString, isRecord, type AnyRecord } from "./shared";
import type { ApiDocumentKind, ImportOptions, SourceTextFormat } from "./types";

export type ImportDocumentKind =
  | ApiDocumentKind
  | "collection-json"
  | "postman"
  | "insomnia"
  | "har"
  | "http-file";

export interface PostmanV3FolderFile {
  /** Forward-slash path relative to the selected collection root. */
  path: string;
  content: string;
}

export interface PostmanV3FolderSource {
  rootName: string;
  files: PostmanV3FolderFile[];
  skippedScriptCount?: number;
}

export interface ImportDocumentPreview {
  kind: ImportDocumentKind;
  label: string;
  format: SourceTextFormat;
  title: string;
  version?: string;
  collectionCount: number;
  requestCount: number;
  containerCount: number;
  containerLabel: "paths" | "folders";
}

export interface ImportDocumentResult {
  kind: ImportDocumentKind;
  collections: Collection[];
  environments: Environment[];
  preview: ImportDocumentPreview;
  warnings: string[];
}

const SPEC_FOLD_SCHEMAS = new Set([
  "specfold.collection.v1",
  "openapi-collection-studio.collection.v1"
]);
const SUPPORTED_METHODS = new Set<HttpMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD"
]);

export function previewImportDocument(text: string): ImportDocumentPreview {
  if (looksLikeHttpFile(text)) {
    return importHttpFile(text).preview;
  }
  const json = tryParseJsonRecord(text);
  if (json) {
    if (isSpecfoldCollectionDocument(json)) {
      const collection = parseCollectionJson(text);
      return previewCollections("collection-json", "Specfold Collection JSON", [collection], [], "v1");
    }
    const portable = importPortableJson(json);
    if (portable) {
      return portable.preview;
    }
    if (!hasApiVersionMarker(json)) {
      throw unsupportedJsonFormatError(json);
    }
  }

  const preview = previewApiDocument(text);
  return {
    kind: preview.kind,
    label: preview.kind === "openapi3" ? "OpenAPI 3.x" : "Swagger 2.0",
    format: preview.format,
    title: preview.title,
    version: preview.version,
    collectionCount: 1,
    requestCount: preview.operationCount,
    containerCount: preview.pathCount,
    containerLabel: "paths"
  };
}

export function importDocument(text: string, options: ImportOptions): ImportDocumentResult {
  if (looksLikeHttpFile(text)) {
    return importHttpFile(text);
  }
  const json = tryParseJsonRecord(text);
  if (json) {
    if (isSpecfoldCollectionDocument(json)) {
      const collection = parseCollectionJson(text);
      return {
        kind: "collection-json",
        collections: [collection],
        environments: [],
        preview: previewCollections("collection-json", "Specfold Collection JSON", [collection], [], "v1"),
        warnings: []
      };
    }
    const portable = importPortableJson(json);
    if (portable) {
      return portable;
    }
    if (!hasApiVersionMarker(json)) {
      throw unsupportedJsonFormatError(json);
    }
  }

  const imported = importApiDocument(text, options);
  return {
    kind: imported.preview.kind,
    collections: [imported.collection],
    environments: [],
    preview: {
      kind: imported.preview.kind,
      label: imported.preview.kind === "openapi3" ? "OpenAPI 3.x" : "Swagger 2.0",
      format: imported.preview.format,
      title: imported.preview.title,
      version: imported.preview.version,
      collectionCount: 1,
      requestCount: imported.preview.operationCount,
      containerCount: imported.preview.pathCount,
      containerLabel: "paths"
    },
    warnings: imported.warnings
  };
}

/** Detect JetBrains/VS Code style .http and .rest request documents. */
export function looksLikeHttpFile(text: string): boolean {
  return /(?:^|\n)\s*(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+\S+/i.test(text);
}

/**
 * Import the portable, declarative subset shared by the common .http/.rest
 * dialects. Executable pre/post-request scripts and file-backed bodies are
 * deliberately not evaluated.
 */
export function importHttpFile(text: string): ImportDocumentResult {
  const warnings: string[] = [];
  const variables = httpFileVariables(text);
  const collection = createCollection("HTTP Requests");
  collection.openApi = { sourceFormat: "http-file", documentVersion: "1" };

  const sections = splitHttpSections(text);
  for (const [index, section] of sections.entries()) {
    const request = requestFromHttpSection(section.lines, section.name, index, warnings);
    if (request) {
      collection.requests.push(request);
    }
  }

  if (collection.requests.length === 0) {
    throw new Error("No supported HTTP requests were found in this .http/.rest document.");
  }

  const environments = variables.length > 0
    ? [environmentFromVariables("HTTP file variables", variables)]
    : [];
  const preview = previewCollections(
    "http-file",
    "HTTP request file",
    [collection],
    environments,
    undefined,
    "text"
  );
  return {
    kind: "http-file",
    collections: [collection],
    environments,
    preview,
    warnings
  };
}

interface HttpSection {
  name?: string;
  lines: string[];
}

function splitHttpSections(text: string): HttpSection[] {
  const sections: HttpSection[] = [{ lines: [] }];
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const separator = /^\s*###(?:\s+(.*?))?\s*$/.exec(line);
    if (separator) {
      sections.push({ name: separator[1]?.trim() || undefined, lines: [] });
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }
  return sections.filter((section) => section.lines.some((line) => line.trim()));
}

function httpFileVariables(text: string): EnvironmentVariable[] {
  const seen = new Set<string>();
  const variables: EnvironmentVariable[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*@([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || seen.has(match[1])) {
      continue;
    }
    seen.add(match[1]);
    variables.push({
      id: createId("envvar"),
      name: match[1],
      value: match[2],
      enabled: true,
      secret: looksSecret(match[1])
    });
  }
  return variables;
}

function requestFromHttpSection(
  lines: string[],
  sectionName: string | undefined,
  index: number,
  warnings: string[]
): ApiRequest | undefined {
  let requestLineIndex = -1;
  let requestName = sectionName;
  const description: string[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const trimmed = lines[lineIndex].trim();
    const named = /^#\s*@name\s+(.+)$/i.exec(trimmed) ?? /^\/\/\s*@name\s+(.+)$/i.exec(trimmed);
    if (named) {
      requestName = named[1].trim();
      continue;
    }
    if (!trimmed || /^@[A-Za-z_][A-Za-z0-9_.-]*\s*=/.test(trimmed)) {
      continue;
    }
    if (/^(?:#|\/\/)/.test(trimmed)) {
      description.push(trimmed.replace(/^(?:#|\/\/)\s?/, ""));
      continue;
    }
    if (/^(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+\S+/i.test(trimmed)) {
      requestLineIndex = lineIndex;
    }
    break;
  }

  if (requestLineIndex < 0) {
    if (lines.some((line) => line.trim() && !/^(?:#|\/\/|@)/.test(line.trim()))) {
      warnings.push(`Skipped HTTP section ${index + 1}: no supported request line was found.`);
    }
    return undefined;
  }

  const requestLine = lines[requestLineIndex].trim();
  const match = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+?)(?:\s+HTTP\/\d(?:\.\d)?)?\s*$/i.exec(requestLine);
  if (!match) {
    warnings.push(`Skipped HTTP section ${index + 1}: invalid request line.`);
    return undefined;
  }

  const method = match[1].toUpperCase() as HttpMethod;
  const split = splitUrl(match[2]);
  const headers: KeyValue[] = [];
  let cursor = requestLineIndex + 1;
  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (!line.trim()) {
      cursor += 1;
      break;
    }
    if (/^\s*(?:#|\/\/)/.test(line)) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator <= 0) {
      break;
    }
    headers.push(createKeyValue(line.slice(0, separator).trim(), line.slice(separator + 1).trim()));
  }

  let bodyLines = lines.slice(cursor);
  const scriptIndex = bodyLines.findIndex((line) => /^\s*>\s*\{%/.test(line));
  if (scriptIndex >= 0) {
    bodyLines = bodyLines.slice(0, scriptIndex);
    warnings.push(`${requestName ?? `HTTP request ${index + 1}`}: response handler script was not imported.`);
  }
  const bodyText = bodyLines.join("\n").trim();
  let body: RequestBody = { mode: "none" };
  if (/^<\s+\S+/.test(bodyText)) {
    warnings.push(`${requestName ?? `HTTP request ${index + 1}`}: file-backed request body requires manual selection.`);
  } else if (bodyText) {
    const contentType = contentTypeFromHeaders(headers);
    if (contentType?.toLowerCase().includes("application/x-www-form-urlencoded")) {
      body = {
        mode: "form",
        contentType,
        form: bodyText.split("&").filter(Boolean).map((pair) => {
          const separator = pair.indexOf("=");
          return createKeyValue(
            safeDecode(separator >= 0 ? pair.slice(0, separator) : pair),
            safeDecode(separator >= 0 ? pair.slice(separator + 1) : "")
          );
        })
      };
    } else {
      body = rawBody(bodyText, contentType);
    }
  }

  const request = createRequest({
    name: requestName ?? `${method} ${split.url}`,
    method,
    url: split.url
  });
  request.description = description.length > 0 ? description.join("\n") : undefined;
  request.queryParams = split.queryParams;
  request.headers = headers;
  request.body = body;
  request.auth = authFromHeaders(headers);
  request.openApi = { sourceFormat: "http-file", method, path: split.url };
  return request;
}

/** Import a Postman Collection schema 3.0 folder selected by the desktop app. */
export function importPostmanV3Folder(
  source: PostmanV3FolderSource,
  _options?: ImportOptions
): ImportDocumentResult {
  if (!source.files.length) {
    throw new Error("The selected folder does not contain Postman v3 YAML files.");
  }

  const warnings: string[] = [];
  const parsedFiles = new Map<string, AnyRecord>();
  for (const file of source.files) {
    const path = normalizeBundlePath(file.path);
    if (!path || path.split("/").includes("..")) {
      throw new Error("The Postman folder contains an invalid relative path.");
    }
    try {
      const parsed = parseYaml(file.content) as unknown;
      if (isRecord(parsed)) {
        parsedFiles.set(path, parsed);
      } else {
        warnings.push(`Skipped ${path}: the YAML root is not an object.`);
      }
    } catch (error) {
      warnings.push(`Skipped ${path}: ${(error as Error).message}`);
    }
  }

  const requestPaths = [...parsedFiles.keys()].filter((path) => /\.request\.ya?ml$/i.test(path));
  if (requestPaths.length === 0) {
    throw new Error("No *.request.yaml files were found in the selected Postman v3 folder.");
  }

  const rootDefinition = postmanV3Definition(parsedFiles, "");
  const rootInfo = asRecord(rootDefinition.info);
  const rootName =
    asString(rootDefinition.name) ?? asString(rootInfo.name) ?? source.rootName ?? "Imported Postman Collection";
  const resourceExamples = postmanV3ResourceExamples(parsedFiles, warnings);
  const rootNode = createPostmanV3Node("", rootName, rootDefinition);

  for (const requestPath of requestPaths) {
    const segments = requestPath.split("/");
    const fileName = segments.pop() ?? requestPath;
    let node = rootNode;
    let currentPath = "";
    for (const segment of segments) {
      if (segment.endsWith(".resources")) {
        node = rootNode;
        break;
      }
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let child = node.children.get(segment);
      if (!child) {
        const definition = postmanV3Definition(parsedFiles, currentPath);
        child = createPostmanV3Node(currentPath, segment, definition);
        node.children.set(segment, child);
      }
      node = child;
    }
    const document = parsedFiles.get(requestPath);
    if (document) {
      const item = postmanV3RequestItem(document, fileName, resourceExamples.get(requestPath) ?? [], warnings);
      if (item) {
        node.requests.push({ item, order: postmanV3Order(document), path: requestPath });
      }
    }
  }

  const postmanDocument: AnyRecord = {
    info: {
      name: rootName,
      description: descriptionText(rootDefinition.description) ?? descriptionText(rootInfo.description),
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    auth: rootDefinition.auth,
    variable: postmanV3Variables(rootDefinition.variables ?? rootDefinition.variable),
    item: postmanV3NodeItems(rootNode)
  };
  const result = importPostmanCollection(postmanDocument);
  result.preview = {
    ...result.preview,
    label: "Postman Collection folder",
    format: "yaml",
    version: "3.0.0"
  };
  result.collections[0].openApi = {
    ...result.collections[0].openApi,
    sourceFormat: "postman",
    documentVersion: "3.0.0"
  };
  result.warnings.unshift(...warnings);
  const scripts = source.skippedScriptCount ?? [...parsedFiles.keys()].filter((path) => /\/scripts\//i.test(path)).length;
  if (scripts > 0) {
    result.warnings.push(`${scripts} Postman script file(s) were not imported or executed.`);
  }
  return result;
}

export function previewPostmanV3Folder(source: PostmanV3FolderSource): ImportDocumentPreview {
  return importPostmanV3Folder(source).preview;
}

interface PostmanV3Node {
  path: string;
  fallbackName: string;
  definition: AnyRecord;
  children: Map<string, PostmanV3Node>;
  requests: Array<{ item: AnyRecord; order: number; path: string }>;
}

function createPostmanV3Node(path: string, fallbackName: string, definition: AnyRecord): PostmanV3Node {
  return { path, fallbackName, definition, children: new Map(), requests: [] };
}

function normalizeBundlePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
}

function postmanV3Definition(files: Map<string, AnyRecord>, folderPath: string): AnyRecord {
  const prefix = folderPath ? `${folderPath}/` : "";
  return files.get(`${prefix}.resources/definition.yaml`)
    ?? files.get(`${prefix}.resources/definition.yml`)
    ?? files.get(`${prefix}definition.yaml`)
    ?? files.get(`${prefix}definition.yml`)
    ?? {};
}

function postmanV3NodeItems(node: PostmanV3Node): AnyRecord[] {
  const children = [...node.children.values()].map((child) => ({
    kind: "folder" as const,
    order: postmanV3Order(child.definition),
    path: child.path,
    value: {
      name: asString(child.definition.name) ?? child.fallbackName,
      description: descriptionText(child.definition.description),
      auth: child.definition.auth,
      item: postmanV3NodeItems(child)
    } as AnyRecord
  }));
  const requests = node.requests.map((request) => ({
    kind: "request" as const,
    order: request.order,
    path: request.path,
    value: request.item
  }));
  return [...children, ...requests]
    .sort((left, right) => left.order - right.order || left.path.localeCompare(right.path))
    .map((entry) => entry.value);
}

function postmanV3Order(document: AnyRecord): number {
  const meta = asRecord(document.meta);
  const value = document.order ?? document.index ?? document.sortIndex ?? meta.order ?? meta.index;
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
}

function postmanV3Variables(input: unknown): AnyRecord[] {
  if (Array.isArray(input)) {
    return input.map(asRecord);
  }
  const record = asRecord(input);
  return Object.entries(record).map(([key, inputValue]) => {
    const value = asRecord(inputValue);
    return Object.keys(value).length > 0
      ? { key, value: value.value ?? value.currentValue ?? "", type: value.type, disabled: value.disabled }
      : { key, value: inputValue };
  });
}

function postmanV3Headers(input: unknown): unknown {
  if (Array.isArray(input) || typeof input === "string") {
    return input;
  }
  return Object.entries(asRecord(input)).map(([key, inputValue]) => {
    const value = asRecord(inputValue);
    return Object.keys(value).length > 0
      ? { key, value: value.value ?? value.currentValue ?? "", disabled: value.disabled }
      : { key, value: inputValue };
  });
}

function postmanV3RequestItem(
  document: AnyRecord,
  fileName: string,
  resourceExamples: AnyRecord[],
  warnings: string[]
): AnyRecord | undefined {
  const directRequest = asRecord(document.request);
  const request = Object.keys(directRequest).length > 0 ? directRequest : document;
  const type =
    asString(request.$kind) ?? asString(document.$kind) ?? asString(request.type) ?? asString(document.type);
  if (type && !/(?:http|request)/i.test(type)) {
    warnings.push(`Skipped ${fileName}: unsupported Postman request type "${type}".`);
    return undefined;
  }
  const method = asString(request.method);
  const url = request.url ?? request.endpoint;
  if (!method || url === undefined) {
    warnings.push(`Skipped ${fileName}: HTTP method or URL is missing.`);
    return undefined;
  }
  const embedded = asArray(document.examples ?? document.response).map(asRecord).map(postmanV3Example);
  return {
    name: asString(document.name) ?? asString(request.name) ?? fileName.replace(/\.request\.ya?ml$/i, ""),
    description: document.description ?? request.description,
    request: {
      method,
      url,
      header: postmanV3Headers(request.header ?? request.headers),
      auth: request.auth ?? document.auth,
      body: postmanV3Body(request.body)
    },
    response: [...embedded, ...resourceExamples]
  };
}

function postmanV3Body(input: unknown): unknown {
  if (typeof input === "string") {
    return { mode: "raw", raw: input };
  }
  const body = asRecord(input);
  if (Object.keys(body).length === 0 || body.mode) {
    return input;
  }
  const type = (asString(body.type) ?? asString(body.kind) ?? "").toLowerCase();
  const content = scalarText(body.content ?? body.value ?? body.text ?? body.raw);
  if (type.includes("urlencoded") || type === "form") {
    return { mode: "urlencoded", urlencoded: body.fields ?? body.urlencoded ?? body.params };
  }
  if (type.includes("formdata") || type.includes("multipart")) {
    return { mode: "formdata", formdata: body.fields ?? body.formdata ?? body.params };
  }
  if (type === "graphql") {
    return { mode: "graphql", graphql: body.graphql ?? body };
  }
  const language = type.includes("json") ? "json" : type.includes("xml") ? "xml" : undefined;
  return { mode: "raw", raw: content, options: language ? { raw: { language } } : undefined };
}

function postmanV3ResourceExamples(
  files: Map<string, AnyRecord>,
  warnings: string[]
): Map<string, AnyRecord[]> {
  const result = new Map<string, AnyRecord[]>();
  for (const [path, document] of files) {
    const match = /^(.*?)\.resources\/examples\/.*\.ya?ml$/i.exec(path);
    if (!match) {
      continue;
    }
    const requestPath = `${match[1]}.request.yaml`;
    const alternatePath = `${match[1]}.request.yml`;
    const actualPath = files.has(requestPath) ? requestPath : files.has(alternatePath) ? alternatePath : undefined;
    if (!actualPath) {
      warnings.push(`Skipped orphan Postman example ${path}.`);
      continue;
    }
    const examples = result.get(actualPath) ?? [];
    examples.push(postmanV3Example(document));
    result.set(actualPath, examples);
  }
  return result;
}

function postmanV3Example(input: AnyRecord): AnyRecord {
  const response = Object.keys(asRecord(input.response)).length > 0 ? asRecord(input.response) : input;
  const body = response.body;
  return {
    name: asString(input.name) ?? asString(response.name) ?? "Example response",
    status: asString(response.statusText) ?? asString(response.status),
    code: response.code ?? response.statusCode ?? 200,
    header: postmanV3Headers(response.header ?? response.headers),
    body: isRecord(body)
      ? scalarText(body.content ?? body.value ?? body.text ?? body.raw)
      : scalarText(body)
  };
}

function importPortableJson(document: AnyRecord): ImportDocumentResult | undefined {
  if (isPostmanCollection(document)) {
    return importPostmanCollection(document);
  }
  if (isInsomniaExport(document)) {
    return importInsomniaExport(document);
  }
  if (isHarDocument(document)) {
    return importHarDocument(document);
  }
  return undefined;
}

function isPostmanCollection(document: AnyRecord): boolean {
  const info = asRecord(document.info);
  const schema = asString(info.schema) ?? "";
  return (
    /schema\.getpostman\.com\/.*collection\/v2\.[01]\.0/i.test(schema) ||
    (typeof info._postman_id === "string" && Array.isArray(document.item))
  );
}

function isInsomniaExport(document: AnyRecord): boolean {
  return (
    Array.isArray(document.resources) &&
    (document._type === "export" || document.__export_format !== undefined)
  );
}

function isHarDocument(document: AnyRecord): boolean {
  const log = asRecord(document.log);
  return typeof log.version === "string" && Array.isArray(log.entries);
}

function isSpecfoldCollectionDocument(document: AnyRecord): boolean {
  return typeof document.schema === "string" && SPEC_FOLD_SCHEMAS.has(document.schema);
}

function hasApiVersionMarker(document: AnyRecord): boolean {
  return Object.prototype.hasOwnProperty.call(document, "openapi") ||
    Object.prototype.hasOwnProperty.call(document, "swagger");
}

function unsupportedJsonFormatError(document: AnyRecord): Error {
  const info = asRecord(document.info);
  const schema = asString(info.schema) ?? asString(document.schema);
  if (schema?.includes("postman") || Array.isArray(document.requests)) {
    return new Error(
      "Unsupported Postman collection version. Export the collection as Postman Collection v2.0 or v2.1 JSON."
    );
  }
  return new Error(
    "Unsupported JSON import format. Supported formats: OpenAPI 3.x, Swagger 2.0, Postman Collection v2.0/v2.1, Insomnia JSON v4/v5, HAR 1.2, and Specfold Collection JSON."
  );
}

function tryParseJsonRecord(text: string): AnyRecord | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function importPostmanCollection(document: AnyRecord): ImportDocumentResult {
  const info = asRecord(document.info);
  const name = asString(info.name) ?? "Imported Postman Collection";
  const collection = createCollection(name);
  collection.description = descriptionText(info.description);
  collection.openApi = {
    sourceFormat: "postman",
    documentVersion: postmanVersion(info)
  };

  const warnings: string[] = [];
  const variables = postmanVariables(document.variable);
  const baseUrl = variables.find((variable) => /^(baseurl|base_url)$/i.test(variable.name));
  if (baseUrl?.value) {
    collection.baseUrl = baseUrl.value;
  }
  const environments = variables.length > 0
    ? [environmentFromVariables(`${name} variables`, variables)]
    : [];

  addPostmanItems(
    asArray(document.item),
    collection,
    authFromPostman(document.auth, { type: "none" }, warnings, name),
    warnings
  );

  return {
    kind: "postman",
    collections: [collection],
    environments,
    preview: previewCollections(
      "postman",
      "Postman Collection",
      [collection],
      environments,
      postmanVersion(info)
    ),
    warnings
  };
}

function postmanVersion(info: AnyRecord): string {
  const schema = asString(info.schema) ?? "";
  const match = /collection\/v(2\.[01]\.0)/i.exec(schema);
  return match?.[1] ?? "2.x";
}

function postmanVariables(input: unknown): EnvironmentVariable[] {
  return asArray(input).flatMap((itemInput) => {
    const item = asRecord(itemInput);
    const name = asString(item.key) ?? asString(item.name);
    if (!name) {
      return [];
    }
    return [{
      id: createId("envvar"),
      name,
      value: scalarText(item.value),
      enabled: item.disabled !== true,
      secret: item.type === "secret" || looksSecret(name)
    }];
  });
}

type CollectionContainer = Pick<Collection | Folder, "folders" | "requests">;

function addPostmanItems(
  items: unknown[],
  container: CollectionContainer,
  inheritedAuth: AuthConfig,
  warnings: string[]
): void {
  for (const itemInput of items) {
    const item = asRecord(itemInput);
    if (Array.isArray(item.item)) {
      const folder = createFolder(asString(item.name) ?? "Imported folder");
      folder.description = descriptionText(item.description);
      container.folders.push(folder);
      addPostmanItems(
        item.item,
        folder,
        authFromPostman(item.auth, inheritedAuth, warnings, folder.name),
        warnings
      );
      continue;
    }

    const request = requestFromPostman(item, inheritedAuth, warnings);
    if (request) {
      container.requests.push(request);
    }
  }
}

function requestFromPostman(
  item: AnyRecord,
  inheritedAuth: AuthConfig,
  warnings: string[]
): ApiRequest | undefined {
  const requestInput = item.request;
  const request = typeof requestInput === "string"
    ? { url: requestInput }
    : asRecord(requestInput);
  if (Object.keys(request).length === 0) {
    warnings.push(`Skipped Postman item without a request: ${asString(item.name) ?? "Unnamed item"}.`);
    return undefined;
  }

  const method = supportedMethod(request.method, warnings, asString(item.name));
  if (!method) {
    return undefined;
  }
  const headers = postmanHeaders(request.header);
  const url = postmanUrl(request.url);
  const result = createRequest({
    name: asString(item.name) ?? `${method} ${url.url}`,
    method,
    url: url.url
  });
  result.description = descriptionText(request.description) ?? descriptionText(item.description);
  result.queryParams = url.queryParams;
  result.pathParams = url.pathParams;
  result.headers = headers;
  result.auth = authFromPostman(request.auth, inheritedAuth, warnings, result.name);
  result.body = postmanBody(request.body, headers, warnings, result.name);
  result.responseExamples = asArray(item.response).map(responseFromPostman);
  result.openApi = { sourceFormat: "postman", method, path: url.url };
  return result;
}

function postmanUrl(input: unknown): { url: string; queryParams: KeyValue[]; pathParams: KeyValue[] } {
  if (typeof input === "string") {
    return splitUrl(input);
  }
  const url = asRecord(input);
  const raw = asString(url.raw) ?? buildPostmanUrl(url);
  const split = splitUrl(raw);
  const explicitQuery = keyValues(url.query, "key", "value");
  return {
    url: split.url,
    queryParams: explicitQuery.length > 0 ? explicitQuery : split.queryParams,
    pathParams: keyValues(url.variable, "key", "value")
  };
}

function buildPostmanUrl(url: AnyRecord): string {
  const protocol = asString(url.protocol);
  const host = asArray(url.host).map(scalarText).filter(Boolean).join(".");
  const path = asArray(url.path).map(scalarText).filter(Boolean).join("/");
  const prefix = protocol && host ? `${protocol}://${host}` : host;
  return `${prefix}${path ? `/${path}` : ""}`;
}

function postmanBody(
  input: unknown,
  headers: KeyValue[],
  warnings: string[],
  requestName: string
): RequestBody {
  const body = asRecord(input);
  const mode = asString(body.mode);
  if (!mode || mode === "disabled") {
    return { mode: "none" };
  }
  if (mode === "raw") {
    const raw = asString(body.raw) ?? "";
    const language = asString(asRecord(asRecord(body.options).raw).language);
    const contentType = contentTypeFromHeaders(headers) ?? contentTypeForLanguage(language);
    return rawBody(raw, contentType);
  }
  if (mode === "urlencoded") {
    return {
      mode: "form",
      contentType: "application/x-www-form-urlencoded",
      form: keyValues(body.urlencoded, "key", "value")
    };
  }
  if (mode === "formdata") {
    const fields = portableFormFields(body.formdata, "key", "value");
    const hasFiles = asArray(body.formdata).some((entry) => asRecord(entry).type === "file");
    warnings.push(
      `${requestName}: multipart form-data was imported as editable form fields${hasFiles ? "; file entries require manual review" : ""}.`
    );
    return {
      mode: "form",
      contentType: "application/x-www-form-urlencoded",
      form: fields
    };
  }
  if (mode === "graphql") {
    const graphql = asRecord(body.graphql);
    const raw = JSON.stringify({
      query: asString(graphql.query) ?? "",
      variables: parseJsonValue(graphql.variables)
    }, null, 2);
    return rawBody(raw, "application/json");
  }
  warnings.push(`${requestName}: unsupported Postman body mode "${mode}" was skipped.`);
  return { mode: "none" };
}

function responseFromPostman(input: unknown): ResponseExample {
  const response = asRecord(input);
  const headers = postmanHeaders(response.header);
  return {
    id: createId("res"),
    name: asString(response.name) ?? asString(response.status) ?? "Response",
    status: numberValue(response.code, 200),
    headers,
    contentType: contentTypeFromHeaders(headers),
    body: asString(response.body)
  };
}

function authFromPostman(
  input: unknown,
  fallback: AuthConfig = { type: "none" },
  warnings?: string[],
  scopeName = "Postman request"
): AuthConfig {
  if (!isRecord(input)) {
    return fallback;
  }
  const type = asString(input.type)?.toLowerCase();
  if (!type) {
    return fallback;
  }
  if (type === "noauth") {
    return { type: "none" };
  }
  const values = asArray(input[type]).map(asRecord);
  const value = (key: string) => scalarText(values.find((entry) => entry.key === key)?.value);
  if (type === "bearer") {
    return { type: "bearer", token: value("token") };
  }
  if (type === "basic") {
    return { type: "basic", username: value("username"), password: value("password") };
  }
  if (type === "apikey") {
    return {
      type: "apiKey",
      key: value("key"),
      value: value("value"),
      in: value("in").toLowerCase() === "query" ? "query" : "header"
    };
  }
  warnings?.push(`${scopeName}: Postman auth type "${type}" requires manual configuration.`);
  return { type: "none" };
}

function postmanHeaders(input: unknown): KeyValue[] {
  if (typeof input !== "string") {
    return keyValues(input, "key", "value");
  }
  return input
    .split(/\r?\n/)
    .flatMap((line) => {
      const separator = line.indexOf(":");
      if (separator <= 0) {
        return [];
      }
      return [createKeyValue(line.slice(0, separator).trim(), line.slice(separator + 1).trim())];
    });
}

function importInsomniaExport(document: AnyRecord): ImportDocumentResult {
  const resources = asArray(document.resources).map(asRecord);
  const warnings: string[] = [];
  const byId = new Map<string, AnyRecord>();
  for (const resource of resources) {
    const id = asString(resource._id);
    if (id) {
      byId.set(id, resource);
    }
  }

  const workspaceResources = resources.filter((resource) => resource._type === "workspace");
  const collections = (workspaceResources.length > 0 ? workspaceResources : [{}]).map((workspace, index) => {
    const collection = createCollection(asString(workspace.name) ?? `Imported Insomnia Workspace ${index + 1}`);
    collection.description = asString(workspace.description);
    collection.openApi = {
      sourceFormat: "insomnia",
      documentVersion: scalarText(document.__export_format) || undefined
    };
    return collection;
  });
  const collectionByWorkspace = new Map<string, Collection>();
  workspaceResources.forEach((workspace, index) => {
    const id = asString(workspace._id);
    if (id) {
      collectionByWorkspace.set(id, collections[index]);
    }
  });
  const fallbackCollection = collections[0];

  const folderResources = resources.filter((resource) =>
    resource._type === "request_group" || resource._type === "folder"
  );
  const folderById = new Map<string, Folder>();
  for (const resource of folderResources) {
    const id = asString(resource._id);
    if (!id) {
      continue;
    }
    const folder = createFolder(asString(resource.name) ?? "Imported folder");
    folder.description = asString(resource.description);
    folder.openApi = { sourceFormat: "insomnia" };
    folderById.set(id, folder);
  }
  for (const resource of folderResources) {
    const id = asString(resource._id);
    const folder = id ? folderById.get(id) : undefined;
    if (!id || !folder) {
      continue;
    }
    const parentId = asString(resource.parentId);
    const parentFolder = safeInsomniaParentFolder(id, parentId, folderById, byId);
    if (parentFolder) {
      parentFolder.folders.push(folder);
    } else {
      collectionForInsomniaResource(resource, byId, collectionByWorkspace, fallbackCollection).folders.push(folder);
    }
  }

  const responsesByRequest = new Map<string, ResponseExample[]>();
  for (const resource of resources.filter((item) => item._type === "response")) {
    const parentId = asString(resource.parentId);
    if (!parentId) {
      continue;
    }
    const headers = keyValues(resource.headers, "name", "value");
    const examples = responsesByRequest.get(parentId) ?? [];
    examples.push({
      id: createId("res"),
      name: asString(resource.name) ?? asString(resource.statusMessage) ?? "Response",
      status: numberValue(resource.statusCode, 200),
      headers,
      contentType: contentTypeFromHeaders(headers) ?? asString(resource.contentType),
      body: asString(resource.body)
    });
    responsesByRequest.set(parentId, examples);
  }

  for (const resource of resources.filter((item) => item._type === "request")) {
    const method = supportedMethod(resource.method, warnings, asString(resource.name));
    if (!method) {
      continue;
    }
    const split = splitUrl(normalizeInsomniaVariables(asString(resource.url) ?? ""));
    const headers = keyValues(resource.headers, "name", "value", normalizeInsomniaVariables);
    const request = createRequest({
      name: asString(resource.name) ?? `${method} ${split.url}`,
      method,
      url: split.url
    });
    request.description = asString(resource.description);
    const explicitParameters = keyValues(resource.parameters, "name", "value", normalizeInsomniaVariables);
    request.queryParams = explicitParameters.length > 0 ? explicitParameters : split.queryParams;
    request.headers = headers;
    request.auth = authFromInsomnia(resource.authentication, warnings, request.name);
    request.body = insomniaBody(resource.body, headers, warnings, request.name);
    request.responseExamples = responsesByRequest.get(asString(resource._id) ?? "") ?? [];
    request.openApi = { sourceFormat: "insomnia", method, path: split.url };

    const parentId = asString(resource.parentId);
    const parentFolder = parentId ? folderById.get(parentId) : undefined;
    if (parentFolder) {
      parentFolder.requests.push(request);
    } else {
      collectionForInsomniaResource(resource, byId, collectionByWorkspace, fallbackCollection).requests.push(request);
    }
  }

  const environments = resources
    .filter((resource) => resource._type === "environment")
    .flatMap((resource) => {
      const variables = insomniaEnvironmentVariables(asRecord(resource.data));
      return variables.length > 0
        ? [environmentFromVariables(asString(resource.name) ?? "Insomnia environment", variables)]
        : [];
    });

  return {
    kind: "insomnia",
    collections,
    environments,
    preview: previewCollections(
      "insomnia",
      "Insomnia JSON",
      collections,
      environments,
      scalarText(document.__export_format) ? `v${scalarText(document.__export_format)}` : "v4/v5"
    ),
    warnings
  };
}

function safeInsomniaParentFolder(
  folderId: string,
  parentId: string | undefined,
  folders: Map<string, Folder>,
  resources: Map<string, AnyRecord>
): Folder | undefined {
  if (!parentId || parentId === folderId) {
    return undefined;
  }
  let current: string | undefined = parentId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    if (current === folderId) {
      return undefined;
    }
    visited.add(current);
    current = asString(resources.get(current)?.parentId);
  }
  return folders.get(parentId);
}

function insomniaEnvironmentVariables(data: AnyRecord): EnvironmentVariable[] {
  const variables: EnvironmentVariable[] = [];
  const visit = (record: AnyRecord, prefix = "") => {
    for (const [key, value] of Object.entries(record)) {
      const name = prefix ? `${prefix}.${key}` : key;
      if (isRecord(value)) {
        visit(value, name);
        continue;
      }
      variables.push({
        id: createId("envvar"),
        name,
        value: scalarText(value),
        enabled: true,
        secret: looksSecret(name)
      });
    }
  };
  visit(data);
  return variables;
}

function collectionForInsomniaResource(
  resource: AnyRecord,
  byId: Map<string, AnyRecord>,
  collections: Map<string, Collection>,
  fallback: Collection
): Collection {
  let parentId = asString(resource.parentId);
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const direct = collections.get(parentId);
    if (direct) {
      return direct;
    }
    parentId = asString(byId.get(parentId)?.parentId);
  }
  return fallback;
}

function normalizeInsomniaVariables(value: string): string {
  return value
    .replace(/\{\{\s*_\.\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g, "{{$1}}")
    .replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g, "{{$1}}");
}

function authFromInsomnia(input: unknown, warnings: string[], requestName: string): AuthConfig {
  const auth = asRecord(input);
  const type = asString(auth.type)?.toLowerCase();
  if (!type || auth.disabled === true || type === "none") {
    return { type: "none" };
  }
  if (type === "bearer") {
    return { type: "bearer", token: normalizeInsomniaVariables(asString(auth.token) ?? "") };
  }
  if (type === "basic") {
    return {
      type: "basic",
      username: normalizeInsomniaVariables(asString(auth.username) ?? ""),
      password: normalizeInsomniaVariables(asString(auth.password) ?? "")
    };
  }
  if (type === "apikey" || type === "api_key") {
    return {
      type: "apiKey",
      key: normalizeInsomniaVariables(asString(auth.key) ?? ""),
      value: normalizeInsomniaVariables(asString(auth.value) ?? ""),
      in: asString(auth.addTo)?.toLowerCase() === "query" ? "query" : "header"
    };
  }
  warnings.push(`${requestName}: Insomnia auth type "${type}" requires manual configuration.`);
  return { type: "none" };
}

function insomniaBody(
  input: unknown,
  headers: KeyValue[],
  warnings: string[],
  requestName: string
): RequestBody {
  const body = asRecord(input);
  const mimeType = asString(body.mimeType) ?? contentTypeFromHeaders(headers);
  const text = asString(body.text);
  const params = portableFormFields(body.params, "name", "value", normalizeInsomniaVariables);
  if (params.length > 0) {
    if (mimeType?.includes("multipart/form-data")) {
      warnings.push(`${requestName}: multipart form-data was imported as editable form fields; file entries require manual review.`);
    }
    return {
      mode: "form",
      contentType: "application/x-www-form-urlencoded",
      form: params
    };
  }
  if (text !== undefined) {
    return rawBody(normalizeInsomniaVariables(text), mimeType);
  }
  return { mode: "none" };
}

function importHarDocument(document: AnyRecord): ImportDocumentResult {
  const log = asRecord(document.log);
  const pages = asArray(log.pages).map(asRecord);
  const collection = createCollection(
    asString(pages[0]?.title) ?? "Imported HAR Session"
  );
  collection.openApi = {
    sourceFormat: "har",
    documentVersion: asString(log.version)
  };
  const warnings: string[] = [];

  for (const [index, entryInput] of asArray(log.entries).entries()) {
    const entry = asRecord(entryInput);
    const requestInput = asRecord(entry.request);
    const method = supportedMethod(requestInput.method, warnings, `HAR entry ${index + 1}`);
    const originalUrl = asString(requestInput.url);
    if (!method || !originalUrl) {
      if (!originalUrl) {
        warnings.push(`Skipped HAR entry ${index + 1} without a request URL.`);
      }
      continue;
    }
    const split = splitUrl(originalUrl);
    const headers = keyValues(requestInput.headers, "name", "value");
    const cookies = keyValues(requestInput.cookies, "name", "value");
    if (cookies.length > 0 && !headers.some((header) => header.key.toLowerCase() === "cookie")) {
      headers.push(createKeyValue("Cookie", cookies.map((cookie) => `${cookie.key}=${cookie.value}`).join("; ")));
    }
    const request = createRequest({
      name: `${method} ${harRequestName(originalUrl)}`,
      method,
      url: split.url
    });
    const explicitQuery = keyValues(requestInput.queryString, "name", "value");
    request.queryParams = explicitQuery.length > 0 ? explicitQuery : split.queryParams;
    request.headers = headers;
    request.auth = authFromHeaders(headers);
    request.body = harBody(requestInput.postData, headers);
    request.responseExamples = [responseFromHar(entry.response, warnings, request.name)];
    request.openApi = { sourceFormat: "har", method, path: split.url };
    collection.requests.push(request);
  }

  return {
    kind: "har",
    collections: [collection],
    environments: [],
    preview: previewCollections("har", "HAR", [collection], [], asString(log.version) ?? "1.2"),
    warnings
  };
}

function harBody(input: unknown, headers: KeyValue[]): RequestBody {
  const postData = asRecord(input);
  if (Object.keys(postData).length === 0) {
    return { mode: "none" };
  }
  const mimeType = asString(postData.mimeType) ?? contentTypeFromHeaders(headers);
  const params = keyValues(postData.params, "name", "value");
  if (params.length > 0 && mimeType?.includes("application/x-www-form-urlencoded")) {
    return { mode: "form", contentType: mimeType, form: params };
  }
  return rawBody(asString(postData.text) ?? "", mimeType);
}

function responseFromHar(input: unknown, warnings: string[], requestName: string): ResponseExample {
  const response = asRecord(input);
  const content = asRecord(response.content);
  const headers = keyValues(response.headers, "name", "value");
  let body = asString(content.text);
  if (body && content.encoding === "base64") {
    try {
      body = decodeBase64(body);
    } catch {
      warnings.push(`${requestName}: base64 HAR response body could not be decoded.`);
    }
  }
  return {
    id: createId("res"),
    name: asString(response.statusText) ?? "Response",
    status: numberValue(response.status, 200),
    headers,
    contentType: asString(content.mimeType) ?? contentTypeFromHeaders(headers),
    body
  };
}

function decodeBase64(value: string): string {
  const maybeBuffer = (globalThis as unknown as {
    Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } };
  }).Buffer;
  if (maybeBuffer) {
    return maybeBuffer.from(value, "base64").toString("utf8");
  }
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function harRequestName(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function authFromHeaders(headers: KeyValue[]): AuthConfig {
  const header = headers.find((item) => item.key.toLowerCase() === "authorization");
  const bearer = header ? /^Bearer\s+(.+)$/i.exec(header.value) : undefined;
  if (bearer) {
    return { type: "bearer", token: bearer[1] };
  }
  const basic = header ? /^Basic\s+(.+)$/i.exec(header.value) : undefined;
  if (basic && !basic[1].includes("{{")) {
    try {
      const decoded = decodeBase64(basic[1]);
      const separator = decoded.indexOf(":");
      if (separator >= 0) {
        return {
          type: "basic",
          username: decoded.slice(0, separator),
          password: decoded.slice(separator + 1)
        };
      }
    } catch {
      // Keep a malformed Basic header as an ordinary header.
    }
  }
  return { type: "none" };
}

function splitUrl(input: string): { url: string; queryParams: KeyValue[]; pathParams: KeyValue[] } {
  const hashIndex = input.indexOf("#");
  const withoutHash = hashIndex >= 0 ? input.slice(0, hashIndex) : input;
  const questionIndex = withoutHash.indexOf("?");
  if (questionIndex < 0) {
    return { url: withoutHash, queryParams: [], pathParams: [] };
  }
  const query = withoutHash.slice(questionIndex + 1);
  const queryParams = query
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const separator = pair.indexOf("=");
      const key = separator >= 0 ? pair.slice(0, separator) : pair;
      const value = separator >= 0 ? pair.slice(separator + 1) : "";
      return createKeyValue(safeDecode(key), safeDecode(value));
    });
  return { url: withoutHash.slice(0, questionIndex), queryParams, pathParams: [] };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function keyValues(
  input: unknown,
  keyName: string,
  valueName: string,
  normalize: (value: string) => string = (value) => value
): KeyValue[] {
  return asArray(input).flatMap((itemInput) => {
    const item = asRecord(itemInput);
    const key = asString(item[keyName]) ?? asString(item.key) ?? asString(item.name);
    if (!key) {
      return [];
    }
    const result = createKeyValue(
      normalize(key),
      normalize(scalarText(item[valueName])),
      descriptionText(item.description)
    );
    result.enabled = item.disabled !== true;
    return [result];
  });
}

function portableFormFields(
  input: unknown,
  keyName: string,
  valueName: string,
  normalize: (value: string) => string = (value) => value
): KeyValue[] {
  return asArray(input).flatMap((itemInput) => {
    const item = asRecord(itemInput);
    const key = asString(item[keyName]) ?? asString(item.key) ?? asString(item.name);
    if (!key) {
      return [];
    }
    const isFile = item.type === "file";
    const fileValue = Array.isArray(item.src)
      ? item.src.map((value) => fileNameOnly(scalarText(value))).join(", ")
      : fileNameOnly(scalarText(item.src ?? item.fileName));
    const field = createKeyValue(
      normalize(key),
      normalize(isFile ? fileValue : scalarText(item[valueName])),
      isFile
        ? "File field imported without file contents; select the file manually before sending."
        : descriptionText(item.description)
    );
    field.enabled = !isFile && item.disabled !== true;
    return [field];
  });
}

function fileNameOnly(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

function supportedMethod(input: unknown, warnings: string[], name?: string): HttpMethod | undefined {
  const method = (asString(input) ?? "GET").toUpperCase() as HttpMethod;
  if (SUPPORTED_METHODS.has(method)) {
    return method;
  }
  warnings.push(`Skipped ${name ?? "request"}: unsupported HTTP method "${method}".`);
  return undefined;
}

function rawBody(raw: string, contentType?: string): RequestBody {
  const isJson = contentType?.toLowerCase().includes("json") ?? false;
  return {
    mode: isJson ? "json" : "raw",
    contentType,
    raw,
    json: isJson ? parseJsonValue(raw) : undefined
  };
}

function parseJsonValue(input: unknown): unknown {
  if (typeof input !== "string") {
    return input;
  }
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function contentTypeForLanguage(language?: string): string | undefined {
  if (!language) {
    return undefined;
  }
  if (language.toLowerCase() === "json") {
    return "application/json";
  }
  if (language.toLowerCase() === "xml") {
    return "application/xml";
  }
  return "text/plain";
}

function contentTypeFromHeaders(headers: KeyValue[]): string | undefined {
  return headers.find((header) => header.key.toLowerCase() === "content-type")?.value;
}

function descriptionText(input: unknown): string | undefined {
  if (typeof input === "string") {
    return input;
  }
  return asString(asRecord(input).content);
}

function scalarText(input: unknown): string {
  if (input === undefined || input === null) {
    return "";
  }
  if (typeof input === "string") {
    return input;
  }
  if (typeof input === "number" || typeof input === "boolean") {
    return String(input);
  }
  try {
    return JSON.stringify(input);
  } catch {
    return "";
  }
}

function numberValue(input: unknown, fallback: number): number {
  const value = typeof input === "number" ? input : Number(input);
  return Number.isFinite(value) ? value : fallback;
}

function looksSecret(name: string): boolean {
  return /(token|secret|password|passwd|api[-_.]?key|authorization)/i.test(name);
}

function environmentFromVariables(name: string, variables: EnvironmentVariable[]): Environment {
  const environment = createEnvironment(name);
  environment.variables = variables;
  return environment;
}

function previewCollections(
  kind: ImportDocumentKind,
  label: string,
  collections: Collection[],
  _environments: Environment[],
  version?: string,
  format: SourceTextFormat = "json"
): ImportDocumentPreview {
  const counts = collections.reduce(
    (total, collection) => {
      const current = countCollection(collection);
      total.requests += current.requests;
      total.folders += current.folders;
      return total;
    },
    { requests: 0, folders: 0 }
  );
  return {
    kind,
    label,
    format,
    title: collections[0]?.name ?? "Imported collection",
    version,
    collectionCount: collections.length,
    requestCount: counts.requests,
    containerCount: counts.folders,
    containerLabel: "folders"
  };
}

function countCollection(collection: Collection): { requests: number; folders: number } {
  let requests = collection.requests.length;
  let folders = 0;
  const visit = (items: Folder[]) => {
    for (const folder of items) {
      folders += 1;
      requests += folder.requests.length;
      visit(folder.folders);
    }
  };
  visit(collection.folders);
  return { requests, folders };
}
