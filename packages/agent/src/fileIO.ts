import { lstat, open } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { AgentError } from "./errors";

export async function readBoundedFile(path: string, limit: number): Promise<string> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new AgentError("UNSAFE_DATA_PATH");
  if (info.size > limit) throw new AgentError("INPUT_TOO_LARGE");
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat();
    if (opened.ino !== info.ino || opened.dev !== info.dev) throw new AgentError("UNSAFE_DATA_PATH");
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, limit + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limit) throw new AgentError("INPUT_TOO_LARGE");
      chunks.push(buffer.subarray(0, bytesRead));
    }
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)); }
    catch { throw new AgentError("INVALID_ENCODING"); }
  } finally { await handle.close(); }
}
