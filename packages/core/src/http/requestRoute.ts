import type { Collection, Environment, Folder, KeyValue } from "../model/types";
import { environmentToMap, resolveVariablesInText } from "../variables/resolveVariables";

export class MissingVariablesError extends Error {
  readonly variables: string[];

  constructor(variables: string[]) {
    super(`Missing environment variables: ${variables.join(", ")}`);
    this.name = "MissingVariablesError";
    this.variables = variables;
  }
}

export function resolveRelativeUrl(
  requestUrl: string,
  environment?: Environment,
  collection?: Pick<Collection, "baseUrl">,
  folderPath: readonly Pick<Folder, "baseUrl">[] = []
): string {
  if (/^https?:\/\//i.test(requestUrl) || !requestUrl.trim()) {
    return requestUrl;
  }
  const variables = environmentToMap(environment, collection, folderPath);
  const baseUrlInput = variables.baseUrl?.trim();
  if (!baseUrlInput) {
    return requestUrl;
  }
  const baseUrl = resolveVariablesInText(baseUrlInput, variables);
  if (baseUrl.missing.length > 0) {
    throw new MissingVariablesError(baseUrl.missing);
  }
  if (!/^https?:\/\//i.test(baseUrl.value)) {
    return requestUrl;
  }
  const normalizedBase = `${baseUrl.value.replace(/\/+$/, "")}/`;
  const normalizedRequest = requestUrl.replace(/^\/+/, "");
  return new URL(normalizedRequest, normalizedBase).toString();
}

export function substitutePathParams(url: string, params: readonly KeyValue[]): string {
  for (const param of params) {
    if (!param.enabled || !param.key) continue;
    url = url
      .replaceAll(`{${param.key}}`, encodeURIComponent(param.value))
      .replaceAll(`:${param.key}`, encodeURIComponent(param.value));
  }
  return url;
}
