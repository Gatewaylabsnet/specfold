import type {
  ApiRequest,
  AuthConfig,
  Collection,
  Environment,
  Folder,
  HttpMethod,
  KeyValue,
  RequestBody,
  Workspace
} from "./types";

const fallbackRandom = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function createId(prefix: string): string {
  const random =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : fallbackRandom();
  return `${prefix}_${random}`;
}

export function createKeyValue(
  key = "",
  value = "",
  description?: string
): KeyValue {
  return {
    id: createId("kv"),
    key,
    value,
    enabled: true,
    description
  };
}

export function createEmptyBody(): RequestBody {
  return { mode: "none" };
}

export function createAuthNone(): AuthConfig {
  return { type: "none" };
}

export function createRequest(input: {
  name: string;
  method?: HttpMethod;
  url?: string;
}): ApiRequest {
  return {
    id: createId("req"),
    name: input.name,
    method: input.method ?? "GET",
    url: input.url ?? "{{baseUrl}}/",
    queryParams: [],
    pathParams: [],
    headers: [],
    body: createEmptyBody(),
    auth: createAuthNone(),
    responseExamples: []
  };
}

export function createJwtRequest(): ApiRequest {
  return {
    ...createRequest({
      name: "JWT Token Request",
      method: "POST",
      url: "{{baseUrl}}/auth/token"
    }),
    headers: [createKeyValue("Content-Type", "application/json")],
    body: {
      mode: "json",
      contentType: "application/json",
      raw: JSON.stringify(
        {
          username: "{{username}}",
          password: "{{password}}"
        },
        null,
        2
      )
    },
    responseExamples: [
      {
        id: createId("res"),
        name: "Token response",
        status: 200,
        headers: [createKeyValue("Content-Type", "application/json")],
        contentType: "application/json",
        body: JSON.stringify(
          {
            access_token: "...",
            token_type: "Bearer",
            expires_in: 3600
          },
          null,
          2
        )
      }
    ]
  };
}

/**
 * Apinizer Management API access-token request, matching Apinizer's official
 * API reference (docs.apinizer.com/api-reference/auth): POST
 * {manager}/apiops/auth/token with a form-urlencoded client_credentials grant
 * where client_id = Apinizer username and client_secret = Apinizer password.
 * The endpoint needs no auth itself. Returns { access_token, token_type,
 * expires_in }. Values are {{variables}}; store the returned access_token as
 * {{accessToken}} for Bearer auth on other requests.
 */
export function createApinizerJwtRequest(): ApiRequest {
  return {
    ...createRequest({
      name: "Apinizer Access Token",
      method: "POST",
      url: "{{baseUrl}}/apiops/auth/token"
    }),
    description:
      "Apinizer Management API token (client_credentials grant). Set baseUrl to your Apinizer manager address; username/password (sent as client_id/client_secret) come from the environment. The response's access_token is used as Bearer auth on other requests.",
    headers: [
      createKeyValue("Content-Type", "application/x-www-form-urlencoded"),
      createKeyValue("Accept", "application/json")
    ],
    auth: { type: "none" },
    body: {
      mode: "form",
      contentType: "application/x-www-form-urlencoded",
      form: [
        createKeyValue("grant_type", "client_credentials"),
        createKeyValue("client_id", "{{username}}"),
        createKeyValue("client_secret", "{{password}}")
      ]
    },
    responseExamples: [
      {
        id: createId("res"),
        name: "Token response",
        status: 200,
        headers: [createKeyValue("Content-Type", "application/json")],
        contentType: "application/json",
        body: JSON.stringify(
          {
            access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
            token_type: "Bearer",
            expires_in: 3600
          },
          null,
          2
        )
      }
    ]
  };
}

export function createFolder(name: string): Folder {
  return {
    id: createId("folder"),
    name,
    folders: [],
    requests: []
  };
}

export function createCollection(name: string): Collection {
  return {
    id: createId("col"),
    name,
    folders: [],
    requests: []
  };
}

export function createEnvironment(name: string): Environment {
  return {
    id: createId("env"),
    name,
    variables: []
  };
}

/** Deep-copy a request with fresh ids so the copy is independently editable. */
export function cloneRequest(request: ApiRequest, nameSuffix = " copy"): ApiRequest {
  const copy = structuredClone(request);
  copy.id = createId("req");
  copy.name = `${request.name}${nameSuffix}`;
  copy.queryParams = copy.queryParams.map((item) => ({ ...item, id: createId("kv") }));
  copy.pathParams = copy.pathParams.map((item) => ({ ...item, id: createId("kv") }));
  copy.headers = copy.headers.map((item) => ({ ...item, id: createId("kv") }));
  copy.responseExamples = copy.responseExamples.map((example) => ({
    ...example,
    id: createId("res"),
    headers: example.headers.map((item) => ({ ...item, id: createId("kv") }))
  }));
  return copy;
}

/** Deep-copy a folder (including children) with fresh ids throughout. */
export function cloneFolder(folder: Folder, nameSuffix = " copy"): Folder {
  return {
    ...structuredClone(folder),
    id: createId("folder"),
    name: `${folder.name}${nameSuffix}`,
    requests: folder.requests.map((request) => cloneRequest(request, "")),
    folders: folder.folders.map((child) => cloneFolder(child, ""))
  };
}

export function createEmptyWorkspace(name = "Specfold"): Workspace {
  return {
    id: createId("workspace"),
    schemaVersion: 1,
    name,
    collections: [],
    environments: [],
    updatedAt: new Date().toISOString()
  };
}

