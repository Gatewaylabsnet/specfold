import { createCollection, createFolder, createId, createKeyValue, createRequest } from "../../model/factory";
import type { ApiRequest, AuthConfig, Collection, EnvironmentVariable, Folder, KeyValue, RequestBody, ResponseExample } from "../../model/types";
import { asArray, asRecord, asString, isRecord, type AnyRecord } from "../shared";
import { contentTypeForLanguage, contentTypeFromHeaders, descriptionText, environmentFromVariables, keyValues, looksSecret, numberValue, parseJsonValue, portableFormFields, previewCollections, rawBody, scalarText, splitUrl, supportedMethod } from "./shared";
import type { ImportDocumentResult } from "./types";

export function isPostmanCollection(document: AnyRecord): boolean {
  const info = asRecord(document.info);
  const schema = asString(info.schema) ?? "";
  return /schema\.getpostman\.com\/.*collection\/v2\.[01]\.0/i.test(schema) ||
    (typeof info._postman_id === "string" && Array.isArray(document.item));
}

export function importPostmanCollection(document: AnyRecord): ImportDocumentResult {
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

export function postmanVersion(info: AnyRecord): string {
  const schema = asString(info.schema) ?? "";
  const match = /collection\/v(2\.[01]\.0)/i.exec(schema);
  return match?.[1] ?? "2.x";
}

export function postmanVariables(input: unknown): EnvironmentVariable[] {
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

export function addPostmanItems(
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

export function requestFromPostman(
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

export function postmanUrl(input: unknown): { url: string; queryParams: KeyValue[]; pathParams: KeyValue[] } {
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

export function buildPostmanUrl(url: AnyRecord): string {
  const protocol = asString(url.protocol);
  const host = asArray(url.host).map(scalarText).filter(Boolean).join(".");
  const path = asArray(url.path).map(scalarText).filter(Boolean).join("/");
  const prefix = protocol && host ? `${protocol}://${host}` : host;
  return `${prefix}${path ? `/${path}` : ""}`;
}

export function postmanBody(
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

export function responseFromPostman(input: unknown): ResponseExample {
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

export function authFromPostman(
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

export function postmanHeaders(input: unknown): KeyValue[] {
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
