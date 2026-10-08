import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Same-directory replace, shared with the desktop's existing persistence service. */
export async function atomicWriteFile(path: string, content: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(tempPath, content, { encoding: "utf8", mode });
    await rename(tempPath, path);
    await chmod(path, mode).catch(() => undefined);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}
