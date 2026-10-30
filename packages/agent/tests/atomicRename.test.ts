import { mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { replaceFileAtomically } from "../src/atomicRename";

const roots: string[] = [];
afterEach(async () => {
  const base = await realpath(tmpdir());
  for (const root of roots.splice(0)) {
    if (dirname(root) !== base || !root.startsWith(join(base, "specfold-rename-test-"))) throw new Error("Unsafe test cleanup");
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "specfold-rename-test-"))); roots.push(root);
  const target = join(root, "settings.json"), source = join(root, "settings.json.tmp");
  await writeFile(target, "previous"); await writeFile(source, "next"); return { source, target };
}
const failure = (code: string) => Object.assign(new Error("Synthetic file operation failure"), { code });
it("retries transient Windows rename locks then atomically replaces the original", async () => {
  const f = await fixture(), wait = vi.fn(async (_milliseconds: number) => undefined);
  const replace = vi.fn().mockRejectedValueOnce(failure("EPERM")).mockRejectedValueOnce(failure("EBUSY")).mockImplementation(rename);
  await replaceFileAtomically(f.source, f.target, { platform: "win32", replace, wait });
  expect(replace).toHaveBeenCalledTimes(3); expect(wait.mock.calls.map((call) => call[0])).toEqual([20, 40]);
  expect(await readFile(f.target, "utf8")).toBe("next");
});
it("bounds retries and preserves the destination on persistent Windows denial", async () => {
  const f = await fixture(), error = failure("EPERM"), replace = vi.fn().mockRejectedValue(error), wait = vi.fn(async (_milliseconds: number) => undefined);
  await expect(replaceFileAtomically(f.source, f.target, { platform: "win32", replace, wait })).rejects.toBe(error);
  expect(replace).toHaveBeenCalledTimes(6); expect(wait.mock.calls.map((call) => call[0])).toEqual([20, 40, 80, 160, 320]);
  expect(await readFile(f.target, "utf8")).toBe("previous"); expect(await readFile(f.source, "utf8")).toBe("next");
});
it("does not retry access failures or alter non-Windows behavior", async () => {
  const f = await fixture();
  for (const [platform, code] of [["win32", "EACCES"], ["win32", "EIO"], ["linux", "EPERM"]] as const) {
    const error = failure(code), replace = vi.fn().mockRejectedValue(error), wait = vi.fn(async (_milliseconds: number) => undefined);
    await expect(replaceFileAtomically(f.source, f.target, { platform, replace, wait })).rejects.toBe(error);
    expect(replace).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled(); expect(await readFile(f.target, "utf8")).toBe("previous");
  }
});
