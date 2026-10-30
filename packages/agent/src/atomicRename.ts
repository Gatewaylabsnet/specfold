import { rename } from "node:fs/promises";

interface RenameDependencies {
  platform?: NodeJS.Platform;
  replace?: (source: string, target: string) => Promise<void>;
  wait?: (milliseconds: number) => Promise<void>;
}
const delays = [20, 40, 80, 160, 320];

/** Windows readers/AV can briefly lock a destination. Never unlink it or relax permissions. */
export async function replaceFileAtomically(source: string, target: string, dependencies: RenameDependencies = {}): Promise<void> {
  const platform = dependencies.platform ?? process.platform, replace = dependencies.replace ?? rename;
  const wait = dependencies.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  for (let attempt = 0; ; attempt++) {
    try { await replace(source, target); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (platform !== "win32" || !["EPERM", "EBUSY"].includes(code ?? "") || attempt >= delays.length) throw error;
      await wait(delays[attempt]);
    }
  }
}
