import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { downloadPlan, retryable, safeErrorURL, prefetchWithRetry } from './prefetch-packaging-downloads.mjs';

test('prefetch uses official Electron and checksum-pinned Windows tool URLs', () => {
  const plan = downloadPlan('win32', '43.8.7');
  assert.equal(plan.length, 4);
  for (const task of plan) for (const url of task.urls) assert.match(url, /^https:\/\/github\.com\/(electron\/electron|electron-userland\/electron-builder-binaries)\/releases\/download\//);
  assert.ok(plan[0].urls[1].endsWith('/v43.8.7/SHASUMS256.txt'));
  for (const task of plan.slice(1)) assert.match(task.checksums[task.filenameWithExt], /^[a-f0-9]{64}$/);
  assert.deepEqual(downloadPlan('darwin', '43.8.7').map(task => task.arch), ['x64', 'arm64']);
});
test('only transient upstream failures are retried, never integrity or TLS errors', () => {
  assert.equal(retryable({ response: { statusCode: 504 } }), true);
  assert.equal(retryable({ code: 'ETIMEDOUT' }), true);
  for (const error of [{ response: { statusCode: 403 } }, { response: { statusCode: 404 } }, { code: 'CERT_HAS_EXPIRED' }, new Error('checksum mismatch')]) assert.equal(retryable(error), false);
});
test('prefetch attempts are bounded and successful caches stop retries', async () => {
  const task = downloadPlan('linux', '43.8.7')[0];
  let attempts = 0;
  const waits = [];
  const options = { wait: async delay => waits.push(delay), log: () => {} };
  const failure = Object.assign(new Error('Gateway timeout'), { response: { statusCode: 504 } });
  await assert.rejects(prefetchWithRetry(task, async () => { attempts++; throw failure; }, options), /Gateway timeout/);
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [15000, 30000]);
  attempts = 0;
  assert.equal(await prefetchWithRetry(task, async () => { attempts++; return 'verified-cache'; }, options), 'verified-cache');
  assert.equal(attempts, 1);
});
test('diagnostic URLs remove signed query strings and credentials', () => {
  assert.equal(safeErrorURL({ options: { url: 'https://user:secret@release-assets.githubusercontent.com/path?token=secret' } }), 'https://release-assets.githubusercontent.com/path');
});

test('tool pins match the locked official builder implementation', async () => {
  const source = await readFile('node_modules/app-builder-lib/out/toolsets/windows.js', 'utf8');
  const builder = JSON.parse(await readFile('node_modules/app-builder-lib/package.json', 'utf8'));
  assert.equal(builder.version, '26.15.7');
  for (const task of downloadPlan('win32', '43.8.7').slice(1)) {
    assert.ok(source.includes(task.filenameWithExt));
    assert.ok(source.includes(task.checksums[task.filenameWithExt]));
  }
});
test('packaging jobs prefetch with a hard timeout before compilation', async () => {
  for (const [workflow, jobs] of [['ci', ['packaged-e2e-windows', 'installer-upgrade-windows']], ['release', ['build']]]) {
    const parsed = YAML.parse(await readFile(`.github/workflows/${workflow}.yml`, 'utf8'));
    for (const name of jobs) {
      const steps = parsed.jobs[name].steps;
      const index = steps.findIndex(step => step.run?.includes('node scripts/prefetch-packaging-downloads.mjs'));
      assert.ok(index >= 0);
      assert.equal(steps[index]['timeout-minutes'], 12);
      assert.equal(steps[index]['continue-on-error'], undefined);
      assert.ok(steps.slice(index + 1).some(step => /package:win|matrix.package-command/.test(step.run ?? '')));
    }
  }
});
