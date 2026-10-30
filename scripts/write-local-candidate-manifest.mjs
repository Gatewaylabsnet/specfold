import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

// Run from the repository root, after building and packaging without source edits in between.
const candidate = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Provide the candidate directory.");
const root = process.cwd(), asar = createRequire(import.meta.url)("@electron/asar");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const archive = join(candidate, "win-unpacked/resources/app.asar");
const sourcePackage = JSON.parse(await readFile("apps/desktop/package.json", "utf8"));
const packedPackage = JSON.parse(asar.extractFile(archive, "package.json").toString("utf8"));
if (packedPackage.version !== sourcePackage.version) throw new Error("Candidate version differs from source.");
let compiledFiles = 0;
async function verifyCompiled(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await verifyCompiled(file);
    else if (entry.isFile()) {
      const packedPath = relative(resolve("apps/desktop"), file);
      if (sha(await readFile(file)) !== sha(asar.extractFile(archive, packedPath))) throw new Error(`Compiled artifact differs: ${packedPath}`);
      compiledFiles++;
    }
  }
}
await verifyCompiled(resolve("apps/desktop/out"));
if (sha(await readFile("packages/agent/dist/desktop.cjs")) !== sha(await readFile(join(candidate, "win-unpacked/resources/agent.cjs")))) throw new Error("Bundled helper differs from current build.");
const files = execFileSync("git", ["-c", "core.excludesFile=", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root }).toString("utf8").split("\0").filter(Boolean).sort();
const tree = createHash("sha256");
for (const file of files) {
  if (!(await lstat(file)).isFile()) throw new Error("Source fingerprint requires ordinary files.");
  tree.update(file.replaceAll("\\", "/")).update("\0").update(await readFile(file)).update("\0");
}
const hashes = {};
const installers = (await readdir(candidate)).filter((file) => file === `Specfold-${sourcePackage.version}-x64.exe`);
for (const file of ["win-unpacked/Specfold.exe", "win-unpacked/resources/app.asar", "win-unpacked/resources/agent.cjs", ...installers]) hashes[file] = sha(await readFile(join(candidate, file)));
const dirty = !!execFileSync("git", ["-c", "core.excludesFile=", "status", "--porcelain"], { cwd: root }).toString().trim();
const manifest = { kind: "release-candidate", version: sourcePackage.version, dirty,
  baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root }).toString().trim(),
  gitTree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root }).toString().trim(),
  sourceContentSha256: tree.digest("hex"), sourceFiles: files.length, verifiedCompiledFiles: compiledFiles,
  createdAt: new Date().toISOString(), hashes,
  limits: [dirty ? "Uncommitted working-tree candidate" : "Exact committed source; publication status is recorded by GitHub Releases", "Unsigned Windows candidate; native installer registry/elevation lifecycle not exercised", "Source digest covers tracked and untracked non-ignored files; excludes dependencies and generated builds"] };
await writeFile(join(candidate, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(join(candidate, "Start-Isolated-Candidate.cmd"), '@echo off\r\nsetlocal\r\nset "SPECFOLD_E2E_USER_DATA_PATH=%~dp0test-profile"\r\nif not exist "%SPECFOLD_E2E_USER_DATA_PATH%" mkdir "%SPECFOLD_E2E_USER_DATA_PATH%"\r\nstart "" "%~dp0win-unpacked\\Specfold.exe"\r\nendlocal\r\n');
await writeFile(join(candidate, "README.txt"), `Specfold ${sourcePackage.version} local unpublished, UNSIGNED update candidate\n\nThe NSIS installer, when present, retains the existing Specfold product name, AppId and user-data location. It is intended to update the existing installation, not create a second permanent app. Back up existing data before installing. Do not bypass Windows security warnings or elevation requirements. No certificate was created and production installation has not been changed by this preparation.\n\nRollback requires closing Specfold, restoring the pre-update backup/snapshot and using the verified 1.11.0 runtime. Older workflow validators cannot interpret new rule definitions. Snapshot restoration does not preserve edits made after that snapshot. See docs/LOCAL_UPDATE_CANDIDATE.md in the source checkout.\n\nStart-Isolated-Candidate.cmd and win-unpacked are QA assets only. The launcher uses a separate empty test-profile beside this file. Do not share test-profile after adding personal data. Keep the entire win-unpacked directory together.\n\nmanifest.json records the source and package hashes. Installer registry/elevation behavior, portable launcher and macOS/Linux UI are not validated by runtime profile tests.\n`);
process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
