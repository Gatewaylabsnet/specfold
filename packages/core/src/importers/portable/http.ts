import { createCollection, createId, createKeyValue, createRequest } from "../../model/factory";
import type { ApiRequest, EnvironmentVariable, HttpMethod, KeyValue, RequestBody } from "../../model/types";
import { authFromHeaders, contentTypeFromHeaders, environmentFromVariables, looksSecret, previewCollections, rawBody, safeDecode, splitUrl } from "./shared";
import type { ImportDocumentResult } from "./types";

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
