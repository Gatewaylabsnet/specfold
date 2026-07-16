import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPostmanV3Folder } from "./importSources";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "specfold-import-"));
  temporaryDirectories.push(path);
  return path;
}

describe("Postman folder reader", () => {
  it("enforces discovered-file and byte limits", async () => {
    const root = await fixture();
    await writeFile(join(root, "first.request.yaml"), "method: GET\nurl: https://example.test", "utf8");
    await writeFile(join(root, "ignored.txt"), "ignored", "utf8");
    await expect(readPostmanV3Folder(root, { maxFiles: 1 })).rejects.toThrow("more than 1 files");
    await expect(readPostmanV3Folder(root, { maxBytes: 4 })).rejects.toThrow("larger than 0 MB");
  });

  it("skips symlinked files and directories", async () => {
    const root = await fixture();
    const outside = await fixture();
    await writeFile(join(root, "kept.request.yaml"), "method: GET\nurl: https://example.test", "utf8");
    await writeFile(join(outside, "outside.request.yaml"), "method: DELETE\nurl: https://example.test", "utf8");
    try {
      await symlink(join(outside, "outside.request.yaml"), join(root, "linked.request.yaml"), "file");
      await symlink(outside, join(root, "linked-folder"), "junction");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    const result = await readPostmanV3Folder(root);
    expect(result.files.map((file) => file.path)).toEqual(["kept.request.yaml"]);
  });

  it("enforces traversal depth and counts skipped scripts", async () => {
    const root = await fixture();
    const nested = join(root, "one", "two");
    await mkdir(join(root, ".resources", "scripts"), { recursive: true });
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, ".resources", "scripts", "test.js"), "throw new Error()", "utf8");
    await writeFile(join(root, "root.request.yaml"), "method: GET\nurl: /", "utf8");
    await writeFile(join(nested, "nested.request.yaml"), "method: GET\nurl: /nested", "utf8");
    await expect(readPostmanV3Folder(root, { maxDepth: 1 })).rejects.toThrow("nested too deeply");
    const result = await readPostmanV3Folder(root);
    expect(result.skippedScriptCount).toBe(1);
  });
});
