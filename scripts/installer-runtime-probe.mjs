/* global window */
import { _electron as electron, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Invoked only by verify-windows-installer.ps1 on an ephemeral hosted runner.
if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' || process.env.SPECFOLD_INSTALLER_QA !== '1') {
  throw new Error('Installer runtime probes are restricted to disposable GitHub-hosted Windows runners.');
}
const [phase, executablePath, profile, expectedVersion, evidencePath] = process.argv.slice(2);
if (!['seed', 'upgrade', 'rollback'].includes(phase) || !evidencePath) throw new Error('Invalid installer probe arguments');
const expectedProfile = resolve(process.env.APPDATA, 'Specfold');
if (resolve(profile).toLowerCase() !== expectedProfile.toLowerCase()) throw new Error('Probe must exercise the default Specfold profile');
const launchEnvironment = { ...process.env };
delete launchEnvironment.SPECFOLD_E2E_USER_DATA_PATH;
let app;
try {
  app = await electron.launch({ executablePath, args: ['--disable-gpu'], env: launchEnvironment });
  const page = await app.firstWindow();
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const actualProfile = await app.evaluate(({ app: mainApp }) => mainApp.getPath('userData'));
  expect(resolve(actualProfile).toLowerCase()).toBe(expectedProfile.toLowerCase());
  expect(await page.evaluate(async () => (await window.studio.getAppInfo()).version)).toBe(expectedVersion);
  if (phase === 'seed') {
    const secret = randomBytes(24).toString('hex');
    await page.evaluate(async (value) => {
      const current = await window.studio.loadWorkspace();
      current.workspace.name = 'Installer preserved workspace';
      current.workspace.collections = [{ id: 'installer-collection', name: 'Preserved API', folders: [], requests: [{
        id: 'installer-request', name: 'Preserved request', method: 'GET', url: 'http://127.0.0.1:9/preserved',
        queryParams: [], pathParams: [], headers: [], body: { mode: 'none' }, auth: { type: 'none' }, responseExamples: []
      }] }];
      current.workspace.environments[0].variables.push({ id: 'installer-secret', name: 'installerToken', value, secret: true, enabled: true });
      await window.studio.saveWorkspace(current.workspace, current.generation);
      const settings = await window.studio.loadSettings();
      await window.studio.saveSettings({ ...settings, theme: 'dark', requestTimeoutMs: 8123, agentEnabled: false, agentNetworkEnabled: false });
    }, secret);
    const before = await page.evaluate(() => window.studio.loadWorkspace());
    expect(before.workspace.environments[0].variables.find(item => item.id === 'installer-secret')?.value).toBe(secret);
    await writeFile(evidencePath, JSON.stringify({ secret, workspace: before.workspace }));
  } else {
    const before = JSON.parse(await readFile(evidencePath, 'utf8'));
    const actual = await page.evaluate(() => window.studio.loadWorkspace());
    expect(actual.recovered).toBe(false);
    expect(actual.workspace.collections).toEqual(before.workspace.collections);
    expect(actual.workspace.environments).toEqual(before.workspace.environments);
    expect(actual.workspace.name).toBe(before.workspace.name);
    const settings = await page.evaluate(() => window.studio.loadSettings());
    expect(settings.theme).toBe('dark');
    expect(settings.requestTimeoutMs).toBe(8123);
    expect(settings.agentEnabled).toBe(false);
    expect(settings.agentNetworkEnabled).toBe(false);
    if (phase === 'upgrade') {
      // Prove rollback restores a snapshot, rather than claiming arbitrary down-migration.
      await page.evaluate(async () => {
        const current = await window.studio.loadWorkspace();
        current.workspace.name = 'Post-upgrade changes intentionally discarded by snapshot rollback';
        await window.studio.saveWorkspace(current.workspace, current.generation);
      });
    }
  }
  const { secret } = JSON.parse(await readFile(evidencePath, 'utf8'));
  const disk = await readFile(join(profile, 'workspace.json'), 'utf8');
  expect(disk.includes(secret)).toBe(false);
  expect(disk).toContain('enc:v1:');
  await expect(page.locator('.save-status')).toHaveText('Saved');
} finally {
  if (app) {
    const child = app.process();
    if (child.exitCode === null) {
      let timer;
      try {
        await Promise.race([
          app.close(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Graceful quit timed out')), 15000); })
        ]);
      } catch (error) {
        if (child.exitCode === null) {
          // Electron 43 may retain renderer/GPU children after quit. All profile
          // writes were awaited above. Report forced shutdown; do not claim graceful-quit QA.
          console.warn(`Graceful close unavailable; forcing saved probe process tree: ${error.message}`);
          const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
          await promisify(execFile)('taskkill', ['/pid', String(child.pid), '/t', '/f']);
          await Promise.race([exited, new Promise((_, reject) => {
            const waitTimer = setTimeout(() => reject(new Error('Probe process did not exit')), 15000);
            waitTimer.unref();
          })]);
        }
      } finally {
        clearTimeout(timer);
      }
    }
  }
}
console.log(`Installed runtime ${phase} verified (${expectedVersion}).`);
