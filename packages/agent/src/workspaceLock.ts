import { closeSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const WORKSPACE_LOCK = ".specfold-writer.lock";
const MAX_LOCK_BYTES = 512;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
type Owner = "desktop" | "agent";
type Lease = { owner: Owner; pid: number; nonce: string };
type Identity = { dev: bigint; ino: bigint };

const sameFile = (a: Identity, b: Identity): boolean => a.ino === b.ino && a.dev === b.dev;

function readLease(path: string): (Lease & Identity) | undefined {
  const entry = lstatSync(path, { bigint: true });
  if (!entry.isFile() || entry.size === 0n || entry.size > BigInt(MAX_LOCK_BYTES)) return;
  const fd = openSync(path, "r");
  try {
    const info = fstatSync(fd, { bigint: true });
    if (!info.isFile() || !sameFile(entry, info) || info.size !== entry.size) return;
    const bytes = Buffer.alloc(MAX_LOCK_BYTES + 1);
    const count = readSync(fd, bytes);
    if (count !== Number(info.size)) return;
    const data = JSON.parse(bytes.toString("utf8", 0, count)) as Partial<Lease> | null;
    if (!data || (data.owner !== "desktop" && data.owner !== "agent") ||
        typeof data.pid !== "number" || !Number.isInteger(data.pid) || data.pid <= 0 || data.pid > 0x7fffffff ||
        typeof data.nonce !== "string" || !UUID.test(data.nonce)) return;
    return { owner: data.owner, pid: data.pid, nonce: data.nonce, dev: info.dev, ino: info.ino };
  } finally { closeSync(fd); }
}

function processIsGone(pid: number): boolean {
  try { process.kill(pid, 0); }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
  // A live or reused PID is not proof that the lease can be moved.
  return false;
}

function quarantineAbandonedLease(path: string): void {
  try {
    const stale = readLease(path);
    if (!stale || stale.ino === 0n || !processIsGone(stale.pid)) return;
    // The owner may have released normally before exiting, in which case
    // another writer could already own the canonical path.
    const beforeLink = readLease(path);
    if (beforeLink?.nonce !== stale.nonce || !sameFile(stale, beforeLink)) return;
    const archive = `${path}.stale-${stale.nonce.toLowerCase()}`;
    // An exclusive hard link both preserves the bytes and elects one reclaimer
    // per lease. A late contender cannot rename away a new writer's lease.
    linkSync(path, archive);
    const archived = readLease(archive);
    const current = lstatSync(path, { bigint: true });
    if (archived?.nonce === stale.nonce && archived.pid === stale.pid && archived.owner === stale.owner && sameFile(stale, archived) &&
        current.isFile() && sameFile(stale, current) && processIsGone(stale.pid)) {
      unlinkSync(path);
    }
  } catch { /* Ambiguous ownership, interrupted recovery, or unsupported filesystem: fail closed. */ }
}

function openExclusive(path: string): number | undefined {
  try { return openSync(path, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
    throw error;
  }
}

/** Lifetime lease for desktop; transaction lease for agents. */
export function acquireWorkspaceLease(userData: string, owner: Owner): () => void {
  mkdirSync(userData, { recursive: true });
  if (!lstatSync(userData).isDirectory()) throw new Error("UNSAFE_DATA_PATH");
  const path = join(userData, WORKSPACE_LOCK);
  const nonce = randomUUID();
  let descriptor = openExclusive(path);
  if (descriptor === undefined) {
    quarantineAbandonedLease(path);
    descriptor = openExclusive(path);
  }
  if (descriptor === undefined) throw new Error("WORKSPACE_BUSY");
  try { writeFileSync(descriptor, JSON.stringify({ owner, pid: process.pid, nonce }), "utf8"); }
  catch (error) { closeSync(descriptor); unlinkSync(path); throw error; }
  closeSync(descriptor);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Do not remove a lease belonging to another process, including after manual recovery.
    try { if (readLease(path)?.nonce === nonce) unlinkSync(path); }
    catch { /* Leave an ambiguous lease in place. */ }
  };
}
