import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const binaries = 'https://github.com/electron-userland/electron-builder-binaries/releases/download';
// Official checksums from the locked app-builder-lib 26.15.7 toolsets/windows.js.
const windowsTools = [
  ['nsis-3.0.4.1', 'nsis-3.0.4.1.7z', '9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa'],
  ['nsis-resources-3.4.1', 'nsis-resources-3.4.1.7z', '593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103'],
  ['winCodeSign-2.6.0', 'winCodeSign-2.6.0.7z', 'cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4'],
];
export function downloadPlan(platform, version) {
  if (!['win32', 'darwin', 'linux'].includes(platform) || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Unsupported prefetch platform/version');
  const arches = platform === 'darwin' ? ['x64', 'arm64'] : ['x64'];
  const tasks = arches.map(arch => ({
    kind: 'electron', name: `electron-${version}-${platform}-${arch}`, version, platformName: platform, arch,
    urls: [`https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-${platform}-${arch}.zip`,
      `https://github.com/electron/electron/releases/download/v${version}/SHASUMS256.txt`],
  }));
  if (platform === 'win32') for (const [releaseName, filenameWithExt, hash] of windowsTools) {
    tasks.push({ kind: 'tool', name: releaseName, releaseName, filenameWithExt, checksums: { [filenameWithExt]: hash }, urls: [`${binaries}/${releaseName}/${filenameWithExt}`] });
  }
  return tasks;
}
export function retryable(error) {
  const status = error?.response?.statusCode;
  return (status >= 500 && status <= 599) || ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'EPIPE'].includes(error?.code);
}
export function safeErrorURL(error) {
  const raw = error?.options?.url ?? error?.request?.requestUrl ?? error?.response?.url;
  try { const url = new URL(raw); return `${url.origin}${url.pathname}`; } catch { return 'not exposed by downloader; see official URLs above'; }
}
export async function prefetchWithRetry(task, download, { wait = sleep, log = console.log } = {}) {
  // The official downloader already has short retries. Two additional delayed
  // attempts are capped by the workflow's 12-minute prefetch timeout.
  for (let attempt = 1; attempt <= 3; attempt++) {
    log(`Prefetch ${task.name}, attempt ${attempt}/3: ${task.urls.join(' ; ')}`);
    try { const result = await download(task); log(`Verified and cached ${task.name}`); return result; }
    catch (error) {
      log(`Prefetch failed: artifact=${task.name} status=${error?.response?.statusCode ?? 'none'} code=${error?.code ?? 'none'} request=${safeErrorURL(error)}`);
      if (attempt === 3 || !retryable(error)) throw error;
      await wait(attempt * 15000);
    }
  }
}
async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') throw new Error('Packaging prefetch runs only on disposable GitHub-hosted runners');
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS verification must remain enabled');
  for (const [key, value] of Object.entries(process.env)) {
    if (value && /electron/i.test(key) && /mirror|custom|download_override|allow_http|disable_checksums|nsis_dir|resources_dir|electron_dist/i.test(key)) throw new Error(`Unsupported download override: ${key}`);
  }
  const manifest = JSON.parse(await readFile(new URL('../apps/desktop/package.json', import.meta.url), 'utf8'));
  if (manifest.build.electronDownload || manifest.build.electronDist || manifest.build.nsis?.customNsisBinary || manifest.build.nsis?.customNsisResources || manifest.build.toolsets) throw new Error('Custom toolsets/download configuration requires a prefetch review');
  const builder = JSON.parse(await readFile(new URL('../node_modules/app-builder-lib/package.json', import.meta.url), 'utf8'));
  if (builder.version !== '26.15.7') throw new Error('Review the official toolset pins when updating electron-builder');
  const { downloadElectronArtifactZip, downloadBuilderToolset } = await import('app-builder-lib/out/util/electronGet.js');
  const tasks = downloadPlan(process.platform, manifest.build.electronVersion);
  for (const task of tasks) await prefetchWithRetry(task, item => item.kind === 'electron'
    ? downloadElectronArtifactZip({ artifactName: 'electron', version: item.version, platformName: item.platformName, arch: item.arch })
    : downloadBuilderToolset({ releaseName: item.releaseName, filenameWithExt: item.filenameWithExt, checksums: item.checksums }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch(error => {
    // Avoid dumping a request object containing CDN signed query parameters.
    console.error(`Packaging prefetch failed: ${error.name}; status=${error?.response?.statusCode ?? 'none'} code=${error?.code ?? 'none'}. No package validation gates were bypassed.`);
    process.exitCode = 1;
  });
}
