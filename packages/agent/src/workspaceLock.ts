import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const WORKSPACE_LOCK = ".specfold-writer.lock";

/** Lifetime lease for desktop; transaction lease for agents. Fail closed on crashes. */
export function acquireWorkspaceLease(userData: string, owner: "desktop" | "agent"): () => void {
  mkdirSync(userData, { recursive: true });
  if (lstatSync(userData).isSymbolicLink()) throw new Error("UNSAFE_DATA_PATH");
  const path = join(userData, WORKSPACE_LOCK);
  const nonce = randomUUID();
  let descriptor: number;
  try { descriptor = openSync(path, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("WORKSPACE_BUSY", { cause: error });
    throw error;
  }
  try { writeFileSync(descriptor, JSON.stringify({ owner, pid: process.pid, nonce }), "utf8"); }
  catch (error) { closeSync(descriptor); unlinkSync(path); throw error; }
  closeSync(descriptor);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Do not remove a lease belonging to another process, including after manual recovery.
    if (existsSync(path) && !lstatSync(path).isSymbolicLink()) {
      try { if (JSON.parse(readFileSync(path, "utf8")).nonce === nonce) unlinkSync(path); }
      catch { /* Leave an ambiguous lease in place. */ }
    }
  };
}
