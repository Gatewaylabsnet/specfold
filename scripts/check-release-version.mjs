import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const readMetadata = (root, file) => {
  try { return JSON.parse(readFileSync(resolve(root, file), "utf8")); }
  catch (error) { throw new Error(`Invalid release metadata: ${file}`, { cause: error }); }
};

/** Read-only guard. A tag never grants permission to publish mismatched packages. */
export function verifyReleaseVersions(root, ref = "") {
  const version = readMetadata(root, "package.json").version;
  const parsed = typeof version === "string" && version.length <= 256 ? versionPattern.exec(version) : undefined;
  if (!parsed || parsed[4]?.split(".").some((part) => /^[0-9]+$/.test(part) && part.length > 1 && part.startsWith("0"))) {
    throw new Error("Root release version is not valid SemVer.");
  }
  const desktop = readMetadata(root, "apps/desktop/package.json");
  const agent = readMetadata(root, "packages/agent/package.json");
  const core = readMetadata(root, "packages/core/package.json");
  const lock = readMetadata(root, "package-lock.json");
  if ([desktop.version, agent.version, core.version, lock.version,
    ...["", "apps/desktop", "packages/agent", "packages/core"].map((key) => lock.packages?.[key]?.version),
    desktop.devDependencies?.["@openapi-collection-studio/core"], agent.dependencies?.["@openapi-collection-studio/core"],
    lock.packages?.["apps/desktop"]?.devDependencies?.["@openapi-collection-studio/core"],
    lock.packages?.["packages/agent"]?.dependencies?.["@openapi-collection-studio/core"]].some((value) => value !== version)) {
    throw new Error("Release manifests, lockfile or workspace dependency versions do not match.");
  }
  if (ref.startsWith("refs/tags/") && ref !== `refs/tags/v${version}`) {
    throw new Error("Release tag does not match the declared package version.");
  }
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const version = verifyReleaseVersions(fileURLToPath(new URL("../", import.meta.url)), process.env.GITHUB_REF);
    process.stdout.write(`Release version metadata matches: ${version}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Release version verification failed."}\n`);
    process.exitCode = 1;
  }
}
