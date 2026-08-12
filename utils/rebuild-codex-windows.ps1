param(
  [switch]$Apply,
  [switch]$Full,
  [string]$CodexHome = "",
  [string]$BundledMarketplaceSource = ""
)

$ErrorActionPreference = "Stop"

function Write-Step($Message) {
  Write-Host ""
  Write-Host "== $Message =="
}

function Convert-ToSafeName($Path) {
  return ($Path -replace '^[A-Za-z]:', '' -replace '^[\\\/]+', '' -replace '[\\\/:\?\*"<>\|]+', '__')
}

function Get-CodexHome {
  if ($CodexHome) {
    return [System.IO.Path]::GetFullPath($CodexHome)
  }
  if ($env:CODEX_HOME) {
    return [System.IO.Path]::GetFullPath($env:CODEX_HOME)
  }
  if (-not $env:USERPROFILE) {
    throw "USERPROFILE is not set. Pass -CodexHome explicitly."
  }
  return [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE ".codex"))
}

function Find-BundledMarketplaceSource {
  if ($BundledMarketplaceSource) {
    $explicit = [System.IO.Path]::GetFullPath($BundledMarketplaceSource)
    if (Test-Path -LiteralPath (Join-Path $explicit ".agents\plugins\marketplace.json")) {
      return $explicit
    }
    throw "Bundled marketplace source does not contain .agents\plugins\marketplace.json: $explicit"
  }

  $windowsApps = Join-Path $env:ProgramFiles "WindowsApps"
  if (-not (Test-Path -LiteralPath $windowsApps)) {
    throw "WindowsApps directory was not found: $windowsApps"
  }

  $candidates = Get-ChildItem -LiteralPath $windowsApps -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "OpenAI.Codex_*" } |
    Sort-Object LastWriteTime -Descending

  foreach ($candidate in $candidates) {
    $source = Join-Path $candidate.FullName "app\resources\plugins\openai-bundled"
    $manifest = Join-Path $source ".agents\plugins\marketplace.json"
    if (Test-Path -LiteralPath $manifest) {
      return $source
    }
  }

  throw "Could not find the Codex app bundled marketplace under $windowsApps."
}

function Read-Marketplace($SourceDir) {
  $manifest = Join-Path $SourceDir ".agents\plugins\marketplace.json"
  $json = Get-Content -LiteralPath $manifest -Encoding utf8 -Raw | ConvertFrom-Json
  $pluginCount = @($json.plugins).Count
  if (-not $json.name -or $pluginCount -lt 1) {
    throw "Invalid marketplace manifest: $manifest"
  }
  return [PSCustomObject]@{
    Path = $manifest
    Name = $json.name
    PluginCount = $pluginCount
    PluginNames = (@($json.plugins | ForEach-Object { $_.name }) -join ", ")
  }
}

function Move-ToBackup($Path, $BackupRoot, $Root) {
  if (-not (Test-Path -LiteralPath $Path)) {
    Write-Host "missing: $Path"
    return
  }

  $relative = $Path
  if ($Path.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
    $relative = $Path.Substring($Root.Length).TrimStart("\", "/")
  }
  $safeName = Convert-ToSafeName $relative
  $destination = Join-Path $BackupRoot $safeName
  $suffix = 1
  while (Test-Path -LiteralPath $destination) {
    $destination = Join-Path $BackupRoot "$safeName.$suffix"
    $suffix += 1
  }

  if ($Apply) {
    New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
    Move-Item -LiteralPath $Path -Destination $destination -Force
    Write-Host "moved: $Path -> $destination"
  } else {
    Write-Host "would move: $Path -> $destination"
  }
}

function Count-Items($Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return [PSCustomObject]@{ Exists = $false; Items = 0; Files = 0; Bytes = 0 }
  }
  $items = @(Get-ChildItem -LiteralPath $Path -Force -Recurse -ErrorAction SilentlyContinue)
  $files = @($items | Where-Object { -not $_.PSIsContainer })
  $bytes = ($files | Measure-Object Length -Sum).Sum
  return [PSCustomObject]@{ Exists = $true; Items = $items.Count; Files = $files.Count; Bytes = [int64]$bytes }
}

if ($PSVersionTable.PSEdition -ne "Desktop" -and $PSVersionTable.Platform -and $PSVersionTable.Platform -ne "Win32NT") {
  throw "This repair script is intended for native Windows PowerShell."
}

$codexRoot = Get-CodexHome
$sourceRoot = Find-BundledMarketplaceSource
$sourceInfo = Read-Marketplace $sourceRoot
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $codexRoot ".repair-backups\codex-rebuild-$timestamp"

$bundledRoot = Join-Path $codexRoot ".tmp\bundled-marketplaces"
$bundledTarget = Join-Path $bundledRoot "openai-bundled"
$targetManifest = Join-Path $bundledTarget ".agents\plugins\marketplace.json"

$derivedPaths = @(
  (Join-Path $codexRoot ".tmp\bundled-marketplaces"),
  (Join-Path $codexRoot ".tmp\marketplaces"),
  (Join-Path $codexRoot ".tmp\plugins.sha"),
  (Join-Path $codexRoot ".tmp\plugins.sync.lock"),
  (Join-Path $codexRoot "cache\remote_plugin_catalog"),
  (Join-Path $codexRoot "cache\codex_app_directory"),
  (Join-Path $codexRoot "cache\codex_apps_server_info"),
  (Join-Path $codexRoot "cache\codex_apps_tools"),
  (Join-Path $codexRoot "plugins\.remote-plugin-install-staging")
)

if ($Full) {
  $derivedPaths += @(
    (Join-Path $codexRoot ".tmp\plugins"),
    (Join-Path $codexRoot "plugins\cache")
  )
}

Write-Step "Codex paths"
Write-Host "Codex home: $codexRoot"
Write-Host "Bundled source: $sourceRoot"
Write-Host "Backup root: $backupRoot"
Write-Host "Mode: $(if ($Apply) { "apply" } else { "dry run" })"
Write-Host "Full cache reset: $([bool]$Full)"

Write-Step "Bundled marketplace source"
Write-Host "name: $($sourceInfo.Name)"
Write-Host "plugins: $($sourceInfo.PluginCount) [$($sourceInfo.PluginNames)]"
Write-Host "manifest: $($sourceInfo.Path)"

Write-Step "Current state"
foreach ($path in @($bundledTarget, (Join-Path $codexRoot ".tmp\plugins"), (Join-Path $codexRoot "plugins\cache"))) {
  $count = Count-Items $path
  Write-Host "$path"
  Write-Host "  exists=$($count.Exists) items=$($count.Items) files=$($count.Files) bytes=$($count.Bytes)"
}

Write-Step "Move generated state to backup"
foreach ($path in $derivedPaths) {
  Move-ToBackup $path $backupRoot $codexRoot
}

Write-Step "Restore bundled marketplace"
if ($Apply) {
  New-Item -ItemType Directory -Force -Path $bundledRoot | Out-Null
  Copy-Item -LiteralPath $sourceRoot -Destination $bundledTarget -Recurse -Force
  $targetInfo = Read-Marketplace $bundledTarget
  Write-Host "restored: $targetManifest"
  Write-Host "plugins: $($targetInfo.PluginCount) [$($targetInfo.PluginNames)]"
} else {
  Write-Host "would copy: $sourceRoot -> $bundledTarget"
}

Write-Step "Next step"
if ($Apply) {
  Write-Host "Restart Codex after this script finishes so it reindexes marketplaces and plugin caches."
  Write-Host "If plugin discovery is still stale, run this script again with -Full."
} else {
  Write-Host "Dry run only. Re-run with -Apply to repair the local Codex marketplace state."
  Write-Host "Use -Full only when installed plugin bundles also need to be regenerated."
}
