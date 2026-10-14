import { Agent, FormData as UndiciFormData, ProxyAgent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";

type EnvMap = Record<string, string | undefined>;
type SystemProxyResolver = (url: string) => Promise<string>;

export class ProxyAgentCache {
  private readonly agents = new Map<string, ProxyAgent>();
  private readonly directAgents = new Map<boolean, Agent>();

  get(uri: string, allowInsecureTls = false): ProxyAgent {
    const rejectUnauthorized = !allowInsecureTls;
    const key = JSON.stringify([uri, rejectUnauthorized]);
    const existing = this.agents.get(key);
    if (existing) {
      return existing;
    }
    const agent = new ProxyAgent({ uri,
      requestTls: { rejectUnauthorized }, proxyTls: { rejectUnauthorized } });
    this.agents.set(key, agent);
    return agent;
  }

  direct(allowInsecureTls = false): Agent {
    const rejectUnauthorized = !allowInsecureTls;
    const existing = this.directAgents.get(rejectUnauthorized);
    if (existing) return existing;
    const agent = new Agent({ connect: { rejectUnauthorized } });
    this.directAgents.set(rejectUnauthorized, agent);
    return agent;
  }

  async closeAll(): Promise<void> {
    const agents = [...this.agents.values(), ...this.directAgents.values()];
    this.agents.clear();
    this.directAgents.clear();
    await Promise.all(agents.map((agent) => agent.close()));
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
  env: EnvMap = process.env,
  allowInsecureTls = false
): Promise<Response> {
  const proxyUri = await resolveProxyUri(rawUrl, resolveSystemProxy, env);
  // Keep verified and insecure connections in separate pools, including HTTPS proxies.
  // Explicit true also prevents an inherited Node TLS environment flag weakening strict sends.
  const dispatcher = proxyUri ? agents.get(proxyUri, allowInsecureTls) : agents.direct(allowInsecureTls);
  const nextInit = { ...init, dispatcher } as UndiciRequestInit;
  // Native FormData belongs to the runtime's bundled Undici. Preserve Blob handles and
  // filenames while adapting its entries, so file uploads remain streamed without copying bytes.
  if (init.body instanceof FormData) {
    const body = new UndiciFormData();
    for (const [name, value] of init.body) {
      if (typeof value === "string") body.append(name, value);
      else body.append(name, value, value.name);
    }
    nextInit.body = body;
  }
  // Match fetch to its dispatcher version, independent of Electron's built-in Undici version.
  return await undiciFetch(rawUrl, nextInit) as unknown as Response;
}
