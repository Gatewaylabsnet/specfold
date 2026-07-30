import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { resolveRendererAssetPath } from "./protocolPaths";

describe("renderer protocol paths", () => {
  const root = resolve("out/renderer");

  it("resolves only assets inside the renderer bundle", () => {
    expect(resolveRendererAssetPath(root, "/")).toBe(resolve(root, "index.html"));
    expect(resolveRendererAssetPath(root, "/assets/app.js")).toBe(resolve(root, "assets/app.js"));
  });

  it("rejects encoded or plain traversal", () => {
    expect(resolveRendererAssetPath(root, "/../main/index.js")).toBeUndefined();
    expect(resolveRendererAssetPath(root, "/%2e%2e/main/index.js")).toBeUndefined();
    expect(resolveRendererAssetPath(root, "/%E0%A4%A")).toBeUndefined();
  });
});
