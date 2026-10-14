import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/contracts";
import { checkForUpdates } from "./http";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), settings: vi.fn(), resolveProxy: vi.fn() }));
vi.mock("electron", () => ({ session: { defaultSession: { resolveProxy: mocks.resolveProxy } } }));
vi.mock("./storage", () => ({ loadSettings: mocks.settings }));
vi.mock("./proxy", () => ({ ProxyAgentCache: class {}, fetchWithProxy: mocks.fetch }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue(DEFAULT_SETTINGS);
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ tag_name: "v1.11.0", draft: false, prerelease: false,
    name: "Specfold 1.11.0", html_url: "https://github.com/Gatewaylabsnet/specfold/releases/tag/v1.11.0" }),
  { headers: { "content-type": "application/json" } }));
});

describe("stable update channel", () => {
  it.each(["1.11.0-dev.1", "1.11.0-rc.1", "1.10.0", "1.9.4"])("offers stable 1.11.0 to %s", async (current) => {
    const result = await checkForUpdates(current);
    expect(result).toMatchObject({ ok: true, currentVersion: current, latestVersion: "1.11.0", updateAvailable: true });
    expect(mocks.fetch).toHaveBeenCalledWith("https://api.github.com/repos/Gatewaylabsnet/specfold/releases/latest",
      expect.objectContaining({ signal: expect.any(AbortSignal) }), expect.any(Function), expect.any(Object));
  });
  it.each(["1.11.0", "1.11.0+local.build", "1.11.1", "1.12.0"])("does not offer an equal version or downgrade to %s", async (current) => {
    expect(await checkForUpdates(current)).toMatchObject({ ok: true, updateAvailable: false });
  });
  it.each(["v01.11.0", "v1.11", "v1.11.0.1", "SYNTHETIC_INVALID_TAG"])("refuses malformed release tag %s", async (tag) => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ tag_name: tag })));
    const result = await checkForUpdates("1.10.0");
    expect(result).toMatchObject({ ok: false, error: "Latest release did not include a valid version tag." });
    expect(result.updateAvailable).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(tag);
  });
  it.each([
    { tag_name: "v1.12.0-beta.1", prerelease: false },
    { tag_name: "v1.12.0", prerelease: true },
    { tag_name: "v1.12.0", draft: true }
  ])("does not offer a draft/prerelease through the stable channel", async (release) => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify(release)));
    expect(await checkForUpdates("1.11.0")).toMatchObject({ ok: false, error: "Latest release was not a published stable version." });
  });
  it.each(["null", "[]", '"SYNTHETIC_PRIVATE_BODY"', "SYNTHETIC_PRIVATE_BODY broken"])("does not echo malformed metadata", async (body) => {
    mocks.fetch.mockResolvedValue(new Response(body));
    const result = await checkForUpdates("1.11.0");
    expect(result).toMatchObject({ ok: false, error: "Update response was not valid release metadata." });
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_BODY");
  });
  it("refuses an invalid installed version before any settings or network access", async () => {
    expect(await checkForUpdates("1.11")).toMatchObject({ ok: false });
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.settings).not.toHaveBeenCalled();
  });
});
