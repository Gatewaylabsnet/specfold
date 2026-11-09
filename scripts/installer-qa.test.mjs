import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';

const cleanEnvironment = { ...process.env, GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'self-hosted', SPECFOLD_INSTALLER_QA: '0' };
test('installed runtime probe refuses a local/self-hosted environment before launch', () => {
  const result = spawnSync(process.execPath, ['scripts/installer-runtime-probe.mjs', 'seed', 'never-run.exe'], { env: cleanEnvironment, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /restricted to disposable GitHub-hosted Windows runners/);
});
test('installer orchestration refuses a local/self-hosted environment before resolving installer', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync('pwsh', ['-NoProfile', '-File', 'scripts/verify-windows-installer.ps1', '-CandidateInstaller', 'never-run.exe'], { env: cleanEnvironment, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /allowed only on disposable GitHub-hosted Windows runners/);
});
test('CI and release run both real installer scopes without continue-on-error', async () => {
  for (const name of ['ci', 'release']) {
    const workflow = YAML.parse(await readFile(`.github/workflows/${name}.yml`, 'utf8'));
    const job = workflow.jobs['installer-upgrade-windows'];
    assert.equal(job['runs-on'], 'windows-latest');
    assert.deepEqual(job.strategy.matrix.scope, ['currentUser', 'allUsers']);
    assert.equal(job.env.SPECFOLD_INSTALLER_QA, '1');
    assert.equal(job['continue-on-error'], undefined);
    assert.ok(job['timeout-minutes'] <= 30);
    assert.ok(job.steps.some(step => step.run?.includes('verify-windows-installer.ps1')));
    if (name === 'release') {
      assert.ok(workflow.jobs['verify-packages'].needs.includes('installer-upgrade-windows'));
      assert.equal(job.needs, 'build');
      assert.ok(workflow.jobs['verify-packages'].steps.some(step => step.uses === 'actions/download-artifact@v4' && step.with.pattern === 'specfold-*'));
      assert.ok(workflow.jobs['verify-packages'].steps.some(step => step.run?.includes('-eq 8')));
      assert.ok(job.steps.some(step => step.uses === 'actions/download-artifact@v4' && step.with.name === 'specfold-windows'));
    }
  }
});

test('installer QA uses the real default profile and guards snapshot restoration', async () => {
  const script = await readFile('scripts/verify-windows-installer.ps1', 'utf8');
  const probe = await readFile('scripts/installer-runtime-probe.mjs', 'utf8');
  assert.match(script, /default Specfold profile already exists/);
  assert.match(script, /\$profile = \$expectedProfile/);
  assert.match(script, /Assert-DisposableRunner\r?\n {2}if \(-not \$profileWasAbsent/);
  assert.match(script, /\$resolvedProfile -ne \$expectedProfile/);
  assert.match(script, /ReparsePoint/);
  assert.match(probe, /delete launchEnvironment\.SPECFOLD_E2E_USER_DATA_PATH/);
  assert.match(probe, /mainApp\.getPath\('userData'\)/);
  assert.match(probe, /toBe\(expectedProfile\.toLowerCase\(\)\)/);
});

test('registry enumeration reads shared HKCU once and both redirected HKLM views', async () => {
  const script = await readFile('scripts/verify-windows-installer.ps1', 'utf8');
  assert.match(script, /\$views = if \(\$hive -eq 'HKCU'\) \{\s+@\(\[Microsoft\.Win32\.RegistryView\]::Registry64\)\s+\} else \{\s+@\(\[Microsoft\.Win32\.RegistryView\]::Registry64, \[Microsoft\.Win32\.RegistryView\]::Registry32\)\s+\}/);
  assert.match(script, /foreach \(\$view in \$views\)/);
  assert.match(script, /\$entries\.Count -ne 1/);
  assert.doesNotMatch(script, /Select-Object[^\n]*-Unique|Sort-Object[^\n]*-Unique/);
});

test('Windows PE version accepts only exact semver or stable zero fourth component', { skip: process.platform !== 'win32' }, () => {
  // Extract only this pure function; never execute installer orchestration.
  const command = `
    $ErrorActionPreference = 'Stop'
    $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'scripts/verify-windows-installer.ps1'), [ref]$null, [ref]$null)
    $fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-PEVersion' }, $false)
    . ([scriptblock]::Create($fn.Extent.Text))
    @(
      (Test-PEVersion '1.11.0' '1.11.0'),
      (Test-PEVersion '1.11.0.0' '1.11.0'),
      (Test-PEVersion '1.12.0.0' '1.12.0'),
      (Test-PEVersion '1.12.0-dev.1' '1.12.0-dev.1'),
      (Test-PEVersion '1.11.0.1' '1.11.0'),
      (Test-PEVersion '1.11.0.0.0' '1.11.0'),
      (Test-PEVersion '1.12.0' '1.11.0'),
      (Test-PEVersion '1.12.0-dev.1.0' '1.12.0-dev.1'),
      (Test-PEVersion '1.12.0.0' '1.12.0-dev.1'),
      (Test-PEVersion '1.11.0.0 ' '1.11.0')
    ) | ConvertTo-Json -Compress
  `;
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [true, true, true, true, false, false, false, false, false, false]);
});

test('candidate installed Electron is checked against the source build manifest', async () => {
  const probe = await readFile('scripts/installer-runtime-probe.mjs', 'utf8');
  assert.match(probe, /if \(phase === 'upgrade'\) \{[\s\S]*?new URL\('\.\.\/apps\/desktop\/package\.json', import\.meta\.url\)/);
  assert.match(probe, /expectedElectron = desktopManifest\.build\.electronVersion/);
  assert.match(probe, /desktopManifest\.devDependencies\.electron\)\.toBe\(expectedElectron\)/);
  assert.match(probe, /app\.evaluate\(\(\) => process\.versions\.electron\)/);
  assert.match(probe, /expect\(actualElectron\)\.toBe\(expectedElectron\)/);
});
