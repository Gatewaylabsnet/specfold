import { createCollection, createId, createKeyValue, createRequest } from "../../model/factory";
import type { KeyValue, RequestBody, ResponseExample } from "../../model/types";
import { asArray, asRecord, asString, type AnyRecord } from "../shared";
import { authFromHeaders, contentTypeFromHeaders, decodeBase64, harRequestName, keyValues, numberValue, previewCollections, rawBody, splitUrl, supportedMethod } from "./shared";
import type { ImportDocumentResult } from "./types";

export function isHarDocument(document: AnyRecord): boolean {
  const log = asRecord(document.log);
  return typeof log.version === "string" && Array.isArray(log.entries);
}

export function importHarDocument(document: AnyRecord): ImportDocumentResult {
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

export function harBody(input: unknown, headers: KeyValue[]): RequestBody {
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

export function responseFromHar(input: unknown, warnings: string[], requestName: string): ResponseExample {
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
