import { createCollection, createFolder, createId, createRequest } from "../../model/factory";
import type { AuthConfig, Collection, EnvironmentVariable, Folder, KeyValue, RequestBody, ResponseExample } from "../../model/types";
import { asArray, asRecord, asString, isRecord, type AnyRecord } from "../shared";
import { contentTypeFromHeaders, environmentFromVariables, keyValues, looksSecret, numberValue, portableFormFields, portableMultipartFields, previewCollections, rawBody, scalarText, splitUrl, supportedMethod } from "./shared";
import type { ImportDocumentResult } from "./types";

export function isInsomniaExport(document: AnyRecord): boolean {
  return Array.isArray(document.resources) &&
    (document._type === "export" || document.__export_format !== undefined);
}

export function importInsomniaExport(document: AnyRecord): ImportDocumentResult {
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

export function safeInsomniaParentFolder(
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

export function insomniaEnvironmentVariables(data: AnyRecord): EnvironmentVariable[] {
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

export function collectionForInsomniaResource(
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

export function normalizeInsomniaVariables(value: string): string {
  return value
    .replace(/\{\{\s*_\.\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g, "{{$1}}")
    .replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g, "{{$1}}");
}

export function authFromInsomnia(input: unknown, warnings: string[], requestName: string): AuthConfig {
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

export function insomniaBody(
  input: unknown,
  headers: KeyValue[],
  warnings: string[],
  requestName: string
): RequestBody {
  const body = asRecord(input);
  const mimeType = asString(body.mimeType) ?? contentTypeFromHeaders(headers);
  const text = asString(body.text);
  if (mimeType?.toLowerCase().includes("multipart/form-data")) {
    const fields = portableMultipartFields(
      body.params,
      "name",
      "value",
      normalizeInsomniaVariables
    );
    if (fields.some((field) => field.type === "file")) {
      warnings.push(
        `${requestName}: multipart file fields were imported without local paths or contents; select each file manually before sending.`
      );
    }
    return {
      mode: "multipart",
      contentType: "multipart/form-data",
      multipart: fields
    };
  }
  const params = portableFormFields(body.params, "name", "value", normalizeInsomniaVariables);
  if (params.length > 0) {
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

