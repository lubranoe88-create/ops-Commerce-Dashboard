# Launcher for full repo (requires backend\ above DEPLOY_PIANCIA).
$ErrorActionPreference = 'Stop'

function Hold-Window([string]$Message, [int]$Code = 1) {
  Write-Host ''
  Write-Host $Message -ForegroundColor Red
  Write-Host ''
  Write-Host 'Press Enter to close...' -ForegroundColor Yellow
  try { Read-Host | Out-Null } catch { Start-Sleep -Seconds 120 }
  try { cmd /c pause } catch {}
  exit $Code
}

function Find-RepoRoot([string]$StartDir) {
  $dir = (Resolve-Path -LiteralPath $StartDir).Path
  for ($i = 0; $i -lt 8; $i++) {
    if (Test-Path -LiteralPath (Join-Path $dir 'backend\package.json')) { return $dir }
    $parent = Split-Path -Parent $dir
    if (-not $parent -or $parent -eq $dir) { break }
    $dir = $parent
  }
  return $null
}

try {
  $ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  Write-Host ('RUNNING PS1 FROM: ' + $ScriptDir)
  $Root = Find-RepoRoot $ScriptDir
  if (-not $Root) {
    Hold-Window '[ERROR] backend\package.json not found. Need FULL repo, not AVVIO_PC alone.' 1
  }
  $Backend = Join-Path $Root 'backend'
  Write-Host ('Repo root: ' + $Root)
  Write-Host ('Backend  : ' + $Backend)
  if (-not (Get-Command node -EA SilentlyContinue)) { Hold-Window '[ERROR] Install Node 20+ from https://nodejs.org' 3 }
  if (-not (Get-Command npm -EA SilentlyContinue)) { Hold-Window '[ERROR] npm missing — reinstall Node.js' 4 }
  Write-Host ((node -v) + ' / ' + (npm -v))
  try {
    $null = Invoke-WebRequest -Uri 'http://bionic.local:23000/v1/models' -UseBasicParsing -TimeoutSec 2
    Write-Host '[OK] LM Studio reachable' -ForegroundColor Green
  } catch {
    Write-Host '[WARN] LM Studio not reachable — dashboard still starts; local chat may fall back.' -ForegroundColor Yellow
  }
  Set-Location -LiteralPath $Backend
  if (-not (Test-Path 'node_modules')) {
    Write-Host 'npm ci --ignore-scripts...'
    npm ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) {
      npm install --ignore-scripts
      if ($LASTEXITCODE -ne 0) { Hold-Window '[ERROR] npm install failed' 5 }
    }
  }
  $ex = Join-Path $Root 'DEPLOY_PIANCIA\PROGETTO_LOCALE\env.plancia-locale.example'
  if ((-not (Test-Path '.env')) -and (Test-Path $ex)) {
    Copy-Item -LiteralPath $ex -Destination '.env' -Force
    Write-Host 'Created backend\.env — edit SITE_PASSWORD' -ForegroundColor Yellow
  }
  $env:HOST = if ($env:HOST) { $env:HOST } else { '127.0.0.1' }
  $env:PORT = if ($env:PORT) { $env:PORT } else { '8787' }
  if (-not $env:ATLAS_MEMORY_DIR) { $env:ATLAS_MEMORY_DIR = Join-Path $Backend 'data\agentq-memory' }
  New-Item -ItemType Directory -Force -Path $env:ATLAS_MEMORY_DIR | Out-Null
  Write-Host ('Wait for Dashboard listening, then open http://127.0.0.1:' + $env:PORT) -ForegroundColor Green
  npm start
  if ($LASTEXITCODE -ne 0) { Hold-Window ('[ERROR] npm start failed ' + $LASTEXITCODE) 6 }
  cmd /c pause
} catch {
  Hold-Window ('[ERROR] ' + $_.Exception.Message) 99
}
