# Plancia locale launcher (Windows). Solo file locali — nessun GitHub / rete.
# Double-click start-plancia.bat oppure icona Desktop "Plancia".
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
  Wait-Key "Sistemato il problema, richiudi e rilancia start-plancia.bat (o l'icona Plancia)." "Yellow"
  exit 1
}

function Find-RepoRoot([string]$StartDir) {
  $dir = $StartDir
  for ($i = 0; $i -lt 8; $i++) {
    if (Test-Path -LiteralPath (Join-Path $dir "backend\package.json")) { return $dir }
    $parent = Split-Path -Parent $dir
    if (-not $parent -or $parent -eq $dir) { break }
    $dir = $parent
  }
  return $null
}

function Ensure-DesktopShortcut([string]$AvvioDir) {
  $bat = Join-Path $AvvioDir "start-plancia.bat"
  if (-not (Test-Path -LiteralPath $bat)) {
    Write-Host "AVVISO: start-plancia.bat non trovato, shortcut Desktop saltata." -ForegroundColor Yellow
    return
  }
  try {
    $desktop = [Environment]::GetFolderPath("Desktop")
    if (-not $desktop) { $desktop = Join-Path $env:USERPROFILE "Desktop" }
    $lnkPath = Join-Path $desktop "Plancia.lnk"
    $w = New-Object -ComObject WScript.Shell
    $s = $w.CreateShortcut($lnkPath)
    $s.TargetPath = $bat
    $s.WorkingDirectory = $AvvioDir
    $s.WindowStyle = 1
    $s.Description = "Atlas Plancia Locale (solo PC)"
    $s.IconLocation = "$env:SystemRoot\System32\shell32.dll,14"
    $s.Save()
    Write-Host "Icona Desktop: $lnkPath" -ForegroundColor Green
  } catch {
    Write-Host "AVVISO: impossibile creare icona Desktop: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

try {
  $ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  Set-Location -LiteralPath $ScriptDir

  # Self-elevate
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Riavvio come amministratore (UAC)..." -ForegroundColor Cyan
    $ps = Join-Path $ScriptDir "start-plancia.ps1"
    $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$ps`""
    try {
      Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argList -WorkingDirectory $ScriptDir | Out-Null
      exit 0
    } catch {
      Fail "Impossibile elevare i privilegi. Tasto destro su start-plancia.bat -> Esegui come amministratore. Dettaglio: $($_.Exception.Message)"
    }
  }

  Write-Host "============================================================"
  Write-Host " Atlas Plancia Locale (solo C:\Atlas — nessuna rete)"
  Write-Host " Cartella: $ScriptDir"
  Write-Host "============================================================"
  Write-Host ""

  Get-ChildItem -LiteralPath $ScriptDir -File -ErrorAction SilentlyContinue | ForEach-Object {
    try { Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue } catch {}
  }

  if ($ScriptDir -match '(?i)\\Temp\\|AppData\\Local\\Temp|\.zip') {
    Fail "Stai eseguendo da TEMP/ZIP. Usa la copia in C:\Atlas\ops-Commerce-Dashboard-main\DEPLOY_PIANCIA\AVVIO_PC."
  }

  $Root = Find-RepoRoot $ScriptDir
  if (-not $Root) {
    Fail "backend\package.json non trovato. Serve il progetto completo sotto C:\Atlas (non solo AVVIO_PC)."
  }

  $avvioDir = Join-Path $Root "DEPLOY_PIANCIA\AVVIO_PC"
  if (-not (Test-Path -LiteralPath $avvioDir)) { $avvioDir = $ScriptDir }
  Ensure-DesktopShortcut -AvvioDir $avvioDir

  $Backend = Join-Path $Root "backend"
  Write-Host "Repo:    $Root"
  Write-Host "Backend: $Backend"
  Write-Host ""

  $node = Get-Command node -ErrorAction SilentlyContinue
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $node) {
    Fail "Node.js non e' nel PATH. Installa Node 20 LTS da https://nodejs.org (Add to PATH), riavvia il PC, rilancia."
  }
  if (-not $npm) {
    Fail "npm non e' nel PATH. Reinstalla Node da https://nodejs.org e riavvia il PC."
  }
  Write-Host "Node: $(node -v)   npm: $(npm -v)"
  Write-Host ""

  if ($ScriptDir -match '(?i)OneDrive|\\Documents\\') {
    Write-Host "AVVISO: Documents/OneDrive. Preferisci C:\Atlas per evitare Accesso negato." -ForegroundColor Yellow
    Write-Host ""
  }

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
    Write-Host "Installazione dipendenze locali (npm ci --ignore-scripts)..." -ForegroundColor Cyan
    npm ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) {
      npm install --ignore-scripts
      if ($LASTEXITCODE -ne 0) {
        Fail "npm install non riuscito. Sposta il progetto in C:\Atlas e riprova."
      }
    }
  }

  $envExample = Join-Path $Root "DEPLOY_PIANCIA\PROGETTO_LOCALE\env.plancia-locale.example"
  if ((-not (Test-Path -LiteralPath ".env")) -and (Test-Path -LiteralPath $envExample)) {
    Copy-Item -LiteralPath $envExample -Destination ".env" -Force
    Write-Host "Creato backend\.env — modifica SITE_PASSWORD se serve." -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "Avvio server locale. Attendi: Dashboard listening" -ForegroundColor Green
  Write-Host "Poi apri: http://127.0.0.1:$($env:PORT)" -ForegroundColor Green
  Write-Host ""

  npm start
  if ($LASTEXITCODE -ne 0) {
    Fail "npm start e' terminato con codice $LASTEXITCODE."
  }
  Write-Host "Server terminato."
  Wait-Key "" "Gray"
  exit 0
}
catch {
  Fail $_.Exception.Message
}
