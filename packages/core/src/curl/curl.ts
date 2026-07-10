import { createId, createKeyValue } from "../model/factory";
import type { ApiRequest, HttpMethod, KeyValue } from "../model/types";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

/**
 * Render a request as a copy-pasteable multi-line `curl` command. Enabled
 * headers, query params, bearer/basic/apiKey auth, and a raw body are
 * included. {{variables}} are emitted verbatim so the command mirrors the UI.
 */
export function requestToCurl(request: ApiRequest): string {
  const lines: string[] = [];
  const method = request.method.toUpperCase();
  lines.push(`curl -X ${method} ${shellQuote(buildUrl(request))}`);

  const headers = new Map<string, string>();
  for (const header of request.headers) {
    if (header.enabled && header.key.trim()) {
      headers.set(header.key, header.value);
    }
  }

  if (request.auth.type === "bearer" && request.auth.token) {
    headers.set("Authorization", `Bearer ${request.auth.token}`);
  } else if (request.auth.type === "basic") {
    lines.push(`  --user ${shellQuote(`${request.auth.username}:${request.auth.password}`)}`);
  } else if (request.auth.type === "apiKey" && request.auth.in === "header" && request.auth.key) {
    headers.set(request.auth.key, request.auth.value);
  }

  for (const [key, value] of headers) {
    lines.push(`  -H ${shellQuote(`${key}: ${value}`)}`);
  }

  if (request.body.mode !== "none" && request.body.raw && method !== "GET") {
    lines.push(`  --data ${shellQuote(request.body.raw)}`);
  }

  return lines.join(" \\\n");
}

function buildUrl(request: ApiRequest): string {
  const enabledQuery = request.queryParams.filter((param) => param.enabled && param.key.trim());
  if (request.auth.type === "apiKey" && request.auth.in === "query" && request.auth.key) {
    enabledQuery.push(createKeyValue(request.auth.key, request.auth.value));
  }
  if (enabledQuery.length === 0) {
    return request.url;
  }
  const query = enabledQuery
    .map((param) => `${encodeURIComponent(param.key)}=${encodeURIComponent(param.value)}`)
    .join("&");
  const separator = request.url.includes("?") ? "&" : "?";
  return `${request.url}${separator}${query}`;
}

function shellQuote(value: string): string {
  // Single-quote and escape embedded single quotes for POSIX shells.
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function looksLikeCurl(text: string): boolean {
  return /^\s*curl\b/.test(text);
}

/**
 * Parse a `curl` command (as pasted from browser devtools or docs) into an
 * ApiRequest. Understands -X/--request, -H/--header, -d/--data*, --url,
 * -u/--user, and a bare URL argument. Line continuations and both quote
 * styles are handled.
 */
export function parseCurlCommand(input: string): ApiRequest {
  const tokens = tokenizeCurl(input.replace(/\\\r?\n/g, " "));
  if (tokens.length === 0 || tokens[0].toLowerCase() !== "curl") {
    throw new Error("Not a curl command.");
  }

  let url: string | undefined;
  let method: string | undefined;
  const headers: KeyValue[] = [];
  const dataParts: string[] = [];
  let user: string | undefined;
  let bodyIsForm = false;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = () => tokens[++index];

    if (token === "-X" || token === "--request") {
      method = next();
    } else if (token === "-H" || token === "--header") {
      const raw = next();
      if (raw) {
        const separator = raw.indexOf(":");
        if (separator > 0) {
          headers.push(createKeyValue(raw.slice(0, separator).trim(), raw.slice(separator + 1).trim()));
        }
      }
    } else if (token === "-d" || token === "--data" || token === "--data-raw" || token === "--data-binary" || token === "--data-ascii") {
      dataParts.push(next() ?? "");
    } else if (token === "--data-urlencode") {
      dataParts.push(next() ?? "");
      bodyIsForm = true;
    } else if (token === "-u" || token === "--user") {
      user = next();
    } else if (token === "--url") {
      url = next();
    } else if (token === "-F" || token === "--form") {
      dataParts.push(next() ?? "");
      bodyIsForm = true;
    } else if (token === "-G" || token === "--get") {
      method = method ?? "GET";
    } else if (token.startsWith("-")) {
      // Skip unknown flags; consume a value for the common valued ones.
      if (["-e", "--referer", "-A", "--user-agent", "-b", "--cookie", "-o", "--output", "-m", "--max-time", "--connect-timeout", "--retry"].includes(token)) {
        next();
      }
    } else if (!url) {
      url = token;
    }
  }

  if (!url) {
    throw new Error("No URL found in curl command.");
  }

  const auth = buildAuth(headers, user);
  // Store the URL without its query string and keep params separate, matching
  // how the rest of the app models requests (avoids duplicating params on a
  // curl round trip).
  const { path, queryParams } = splitUrl(url);
  const body = dataParts.length > 0
    ? {
        mode: "raw" as const,
        contentType: contentTypeFromHeaders(headers) ?? (bodyIsForm ? "application/x-www-form-urlencoded" : "application/json"),
        raw: dataParts.join("&")
      }
    : { mode: "none" as const };
  const resolvedMethod = (method ?? (dataParts.length > 0 ? "POST" : "GET")).toUpperCase();

  return {
    id: createId("req"),
    name: `${resolvedMethod} ${path}`,
    method: (HTTP_METHODS.includes(resolvedMethod) ? resolvedMethod : "GET") as HttpMethod,
    url: path,
    queryParams,
    pathParams: [],
    headers,
    body,
    auth,
    responseExamples: []
  };
}

function buildAuth(headers: KeyValue[], user?: string): ApiRequest["auth"] {
  if (user) {
    const separator = user.indexOf(":");
    return separator >= 0
      ? { type: "basic", username: user.slice(0, separator), password: user.slice(separator + 1) }
      : { type: "basic", username: user, password: "" };
  }
  const authHeaderIndex = headers.findIndex((header) => header.key.toLowerCase() === "authorization");
  if (authHeaderIndex >= 0) {
    const value = headers[authHeaderIndex].value;
    const bearer = /^Bearer\s+(.+)$/i.exec(value);
    if (bearer) {
      headers.splice(authHeaderIndex, 1);
      return { type: "bearer", token: bearer[1] };
    }
  }
  return { type: "none" };
}

function contentTypeFromHeaders(headers: KeyValue[]): string | undefined {
  const header = headers.find((item) => item.key.toLowerCase() === "content-type");
  return header?.value;
}

function splitUrl(url: string): { path: string; queryParams: KeyValue[] } {
  const questionIndex = url.indexOf("?");
  if (questionIndex < 0) {
    return { path: url, queryParams: [] };
  }
  const query = url.slice(questionIndex + 1);
  const queryParams = query
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const equalsIndex = pair.indexOf("=");
      const key = equalsIndex >= 0 ? pair.slice(0, equalsIndex) : pair;
      const value = equalsIndex >= 0 ? pair.slice(equalsIndex + 1) : "";
      return createKeyValue(safeDecode(key), safeDecode(value));
    });
  return { path: url.slice(0, questionIndex), queryParams };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

/** Split a command line into tokens, honoring single and double quotes. */
function tokenizeCurl(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let hasToken = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else if (char === "\\" && quote === '"' && index + 1 < input.length) {
        current += input[++index];
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    if (char === "\\" && index + 1 < input.length) {
      current += input[++index];
      hasToken = true;
      continue;
    }
    current += char;
    hasToken = true;
  }
  if (hasToken) {
    tokens.push(current);
  }
  return tokens;
}
