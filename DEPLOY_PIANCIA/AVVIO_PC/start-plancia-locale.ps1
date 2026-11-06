# Start full Atlas stack on this PC only (UI + API + local brain).
# Completely separate from Render — no proxy, no shared data, no API link.
# Lives in DEPLOY_PIANCIA/AVVIO_PC (or PROGETTO_LOCALE); finds repo root by walking up.
$ErrorActionPreference = "Stop"

function Wait-Exit([int]$Code, [string]$Message) {
  Write-Host ""
  Write-Host "ERROR: $Message" -ForegroundColor Red
  Write-Host "Exit code: $Code"
  Write-Host ""
  Write-Host "Press Enter to close this window..." -ForegroundColor Yellow
  try { [void][System.Console]::ReadLine() } catch { Start-Sleep -Seconds 30 }
  exit $Code
}

function Find-RepoRoot([string]$StartDir) {
  $dir = (Resolve-Path $StartDir).Path
  for ($i = 0; $i -lt 6; $i++) {
    $pkg = Join-Path $dir "backend\package.json"
    if (Test-Path $pkg) { return $dir }
    $parent = Split-Path -Parent $dir
    if (-not $parent -or $parent -eq $dir) { break }
    $dir = $parent
  }
  return $null
}

try {
  $ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  $Root = Find-RepoRoot $ScriptDir
  if (-not $Root) {
    Wait-Exit 1 @"
Could not find backend\package.json above this folder.

Keep this AVVIO_PC folder inside the full repo unzip/clone:
  ops-Commerce-Dashboard\
    backend\package.json
    DEPLOY_PIANCIA\AVVIO_PC\start-plancia-locale.bat

Do not run the .bat from a copy of AVVIO_PC alone — the rest of the project must sit next to it.
"@
  }

  $Backend = Join-Path $Root "backend"
  $Pkg = Join-Path $Backend "package.json"

  Write-Host "Script dir : $ScriptDir"
  Write-Host "Repo root  : $Root"
  Write-Host "Backend    : $Backend"
  Write-Host ""

  if (-not (Test-Path $Pkg)) {
    Wait-Exit 2 "backend\package.json not found at $Pkg"
  }

  $node = Get-Command node -ErrorAction SilentlyContinue
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $node) {
    Wait-Exit 3 "Node.js not found on PATH. Install Node 20+ from https://nodejs.org then reopen this .bat."
  }
  if (-not $npm) {
    Wait-Exit 4 "npm not found on PATH (comes with Node.js). Reinstall Node from https://nodejs.org and retry."
  }

  Write-Host "Node: $($node.Source)"
  Write-Host "npm : $($npm.Source)"
  try {
    Write-Host "Node version: $(node -v)"
    Write-Host "npm  version: $(npm -v)"
  } catch {}
  Write-Host ""

  $nodeModules = Join-Path $Backend "node_modules"
  if (-not (Test-Path $nodeModules)) {
    Write-Host "node_modules missing — running first-time install (npm ci --ignore-scripts)..." -ForegroundColor Cyan
    Set-Location $Backend
    npm ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) {
      Write-Host "npm ci failed; trying npm install --ignore-scripts..." -ForegroundColor Yellow
      npm install --ignore-scripts
      if ($LASTEXITCODE -ne 0) {
        Wait-Exit 5 "Dependency install failed in $Backend. Check network / Node version (>=20)."
      }
    }
  }

  $envFile = Join-Path $Backend ".env"
  $envExampleCandidates = @(
    (Join-Path $ScriptDir "env.plancia-locale.example"),
    (Join-Path $Root "DEPLOY_PIANCIA\PROGETTO_LOCALE\env.plancia-locale.example"),
    (Join-Path $Root "DEPLOY_PIANCIA\AVVIO_PC\env.plancia-locale.example")
  )
  if (-not (Test-Path $envFile)) {
    $copied = $false
    foreach ($ex in $envExampleCandidates) {
      if (Test-Path $ex) {
        Copy-Item -Force $ex $envFile
        Write-Host "Created backend\.env from $ex" -ForegroundColor Cyan
        Write-Host "Edit SITE_PASSWORD in backend\.env before using the UI." -ForegroundColor Yellow
        $copied = $true
        break
      }
    }
    if (-not $copied) {
      Write-Host "WARNING: no backend\.env — server may refuse login." -ForegroundColor Yellow
    }
  }

  Set-Location $Backend
  $env:HOST = if ($env:HOST) { $env:HOST } else { "127.0.0.1" }
  $env:PORT = if ($env:PORT) { $env:PORT } else { "8787" }
  if (-not $env:ATLAS_MEMORY_DIR) {
    $env:ATLAS_MEMORY_DIR = (Join-Path $Backend "data\agentq-memory")
  }
  New-Item -ItemType Directory -Force -Path $env:ATLAS_MEMORY_DIR | Out-Null

  Write-Host "ATLAS_MEMORY_DIR=$($env:ATLAS_MEMORY_DIR)"
  Write-Host "Local-only stack. When you see 'Dashboard listening', open:"
  Write-Host "  http://127.0.0.1:$($env:PORT)" -ForegroundColor Green
  Write-Host "Do not use the Render URL for this brain."
  Write-Host ""

  npm start
  if ($LASTEXITCODE -ne 0) {
    Wait-Exit 6 "npm start failed (code $LASTEXITCODE). See messages above."
  }
}
catch {
  Wait-Exit 99 ($_.Exception.Message)
}
