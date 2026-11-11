import { _electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const electronExecutable: string = createRequire(import.meta.url)("electron");

test("desktop opens an existing workspace after safely archiving a dead writer's lease", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "specfold-stale-lock-e2e-")));
  const lockName = ".specfold-writer.lock";
  const pid = Number(execFileSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }));
  expect(pid).toBeGreaterThan(0);
  const nonce = randomUUID();
  const stale = JSON.stringify({ owner: "desktop", pid, nonce });
  const workspace = {
    id: "recovery-workspace", name: "Existing workspace", schemaVersion: 1, updatedAt: "2026-01-01T00:00:00.000Z",
    activeEnvironmentId: "recovery-environment", environments: [{ id: "recovery-environment", name: "Recovery environment", variables: [] }],
    collections: [{ id: "recovery-collection", name: "Collection before crash", folders: [], requests: [] }]
  };
  await writeFile(join(root, lockName), stale, { mode: 0o600 });
  await writeFile(join(root, "workspace.json"), JSON.stringify(workspace));
  const packaged = process.env.SPECFOLD_E2E_EXECUTABLE;
  const app = await _electron.launch({
    executablePath: packaged ? resolve(packaged) : electronExecutable,
    args: packaged ? ["--disable-gpu"] : [resolve(repository, "apps/desktop/out/main/index.js")],
    env: { ...process.env, SPECFOLD_E2E_USER_DATA_PATH: root }
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText("Collection before crash", { exact: true }).first()).toBeVisible();
    expect(await readFile(join(root, `${lockName}.stale-${nonce}`), "utf8")).toBe(stale);
    expect(JSON.parse(await readFile(join(root, lockName), "utf8"))).toMatchObject({
      owner: "desktop", pid: await app.evaluate(() => process.pid)
    });
    expect((await readdir(root)).filter((name) => name.startsWith(`${lockName}.stale-`))).toHaveLength(1);
    const loaded = await page.evaluate(() => window.studio.loadWorkspace());
    expect(loaded.recovered).toBe(false);
    expect(loaded.workspace).toMatchObject({
      id: workspace.id, activeEnvironmentId: workspace.activeEnvironmentId,
      environments: workspace.environments, collections: workspace.collections
    });
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
