import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";
import { verifyReleaseVersions } from "./check-release-version.mjs";

function fixture(version = "1.11.0") {
  const root = mkdtempSync(join(tmpdir(), "specfold-version-gate-"));
  const write = (file, value) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), JSON.stringify(value));
  };
  write("package.json", { version });
  write("apps/desktop/package.json", { version, devDependencies: { "@openapi-collection-studio/core": version } });
  write("packages/agent/package.json", { version, dependencies: { "@openapi-collection-studio/core": version } });
  write("packages/core/package.json", { version });
  const lock = { version, packages: { "": { version }, "apps/desktop": { version,
    devDependencies: { "@openapi-collection-studio/core": version } }, "packages/agent": { version,
    dependencies: { "@openapi-collection-studio/core": version } }, "packages/core": { version } } };
  write("package-lock.json", lock);
  const cleanup = () => {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("specfold-version-gate-")) throw new Error("Unsafe fixture cleanup.");
    rmSync(root, { recursive: true, force: true });
  };
  return { root, write, lock, cleanup };
}

test("accepts a preparation branch or the exact matching release tag", () => {
  const f = fixture();
  try {
    assert.equal(verifyReleaseVersions(f.root, "refs/heads/preparation"), "1.11.0");
    assert.equal(verifyReleaseVersions(f.root, "refs/tags/v1.11.0"), "1.11.0");
    assert.throws(() => verifyReleaseVersions(f.root, "refs/tags/v1.10.0"), /tag does not match/);
  } finally { f.cleanup(); }
});
test("refuses mismatched app, lock or linked core dependency versions", () => {
  const f = fixture();
  try {
    f.write("apps/desktop/package.json", { version: "1.11.0-dev.1", devDependencies: { "@openapi-collection-studio/core": "1.11.0" } });
    assert.throws(() => verifyReleaseVersions(f.root), /do not match/);
    f.write("apps/desktop/package.json", { version: "1.11.0", devDependencies: { "@openapi-collection-studio/core": "1.10.0" } });
    assert.throws(() => verifyReleaseVersions(f.root), /do not match/);
    f.write("apps/desktop/package.json", { version: "1.11.0", devDependencies: { "@openapi-collection-studio/core": "1.11.0" } });
    f.lock.packages["packages/agent"].version = "1.10.0";
    f.write("package-lock.json", f.lock);
    assert.throws(() => verifyReleaseVersions(f.root), /do not match/);
  } finally { f.cleanup(); }
});
test("accepts valid prerelease tags and rejects malformed numeric identifiers", () => {
  for (const version of ["1.11.0-dev.1", "1.11.0-dev.01", "01.11.0"]) {
    const f = fixture(version);
    try {
      if (version === "1.11.0-dev.1") assert.equal(verifyReleaseVersions(f.root, `refs/tags/v${version}`), version);
      else assert.throws(() => verifyReleaseVersions(f.root), /valid SemVer/);
    } finally { f.cleanup(); }
  }
});
