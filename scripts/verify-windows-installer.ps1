[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$CandidateInstaller,
  [ValidateSet('currentUser', 'allUsers')][string]$Scope = 'currentUser'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# This script intentionally refuses local machines and self-hosted runners.
function Assert-DisposableRunner {
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:ImageOS -notlike 'win*' -or $env:SPECFOLD_INSTALLER_QA -ne '1') {
  throw 'Real install/upgrade/rollback QA is allowed only on disposable GitHub-hosted Windows runners.'
}
}
Assert-DisposableRunner
$repo = Split-Path $PSScriptRoot -Parent
$version = (Get-Content "$repo/package.json" -Raw | ConvertFrom-Json).version
$candidate = (Resolve-Path $CandidateInstaller).Path
if ((Split-Path $candidate -Leaf) -ne "Specfold-$version-x64.exe") { throw 'Unexpected candidate installer name' }
$baselineVersion = '1.11.0'
$guid = '836d1068-ee73-544e-8774-8b0d0e92cf99'
$root = Join-Path $env:RUNNER_TEMP "specfold-installer-$Scope-$([guid]::NewGuid())"
New-Item -ItemType Directory $root | Out-Null
# Exercise the actual default profile, never an E2E override. Only a clean,
# disposable hosted account is eligible for this test.
$roaming = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
if (-not $roaming -or [IO.Path]::GetFullPath($env:APPDATA) -ne [IO.Path]::GetFullPath($roaming)) { throw 'Unexpected runner roaming profile root' }
$expectedProfile = [IO.Path]::GetFullPath((Join-Path $roaming 'Specfold'))
$profile = $expectedProfile
if (Test-Path -LiteralPath $profile) { throw 'Runner is not clean: default Specfold profile already exists' }
$profileWasAbsent = $true
Remove-Item Env:SPECFOLD_E2E_USER_DATA_PATH -ErrorAction SilentlyContinue
$snapshot = Join-Path $root 'snapshot'
$evidence = Join-Path $root 'private-fixture.json'
$report = Join-Path $repo "installer-qa-$Scope.json"
$results = [System.Collections.Generic.List[object]]::new()
function Get-Registrations {
  foreach ($hive in @('HKCU', 'HKLM')) {
    # HKCU\Software (including Uninstall) is shared across WOW64 views;
    # HKLM\Software is redirected. Preserve real HKLM duplicates, but do not
    # count the same per-user registration twice through two shared handles.
    $views = if ($hive -eq 'HKCU') {
      @([Microsoft.Win32.RegistryView]::Registry64)
    } else {
      @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)
    }
    foreach ($view in $views) {
      $hiveEnum = if ($hive -eq 'HKCU') { [Microsoft.Win32.RegistryHive]::CurrentUser } else { [Microsoft.Win32.RegistryHive]::LocalMachine }
      $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hiveEnum, $view)
      try {
        $key = $base.OpenSubKey("Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid")
        if ($key) {
          try {
            $installKey = $base.OpenSubKey("Software\$guid")
            if (-not $installKey) { throw 'Installer discovery registry key missing' }
            try { [pscustomobject]@{ Hive = $hive; View = "$view"; Identity = $guid; Version = $key.GetValue('DisplayVersion'); Path = $installKey.GetValue('InstallLocation'); Uninstall = $key.GetValue('UninstallString') } }
            finally { $installKey.Dispose() }
          }
          finally { $key.Dispose() }
        }
      } finally { $base.Dispose() }
    }
  }
}
function Test-PEVersion([string]$Actual, [string]$Expected) {
  # Windows VERSIONINFO may expose a zero fourth component for stable semver.
  # Never normalize prereleases, accept nonzero revisions, or truncate metadata.
  return $Actual -ceq $Expected -or ($Expected -cmatch '^\d+\.\d+\.\d+$' -and $Actual -ceq "$Expected.0")
}
function Assert-Installed([string]$ExpectedVersion, [string]$ExpectedPath = '') {
  $entries = @(Get-Registrations)
  if ($entries.Count -ne 1) { throw "Expected exactly one Specfold uninstall identity; found $($entries.Count)" }
  $entry = $entries[0]
  $expectedHive = if ($Scope -eq 'allUsers') { 'HKLM' } else { 'HKCU' }
  if ($entry.Hive -ne $expectedHive -or $entry.Version -ne $ExpectedVersion) { throw "Registration mismatch: $($entry | ConvertTo-Json -Compress)" }
  $path = [IO.Path]::GetFullPath($entry.Path).TrimEnd('\')
  $expectedRoot = if ($Scope -eq 'allUsers') { $env:ProgramFiles } else { Join-Path $env:LOCALAPPDATA 'Programs' }
  if (-not $path.StartsWith("$expectedRoot\", [StringComparison]::OrdinalIgnoreCase)) { throw "Unexpected install root: $path" }
  if ($ExpectedPath -and $path -ne $ExpectedPath) { throw 'Upgrade changed installation path' }
  $exe = Join-Path $path 'Specfold.exe'
  if (-not (Test-Path $exe)) { throw 'Installed executable missing' }
  $peVersion = (Get-Item $exe).VersionInfo.ProductVersion
  if (-not (Test-PEVersion $peVersion $ExpectedVersion)) { throw "Installed PE product version mismatch: expected $ExpectedVersion (or stable .0), got $peVersion" }
  $results.Add($entry)
  return $path
}
function Invoke-Installer([string]$File, [string]$Arguments) {
  # Start-Process -Wait waits for the NSIS process tree, not merely its bootstrapper.
  # Workflow timeout provides a hard ceiling for a hung native installer.
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru -Wait -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "Installer exited with code $($process.ExitCode)" }
}
function Invoke-Probe([string]$Phase, [string]$Path, [string]$ExpectedVersion) {
  & node "$PSScriptRoot/installer-runtime-probe.mjs" $Phase (Join-Path $Path 'Specfold.exe') $profile $ExpectedVersion $evidence
  if ($LASTEXITCODE -ne 0) { throw "Installed runtime $Phase failed" }
}
if (@(Get-Registrations).Count -ne 0) { throw 'Runner is not clean: Specfold already registered' }
if ($Scope -eq 'allUsers') {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'All-users QA requires the already-elevated disposable runner; no elevation policy is changed' }
}
$headers = @{ Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
if ($env:GH_TOKEN) { $headers.Authorization = "Bearer $env:GH_TOKEN" }
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/Gatewaylabsnet/specfold/releases/tags/v$baselineVersion" -Headers $headers
if ($release.tag_name -ne "v$baselineVersion" -or $release.draft -or $release.prerelease -or -not $release.published_at) { throw 'Baseline must be the published stable v1.11.0 release' }
$assetName = "Specfold-$baselineVersion-x64.exe"
$asset = @($release.assets | Where-Object name -eq $assetName)
$sums = @($release.assets | Where-Object name -eq 'SHA256SUMS.txt')
if ($asset.Count -ne 1 -or $sums.Count -ne 1) { throw 'Baseline installer/checksum assets missing or ambiguous' }
$baseline = Join-Path $root $assetName
Invoke-WebRequest $asset[0].browser_download_url -OutFile $baseline
$checksumFile = Join-Path $root 'SHA256SUMS.txt'
Invoke-WebRequest $sums[0].browser_download_url -OutFile $checksumFile
$manifestHash = (Get-FileHash $checksumFile -Algorithm SHA256).Hash
if ((Get-Item $checksumFile).Length -ne $sums[0].size) { throw 'Baseline checksum manifest size mismatch' }
if (-not ($sums[0].PSObject.Properties.Name -contains 'digest') -or $sums[0].digest -ne "sha256:$($manifestHash.ToLowerInvariant())") { throw 'Baseline checksum manifest requires a matching GitHub SHA256 asset digest' }
$matches = @(Get-Content $checksumFile | Where-Object { $_ -match "^[a-fA-F0-9]{64}\s+\*?(?:\./)?$([regex]::Escape($assetName))$" })
if ($matches.Count -ne 1) { throw 'No unambiguous baseline SHA256 checksum' }
$expectedHash = ($matches[0] -split '\s+')[0]
$actualHash = (Get-FileHash $baseline -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash -or (Get-Item $baseline).Length -ne $asset[0].size) { throw 'Baseline asset size/hash mismatch' }
if ($asset[0].PSObject.Properties.Name -contains 'digest' -and $asset[0].digest -and $asset[0].digest -ne "sha256:$($actualHash.ToLowerInvariant())") { throw 'GitHub baseline digest mismatch' }
$success = $false
try {
  $scopeFlag = if ($Scope -eq 'allUsers') { '/allusers' } else { '/currentuser' }
  Invoke-Installer $baseline "/S $scopeFlag"
  $installedPath = Assert-Installed $baselineVersion
  Invoke-Probe 'seed' $installedPath $baselineVersion
  Copy-Item $profile $snapshot -Recurse
  # No /D or scope override: verify discovery of the existing installation.
  $beforeUpgrade = @{}
  foreach ($file in @('workspace.json', 'app-settings.json')) { $beforeUpgrade[$file] = (Get-FileHash (Join-Path $profile $file)).Hash }
  Invoke-Installer $candidate '/S'
  foreach ($file in $beforeUpgrade.Keys) {
    if ((Get-FileHash (Join-Path $profile $file)).Hash -ne $beforeUpgrade[$file]) { throw "Installer changed profile data before first candidate launch: $file" }
  }
  $null = Assert-Installed $version $installedPath
  Invoke-Probe 'upgrade' $installedPath $version
  $beforeRollback = @{}
  foreach ($file in @('workspace.json', 'app-settings.json')) { $beforeRollback[$file] = (Get-FileHash (Join-Path $profile $file)).Hash }
  Invoke-Installer $baseline '/S'
  foreach ($file in $beforeRollback.Keys) {
    if ((Get-FileHash (Join-Path $profile $file)).Hash -ne $beforeRollback[$file]) { throw "Baseline reinstall changed profile data before snapshot restore: $file" }
  }
  $null = Assert-Installed $baselineVersion $installedPath
  # Snapshot restore is deliberate; arbitrary downgrade of newer data is NOT supported by this test.
  $resolvedProfile = [IO.Path]::GetFullPath($profile)
  Assert-DisposableRunner
  if (-not $profileWasAbsent -or $resolvedProfile -ne $expectedProfile -or $resolvedProfile -ne [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)) 'Specfold'))) { throw 'Unsafe default-profile restore path' }
  if ((Get-Item -LiteralPath $resolvedProfile).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing to restore through a profile reparse point' }
  if (-not ([IO.Path]::GetFullPath($snapshot)).StartsWith("$root\", [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe snapshot path' }
  Remove-Item -LiteralPath $resolvedProfile -Recurse -Force
  Copy-Item $snapshot $profile -Recurse
  Invoke-Probe 'rollback' $installedPath $baselineVersion
  $success = $true
} finally {
  [ordered]@{
    passed = $success; scope = $Scope; baseline = $baselineVersion; candidate = $version
    baselineChecksumSHA256 = $manifestHash; baselineRelease = $release.html_url; baselineAssetId = $asset[0].id; baselineSHA256 = $actualHash
    candidateSHA256 = (Get-FileHash $candidate -Algorithm SHA256).Hash
    profileLocation = 'Normal %APPDATA%/Specfold, verified through Electron app.getPath(userData); initially absent on disposable runner'
    registrations = @($results)
    lifecycle = 'Runtime IPC saves awaited; graceful close attempted with 15-second bound, forced process-tree termination fallback is logged if needed. Does not prove graceful shutdown.'
    limitation = 'Disposable elevated hosted runner only. All-users tests existing admin-managed installs, not standard-user elevation. Snapshot rollback discards post-upgrade edits and restores synthetic data on the same Windows account/machine; not arbitrary schema downgrade or cross-machine credential recovery.'
  } | ConvertTo-Json -Depth 6 | Set-Content $report
  # Never upload the private fixture, profile, snapshot, or encrypted credential files.
}
