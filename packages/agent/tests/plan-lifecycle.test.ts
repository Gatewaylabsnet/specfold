import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCollection, createEmptyWorkspace, createRequest } from "@openapi-collection-studio/core";
import { AgentRepository } from "../src/repository";
import { AgentService } from "../src/service";
import { acquireWorkspaceLease } from "../src/workspaceLock";

const DAY = 24 * 60 * 60 * 1000;
let root: string, state: string, collectionId: string, service: AgentService;
let now: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "specfold-plan-lifecycle-")));
  const workspace = createEmptyWorkspace();
  const collection = createCollection("Plan lifecycle");
  collection.requests.push(createRequest({ name: "Saved request", url: "https://example.test/items" }));
  collectionId = collection.id;
  workspace.collections.push(collection);
  await writeFile(join(root, "workspace.json"), JSON.stringify(workspace));
  service = new AgentService(new AgentRepository(root), true);
  state = await service.repository.stateDirectory();
  now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

const preview = (name: string) => service.preview({ kind: "bind-bearer", collectionId, variableName: name });
async function fill(count: number) {
  const plans = [];
  for (let index = 0; index < count; index++) plans.push(await preview(`token${index}`));
  return plans;
}
const advanceDay = () => now.mockReturnValue(1_800_000_000_000 + DAY + 1);

describe("signed plan lifecycle", () => {
  it("reclaims 128 expired signed plans after restart so a fresh preview can be created", async () => {
    const expired = await fill(128);
    await service.approve(expired[0].planId, expired[0].expectedRevision);
    const workspace = await readFile(join(root, "workspace.json"), "utf8");
    const key = await readFile(join(state, "plan-key"), "utf8");
    advanceDay();
    service = new AgentService(new AgentRepository(root), true);

    const fresh = await preview("freshToken");
    expect((await service.loadPlan(fresh.planId)).createdAt).toBe(Date.now());
    const files = await readdir(state);
    expect(files.filter((name) => name.endsWith(".plan.json"))).toEqual([`${fresh.planId}.plan.json`]);
    for (const plan of expired) expect(files).not.toContain(`${plan.planId}.plan.json`);
    expect(files).not.toContain(`${expired[0].planId}.approval.json`);
    expect(await readFile(join(root, "workspace.json"), "utf8")).toBe(workspace);
    expect(await readFile(join(state, "plan-key"), "utf8")).toBe(key);
  });

  it("preserves active approvals and idempotency receipts while reclaiming expired plans", async () => {
    await fill(126);
    now.mockReturnValue(1_800_000_000_000 + DAY / 2);
    const applied = await preview("appliedToken");
    await service.approve(applied.planId, applied.expectedRevision);
    await service.apply(applied.planId, applied.expectedRevision);
    const active = await preview("approvedToken");
    await service.approve(active.planId, active.expectedRevision);
    const planPath = join(state, `${active.planId}.plan.json`);
    const approvalPath = join(state, `${active.planId}.approval.json`);
    const receiptPath = join(state, `${applied.planId}.receipt.json`);
    const before = await Promise.all([planPath, approvalPath, receiptPath].map((path) => readFile(path, "utf8")));
    advanceDay();

    await preview("anotherToken");
    await preview("approvedToken");
    expect(await Promise.all([planPath, approvalPath, receiptPath].map((path) => readFile(path, "utf8")))).toEqual(before);
    expect((await service.apply(applied.planId, applied.expectedRevision)).alreadyApplied).toBe(true);
    expect((await service.apply(active.planId, active.expectedRevision)).alreadyApplied).toBe(false);
  });

  it("does not reclaim active plans to make room beyond the 128-plan limit", async () => {
    const active = await fill(128);
    await expect(preview("overflowToken")).rejects.toThrow("PLAN_LIMIT");
    expect((await service.loadPlan(active[0].planId)).createdAt).toBe(Date.now());
    expect((await readdir(state)).filter((name) => name.endsWith(".plan.json"))).toHaveLength(128);
  });

  it("preserves malformed, forged, unrelated and symlinked files during cleanup", async () => {
    const expired = await fill(128);
    const malformedPath = join(state, `${expired[0].planId}.plan.json`);
    const forgedPath = join(state, `${expired[1].planId}.plan.json`);
    const linkPath = join(state, `${expired[2].planId}.plan.json`);
    const forged = JSON.parse(await readFile(forgedPath, "utf8"));
    forged.signature = "0".repeat(64);
    await writeFile(malformedPath, "{unrelated content");
    await writeFile(forgedPath, JSON.stringify(forged));
    const target = join(root, "unrelated-directory");
    await mkdir(target);
    const targetPath = join(target, "keep.json");
    await writeFile(targetPath, "unrelated symlink target");
    await unlink(linkPath);
    await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
    const unrelatedPath = join(state, "operator-notes.plan.json");
    const receiptPath = join(state, `${expired[3].planId}.receipt.json`);
    const approvalPath = join(state, `${expired[4].planId}.approval.json`);
    await writeFile(unrelatedPath, "operator notes");
    await writeFile(receiptPath, "historical receipt must remain");
    await writeFile(approvalPath, "unrecognized approval must remain");
    advanceDay();

    await preview("freshToken");
    expect(await readFile(malformedPath, "utf8")).toBe("{unrelated content");
    expect(await readFile(forgedPath, "utf8")).toBe(JSON.stringify(forged));
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(targetPath, "utf8")).toBe("unrelated symlink target");
    expect(await readFile(unrelatedPath, "utf8")).toBe("operator notes");
    expect(await readFile(receiptPath, "utf8")).toBe("historical receipt must remain");
    expect(await readFile(approvalPath, "utf8")).toBe("unrecognized approval must remain");
  });

  it("requires fresh approval when the same expired proposal is previewed again", async () => {
    const expired = await preview("sameToken");
    await service.approve(expired.planId, expired.expectedRevision);
    advanceDay();

    const fresh = await preview("sameToken");
    expect(fresh.planId).toBe(expired.planId);
    expect((await service.loadPlan(fresh.planId)).createdAt).toBe(Date.now());
    await expect(service.apply(fresh.planId, fresh.expectedRevision)).rejects.toThrow("APPROVAL_REQUIRED");
    await service.approve(fresh.planId, fresh.expectedRevision);
    expect((await service.apply(fresh.planId, fresh.expectedRevision)).alreadyApplied).toBe(false);
  });

  it("serializes preview cleanup and replacement across services without taking the desktop lease", async () => {
    let entered!: () => void, resume!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const paused = new Promise<void>((resolve) => { resume = resolve; });
    const loadPlan = service.loadPlan.bind(service);
    vi.spyOn(service, "loadPlan").mockImplementationOnce(async (id) => {
      entered();
      await paused;
      return loadPlan(id);
    });
    const releaseDesktop = acquireWorkspaceLease(root, "desktop");
    try {
      const first = preview("firstToken");
      await started;
      const other = new AgentService(new AgentRepository(root), true);
      try {
        await expect(other.preview({ kind: "bind-bearer", collectionId, variableName: "secondToken" }))
          .rejects.toThrow("WORKSPACE_BUSY");
      } finally { resume(); await first; }
      await expect(other.preview({ kind: "bind-bearer", collectionId, variableName: "secondToken" }))
        .resolves.toMatchObject({ approvalRequired: true });
    } finally { releaseDesktop(); }
  });
});
