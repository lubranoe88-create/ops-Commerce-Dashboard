# Plancia locale launcher (Windows). Double-click start-plancia.bat.
# Self-elevates, unblocks MOTW, starts backend, never closes silently on error.
$ErrorActionPreference = "Stop"

function Wait-Key([string]$Message, [string]$Color = "Yellow") {
  Write-Host ""
  if ($Message) { Write-Host $Message -ForegroundColor $Color }
  Write-Host ""
  Write-Host "Premi INVIO per chiudere questa finestra..." -ForegroundColor Cyan
  try { [void][Console]::ReadLine() } catch { cmd /c pause }
}

function Fail([string]$Message) {
  Write-Host ""
  Write-Host "ERRORE: $Message" -ForegroundColor Red
  Wait-Key "Sistemato il problema, richiudi e rilancia start-plancia.bat." "Yellow"
  exit 1
}

try {
  $ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  Set-Location -LiteralPath $ScriptDir

  # (1) Self-elevate if not admin
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Riavvio come amministratore (UAC)..." -ForegroundColor Cyan
    $ps = Join-Path $ScriptDir "start-plancia.ps1"
    $args = "-NoProfile -ExecutionPolicy Bypass -File `"$ps`""
    try {
      Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $args -WorkingDirectory $ScriptDir | Out-Null
      exit 0
    } catch {
      Fail "Impossibile elevare i privilegi. Tasto destro su start-plancia.bat -> Esegui come amministratore. Dettaglio: $($_.Exception.Message)"
    }
  }

  Write-Host "============================================================"
  Write-Host " Atlas Plancia Locale"
  Write-Host " Cartella: $ScriptDir"
  Write-Host "============================================================"
  Write-Host ""

  # (2) Unblock Mark-of-the-Web on everything in this folder
  Get-ChildItem -LiteralPath $ScriptDir -File -ErrorAction SilentlyContinue | ForEach-Object {
    try { Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue } catch {}
  }

  # Temp / zip guard
  if ($ScriptDir -match '(?i)\\Temp\\|AppData\\Local\\Temp|\.zip') {
    Fail "Stai eseguendo da una cartella TEMP/ZIP. Estrai tutto il repo in C:\Atlas e lancia start-plancia.bat da li."
  }

  # Find repo root (folder that contains backend\package.json)
  $Root = $null
  $dir = $ScriptDir
  for ($i = 0; $i -lt 8; $i++) {
    if (Test-Path -LiteralPath (Join-Path $dir "backend\package.json")) { $Root = $dir; break }
    $parent = Split-Path -Parent $dir
    if (-not $parent -or $parent -eq $dir) { break }
    $dir = $parent
  }
  if (-not $Root) {
    Fail "backend\package.json non trovato. Serve il repo completo (non solo AVVIO_PC). Estrai ops-Commerce-Dashboard in C:\Atlas e riprova."
  }

  $Backend = Join-Path $Root "backend"
  Write-Host "Repo:    $Root"
  Write-Host "Backend: $Backend"
  Write-Host ""

  # (3) Node on PATH
  $node = Get-Command node -ErrorAction SilentlyContinue
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $node) {
    Fail "Node.js non e' nel PATH. Installa Node 20 LTS da https://nodejs.org (spunta Add to PATH), poi RIAVVIA il PC e rilancia start-plancia.bat."
  }
  if (-not $npm) {
    Fail "npm non e' nel PATH. Reinstalla Node da https://nodejs.org e riavvia il PC."
  }
  Write-Host "Node: $(node -v)   npm: $(npm -v)"
  Write-Host ""

  if ($ScriptDir -match '(?i)OneDrive|\\Documents\\') {
    Write-Host "AVVISO: percorso Documents/OneDrive. Se vedi Accesso negato, sposta il repo in C:\Atlas e rilancia." -ForegroundColor Yellow
    Write-Host ""
  }

  # Memory off OneDrive
  if (-not $env:ATLAS_MEMORY_DIR) {
    $env:ATLAS_MEMORY_DIR = Join-Path $env:LOCALAPPDATA "AtlasPlancia\agentq-memory"
  }
  New-Item -ItemType Directory -Force -Path $env:ATLAS_MEMORY_DIR | Out-Null
  $env:HOST = if ($env:HOST) { $env:HOST } else { "127.0.0.1" }
  $env:PORT = if ($env:PORT) { $env:PORT } else { "8787" }

  Write-Host "Memoria: $($env:ATLAS_MEMORY_DIR)"
  Write-Host "Porta:   $($env:PORT)"
  Write-Host ""

  Set-Location -LiteralPath $Backend

  if (-not (Test-Path -LiteralPath "node_modules")) {
    Write-Host "Installazione dipendenze (npm ci --ignore-scripts)..." -ForegroundColor Cyan
    npm ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) {
      npm install --ignore-scripts
      if ($LASTEXITCODE -ne 0) {
        Fail "npm install non riuscito (spesso OneDrive). Sposta il progetto in C:\Atlas\ops-Commerce-Dashboard-main e riprova."
      }
    }
  }

  $envExample = Join-Path $Root "DEPLOY_PIANCIA\PROGETTO_LOCALE\env.plancia-locale.example"
  if ((-not (Test-Path -LiteralPath ".env")) -and (Test-Path -LiteralPath $envExample)) {
    Copy-Item -LiteralPath $envExample -Destination ".env" -Force
    Write-Host "Creato backend\.env — modifica SITE_PASSWORD se serve." -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "Avvio server. Attendi: Dashboard listening" -ForegroundColor Green
  Write-Host "Poi apri nel browser: http://127.0.0.1:$($env:PORT)" -ForegroundColor Green
  Write-Host "LM Studio su Bionic e' opzionale all'avvio." -ForegroundColor DarkGray
  Write-Host ""

  # (4) Start backend
  npm start
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    Fail "npm start e' terminato con codice $code. Controlla i messaggi sopra."
  }

  Write-Host "Server terminato."
  Wait-Key "" "Gray"
  exit 0
}
catch {
  Fail $_.Exception.Message
}
