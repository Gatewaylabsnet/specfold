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
 * Apinizer-flavored token request: OAuth2 Resource Owner Password Credentials
 * grant, form-encoded, with client credentials in Basic auth. All values are
 * {{variables}} so they resolve from an environment. Adjust the token path or
 * fields per your Apinizer deployment.
 */
export function createApinizerJwtRequest(): ApiRequest {
  return {
    ...createRequest({
      name: "Apinizer JWT Token",
      method: "POST",
      url: "{{baseUrl}}/auth/jwt"
    }),
    description:
      "OAuth2 password grant against Apinizer. Set baseUrl, clientId, clientSecret, username, password (and scope if used) in an environment.",
    headers: [createKeyValue("Content-Type", "application/x-www-form-urlencoded")],
    auth: { type: "basic", username: "{{clientId}}", password: "{{clientSecret}}" },
    body: {
      mode: "form",
      contentType: "application/x-www-form-urlencoded",
      form: [
        createKeyValue("grant_type", "password"),
        createKeyValue("username", "{{username}}"),
        createKeyValue("password", "{{password}}"),
        createKeyValue("scope", "{{scope}}")
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
            access_token: "...",
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: "...",
            scope: ""
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

