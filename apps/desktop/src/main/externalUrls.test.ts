import { describe, expect, it } from "vitest";
import { trustedExternalUrl } from "./externalUrls";

describe("trusted external URLs", () => {
  it("allows Specfold documentation and GitHub release links", () => {
    expect(trustedExternalUrl("https://gatewaylabs.net/docs/specfold")).toBe(
      "https://gatewaylabs.net/docs/specfold"
    );
    expect(trustedExternalUrl("https://github.com/Gatewaylabsnet/specfold/releases/latest")).toBe(
      "https://github.com/Gatewaylabsnet/specfold/releases/latest"
    );
  });

  it("rejects other protocols, hosts, and credential-bearing URLs", () => {
    expect(() => trustedExternalUrl("http://gatewaylabs.net/specfold")).toThrow();
    expect(() => trustedExternalUrl("https://example.com/specfold")).toThrow();
    expect(() => trustedExternalUrl("https://gatewaylabs.net@example.com/specfold")).toThrow();
  });
});
