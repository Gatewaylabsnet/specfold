import { ProxyAgent } from "undici";

type EnvMap = Record<string, string | undefined>;
type SystemProxyResolver = (url: string) => Promise<string>;

export class ProxyAgentCache {
  private readonly agents = new Map<string, ProxyAgent>();

  get(uri: string): ProxyAgent {
    const existing = this.agents.get(uri);
    if (existing) {
      return existing;
    }
    const agent = new ProxyAgent(uri);
    this.agents.set(uri, agent);
    return agent;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.agents.values()].map((agent) => agent.close()));
    this.agents.clear();
  }
}

function envValue(env: EnvMap, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value?.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function normalizeProxyUri(value: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
}

export function bypassesEnvProxy(target: URL, env: EnvMap = process.env): boolean {
  const noProxy = envValue(env, "NO_PROXY", "no_proxy");
  if (!noProxy) {
    return false;
  }

  const host = target.hostname.toLowerCase();
  const port = target.port;
  return noProxy
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") {
        return true;
      }
      const [pattern, patternPort] = entry.split(":");
      if (patternPort && patternPort !== port) {
        return false;
      }
      if (pattern.startsWith(".")) {
        return host.endsWith(pattern);
      }
      return host === pattern || host.endsWith(`.${pattern}`);
    });
}

export function getEnvProxyUri(target: URL, env: EnvMap = process.env): string | undefined {
  if (bypassesEnvProxy(target, env)) {
    return undefined;
  }

  const proxy =
    target.protocol === "https:"
      ? envValue(env, "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy")
      : envValue(env, "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy");
  return proxy ? normalizeProxyUri(proxy) : undefined;
}

export function parseElectronProxyRules(rules: string): string | undefined {
  let sawUnsupportedProxy = false;
  for (const rule of rules.split(";")) {
    const trimmed = rule.trim();
    if (!trimmed || trimmed.toUpperCase() === "DIRECT") {
      continue;
    }

    const [kind, address] = trimmed.split(/\s+/, 2);
    if (!address) {
      continue;
    }

    const upperKind = kind.toUpperCase();
    if (upperKind === "PROXY" || upperKind === "HTTP") {
      return normalizeProxyUri(address);
    }
    if (upperKind === "HTTPS") {
      return normalizeProxyUri(`https://${address}`);
    }
    if (upperKind.startsWith("SOCKS")) {
      sawUnsupportedProxy = true;
    }
  }

  if (sawUnsupportedProxy) {
    throw new Error("SOCKS proxies are not supported yet. Configure an HTTP(S) proxy for Specfold.");
  }
  return undefined;
}

export async function resolveProxyUri(
  rawUrl: string,
  resolveSystemProxy: SystemProxyResolver,
  env: EnvMap = process.env
): Promise<string | undefined> {
  const target = new URL(rawUrl);
  const systemRules = await resolveSystemProxy(rawUrl).catch(() => "DIRECT");
  return parseElectronProxyRules(systemRules) ?? getEnvProxyUri(target, env);
}

export async function fetchWithProxy(
  rawUrl: string,
  init: RequestInit,
  resolveSystemProxy: SystemProxyResolver,
  agents: ProxyAgentCache,
  env: EnvMap = process.env
): Promise<Response> {
  const proxyUri = await resolveProxyUri(rawUrl, resolveSystemProxy, env);
  const nextInit = proxyUri
    ? ({ ...init, dispatcher: agents.get(proxyUri) } as unknown as RequestInit)
    : init;
  return fetch(rawUrl, nextInit);
}
