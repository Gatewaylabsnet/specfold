import { describe, expect, it } from "vitest";
import {
  getEnvProxyUri,
  normalizeProxyUri,
  parseElectronProxyRules,
  resolveProxyUri
} from "./proxy";

describe("proxy helpers", () => {
  it("normalizes proxy hosts without a scheme", () => {
    expect(normalizeProxyUri("proxy.local:8080")).toBe("http://proxy.local:8080");
    expect(normalizeProxyUri("https://secure-proxy.local:8443")).toBe(
      "https://secure-proxy.local:8443"
    );
  });

  it("parses Electron HTTP(S) proxy rules", () => {
    expect(parseElectronProxyRules("DIRECT")).toBeUndefined();
    expect(parseElectronProxyRules("PROXY proxy.local:8080; DIRECT")).toBe(
      "http://proxy.local:8080"
    );
    expect(parseElectronProxyRules("HTTPS secure-proxy.local:8443")).toBe(
      "https://secure-proxy.local:8443"
    );
  });

  it("rejects SOCKS proxy rules instead of silently bypassing them", () => {
    expect(() => parseElectronProxyRules("SOCKS5 socks.local:1080")).toThrow(/SOCKS/);
  });

  it("uses HTTPS proxy env values with HTTP fallback", () => {
    const target = new URL("https://api.example.com/users");
    expect(getEnvProxyUri(target, { HTTPS_PROXY: "secure-proxy.local:8443" })).toBe(
      "http://secure-proxy.local:8443"
    );
    expect(getEnvProxyUri(target, { HTTP_PROXY: "proxy.local:8080" })).toBe(
      "http://proxy.local:8080"
    );
  });

  it("honors NO_PROXY for env fallback", () => {
    const target = new URL("https://api.internal.example.com/users");
    expect(
      getEnvProxyUri(target, {
        HTTPS_PROXY: "proxy.local:8080",
        NO_PROXY: ".internal.example.com"
      })
    ).toBeUndefined();
  });

  it("prefers system proxy rules over env fallback", async () => {
    await expect(
      resolveProxyUri(
        "https://api.example.com/users",
        async () => "PROXY system-proxy.local:8080",
        { HTTPS_PROXY: "env-proxy.local:8443" }
      )
    ).resolves.toBe("http://system-proxy.local:8080");
  });
});
