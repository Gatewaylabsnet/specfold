import { describe, expect, it } from "vitest";
import { isTrustedRendererUrl } from "./securityUrls";

describe("trusted renderer URLs", () => {
  it("accepts only the packaged application entry point", () => {
    expect(isTrustedRendererUrl("specfold://app/index.html")).toBe(true);
    expect(isTrustedRendererUrl("specfold://other/index.html")).toBe(false);
    expect(isTrustedRendererUrl("file:///tmp/index.html")).toBe(false);
    expect(isTrustedRendererUrl("https://gatewaylabs.net/specfold")).toBe(false);
  });

  it("allows only the configured development origin", () => {
    const devServer = "http://127.0.0.1:5173";
    expect(isTrustedRendererUrl("http://127.0.0.1:5173/index.html", devServer)).toBe(true);
    expect(isTrustedRendererUrl("http://localhost:5173/index.html", devServer)).toBe(false);
    expect(isTrustedRendererUrl("https://127.0.0.1:5173/index.html", devServer)).toBe(false);
  });
});
