import type { ApiRequest } from "../model/types";
import type { ConnectionProfile } from "./types";

export function workflowReplacedAuthFields(request: ApiRequest, profile: ConnectionProfile): { headers: string[]; query: string[] } {
  const headers = new Set(["authorization"]), query = new Set<string>();
  if (request.auth.type === "apiKey") {
    if (request.auth.in === "header") headers.add(request.auth.key.toLowerCase());
    else query.add(request.auth.key);
  }
  if (profile.auth.kind === "apiKey") {
    if (profile.auth.in === "header") headers.add(profile.auth.key.toLowerCase());
    else query.add(profile.auth.key);
  }
  return { headers: [...headers], query: [...query] };
}

/** Identical profile-auth override for planning and execution; saved data is untouched. */
export function workflowRequest(request: ApiRequest, profile: ConnectionProfile): ApiRequest {
  const copy = structuredClone(request);
  const replaced = workflowReplacedAuthFields(request, profile);
  copy.headers = copy.headers.filter((field) => !replaced.headers.includes(field.key.toLowerCase()));
  copy.queryParams = copy.queryParams.filter((field) => !replaced.query.includes(field.key));
  const auth = profile.auth;
  if (auth.kind === "none") copy.auth = { type: "none" };
  else if (auth.kind === "bearer" || auth.kind === "apinizer") copy.auth = { type: "bearer", token: `{{${auth.tokenVariable}}}` };
  else if (auth.kind === "basic") copy.auth = { type: "basic", username: `{{${auth.usernameVariable}}}`, password: `{{${auth.passwordVariable}}}` };
  else copy.auth = { type: "apiKey", key: auth.key, in: auth.in, value: `{{${auth.valueVariable}}}` };
  return copy;
}
