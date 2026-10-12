import { build } from "esbuild";
import { fileURLToPath } from "node:url";
await build({
  entryPoints: ["src/index.ts"], bundle: true, platform: "node", format: "esm",
  target: "node20", outfile: "dist/index.js", banner: { js: "#!/usr/bin/env node" },
  alias: { "@openapi-collection-studio/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)) },
  external: ["@modelcontextprotocol/sdk/*", "zod", "yaml"], sourcemap: true
});
await build({
  entryPoints: ["src/desktopEntry.ts"], bundle: true, platform: "node", format: "cjs",
  target: "node20", outfile: "dist/desktop.cjs",
  alias: { "@openapi-collection-studio/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)) }
});
