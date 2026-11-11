import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, linkSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireWorkspaceLease, WORKSPACE_LOCK } from "../src/workspaceLock";

const workerModule = new URL("../src/workspaceLock.ts", import.meta.url).href;
const worker = `
  import { acquireWorkspaceLease } from ${JSON.stringify(workerModule)};
  let release;
  process.on("message", (message) => {
    if (message === "acquire") {
      try { release = acquireWorkspaceLease(process.argv[1], "agent"); process.send("acquired"); }
      catch (error) { process.send(error.message); }
    } else if (message === "release") { release?.(); process.exit(0); }
  });
  process.send("ready");
`;

let root: string;
let lock: string;
let children: ChildProcess[];

function nextMessage(child: ChildProcess): Promise<unknown> {
  return new Promise((resolve, reject) => {
    function done(message: unknown) {
      child.off("exit", failed);
      resolve(message);
    }
    function failed(code: number | null, signal: NodeJS.Signals | null) {
      child.off("message", done);
      reject(new Error(`Lease worker exited before replying: ${code ?? signal}`));
    }
    child.once("message", done);
    child.once("exit", failed);
  });
}

async function startWorker(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", worker, root], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  children.push(child);
  expect(await nextMessage(child)).toBe("ready");
  return child;
}

function requestLease(child: ChildProcess): Promise<unknown> {
  const reply = nextMessage(child);
  child.send("acquire");
  return reply;
}

async function stopWorker(child: ChildProcess, crash = false): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  if (crash) child.kill();
  else child.send("release");
  await exited;
}

function readLock() {
  return JSON.parse(readFileSync(lock, "utf8")) as { owner: string; pid: number; nonce: string };
}

const archives = () => readdirSync(root).filter((name) => name.startsWith(`${WORKSPACE_LOCK}.stale-`));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "specfold-lock-test-"));
  lock = join(root, WORKSPACE_LOCK);
  children = [];
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(children.map((child) => stopWorker(child, true)));
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("workspace writer lease", () => {
  it("keeps the exact lease of a live process and releases it normally", async () => {
    const child = await startWorker();
    expect(await requestLease(child)).toBe("acquired");
    const original = readFileSync(lock, "utf8");
    expect(readLock().pid).toBe(child.pid);
    expect(() => acquireWorkspaceLease(root, "desktop")).toThrow("WORKSPACE_BUSY");
    expect(readFileSync(lock, "utf8")).toBe(original);
    expect(archives()).toEqual([]);
    await stopWorker(child);
    expect(existsSync(lock)).toBe(false);
  });

  it("preserves a crashed writer's bytes and acquires a new lease", async () => {
    const child = await startWorker();
    expect(await requestLease(child)).toBe("acquired");
    const original = readFileSync(lock);
    const archive = `${WORKSPACE_LOCK}.stale-${readLock().nonce}`;
    await stopWorker(child, true);
    const release = acquireWorkspaceLease(root, "desktop");
    expect(readFileSync(join(root, archive))).toEqual(original);
    expect(readLock()).toMatchObject({ pid: process.pid, owner: "desktop" });
    expect(() => acquireWorkspaceLease(root, "agent")).toThrow("WORKSPACE_BUSY");
    release();
    release();
    expect(readdirSync(root)).toEqual([archive]);
  });

  it("allows exactly one concurrent reclaimer and never archives its live lease", async () => {
    const formerWriter = await startWorker();
    expect(await requestLease(formerWriter)).toBe("acquired");
    const original = readFileSync(lock);
    const archive = `${WORKSPACE_LOCK}.stale-${readLock().nonce}`;
    await stopWorker(formerWriter, true);
    const contenders = await Promise.all(Array.from({ length: 6 }, () => startWorker()));
    const results = await Promise.all(contenders.map(requestLease));
    expect(results.filter((result) => result === "acquired")).toHaveLength(1);
    expect(results.filter((result) => result === "WORKSPACE_BUSY")).toHaveLength(5);
    const winner = contenders[results.indexOf("acquired")];
    expect(readLock().pid).toBe(winner.pid);
    expect(archives()).toEqual([archive]);
    expect(readFileSync(join(root, archive))).toEqual(original);
    expect(() => acquireWorkspaceLease(root, "desktop")).toThrow("WORKSPACE_BUSY");
    await Promise.all(contenders.map((child) => stopWorker(child)));
    expect(existsSync(lock)).toBe(false);
  });

  it.each(["", "{", "x".repeat(513), '{"owner":"desktop","pid":0}', '{"owner":"agent","pid":-1,"nonce":"invalid"}'])(
    "leaves malformed or oversized leases untouched (%#)",
    (original) => {
      writeFileSync(lock, original);
      expect(() => acquireWorkspaceLease(root, "desktop")).toThrow("WORKSPACE_BUSY");
      expect(readFileSync(lock, "utf8")).toBe(original);
      expect(archives()).toEqual([]);
    },
  );

  it("does not reclaim when the OS cannot confirm the owner is gone", () => {
    const original = JSON.stringify({ owner: "desktop", pid: process.pid, nonce: randomUUID() });
    writeFileSync(lock, original);
    const probe = vi.spyOn(process, "kill").mockImplementationOnce(() => {
      throw Object.assign(new Error("Access denied"), { code: "EPERM" });
    });
    expect(() => acquireWorkspaceLease(root, "agent")).toThrow("WORKSPACE_BUSY");
    expect(probe).toHaveBeenCalledWith(process.pid, 0);
    expect(readFileSync(lock, "utf8")).toBe(original);
    expect(archives()).toEqual([]);
  });

  it("leaves a replacement untouched when the former owner released before exiting", async () => {
    const formerWriter = await startWorker();
    expect(await requestLease(formerWriter)).toBe("acquired");
    const replacement = JSON.stringify({ owner: "agent", pid: process.pid, nonce: randomUUID() });
    const temp = join(root, "replacement");
    writeFileSync(temp, replacement);
    vi.spyOn(process, "kill").mockImplementationOnce(() => {
      renameSync(temp, lock);
      throw Object.assign(new Error("No such process"), { code: "ESRCH" });
    });
    expect(() => acquireWorkspaceLease(root, "desktop")).toThrow("WORKSPACE_BUSY");
    expect(readFileSync(lock, "utf8")).toBe(replacement);
    expect(archives()).toEqual([]);
  });

  it("does not overwrite an archive or bypass another recovery claim", async () => {
    const child = await startWorker();
    expect(await requestLease(child)).toBe("acquired");
    const original = readFileSync(lock);
    const archive = join(root, `${WORKSPACE_LOCK}.stale-${readLock().nonce}`);
    await stopWorker(child, true);
    linkSync(lock, archive);
    expect(() => acquireWorkspaceLease(root, "desktop")).toThrow("WORKSPACE_BUSY");
    expect(readFileSync(lock)).toEqual(original);
    expect(readFileSync(archive)).toEqual(original);
  });

  it("does not follow a junction at the lock path", () => {
    const target = mkdtempSync(join(root, "target-"));
    symlinkSync(target, lock, "junction");
    expect(() => acquireWorkspaceLease(root, "agent")).toThrow("WORKSPACE_BUSY");
    expect(archives()).toEqual([]);
    expect(readdirSync(target)).toEqual([]);
  });
});
