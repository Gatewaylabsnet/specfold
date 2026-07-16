import { parse as parseYaml } from "yaml";
import { asArray, asRecord, asString, isRecord, type AnyRecord } from "../shared";
import type { ImportOptions } from "../types";
import { descriptionText, scalarText } from "./shared";
import { importPostmanCollection } from "./postman";
import type { ImportDocumentPreview, ImportDocumentResult, PostmanV3FolderSource } from "./types";

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

