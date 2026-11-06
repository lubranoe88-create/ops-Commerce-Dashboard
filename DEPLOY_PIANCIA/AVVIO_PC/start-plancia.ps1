# Plancia locale — solo PC. Nessuna rete / aggiornamento remoto.
# Doppio clic su start-plancia.bat oppure icona Desktop "Plancia".
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
  $candidates = New-Object System.Collections.Generic.List[string]
  $dir = $StartDir
  for ($i = 0; $i -lt 8; $i++) {
    [void]$candidates.Add($dir)
    $parent = Split-Path -Parent $dir
    if (-not $parent -or $parent -eq $dir) { break }
    $dir = $parent
  }
  foreach ($extra in @("C:\Atlas", "C:\Atlas\ops-Commerce-Dashboard", "C:\Atlas\ops-Commerce-Dashboard-main")) {
    if (Test-Path -LiteralPath $extra) { [void]$candidates.Add($extra) }
  }
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath (Join-Path $c "backend\package.json")) { return $c }
  }
  return $null
}

function Ensure-DesktopShortcut([string]$AvvioDir) {
  $bat = Join-Path $AvvioDir "start-plancia.bat"
  if (-not (Test-Path -LiteralPath $bat)) { return }
  try {
    $desktop = [Environment]::GetFolderPath("Desktop")
    if (-not $desktop) { $desktop = Join-Path $env:USERPROFILE "Desktop" }
    $lnkPath = Join-Path $desktop "Plancia.lnk"
    if (Test-Path -LiteralPath $lnkPath) {
      Write-Host "Icona Desktop gia' presente: $lnkPath" -ForegroundColor DarkGray
      return
    }
    $w = New-Object -ComObject WScript.Shell
    $s = $w.CreateShortcut($lnkPath)
    $s.TargetPath = $bat
    $s.WorkingDirectory = $AvvioDir
    $s.WindowStyle = 1
    $s.Description = "Atlas Plancia Locale (solo PC)"
    $s.IconLocation = "$env:SystemRoot\System32\shell32.dll,14"
    $s.Save()
    Write-Host "Creata icona Desktop: $lnkPath" -ForegroundColor Green
  } catch {
    Write-Host "AVVISO: icona Desktop non creata: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

try {
  $ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  Set-Location -LiteralPath $ScriptDir

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
      Fail "Impossibile elevare i privilegi. Tasto destro su start-plancia.bat -> Esegui come amministratore."
    }
  }

  Write-Host "============================================================"
  Write-Host " Atlas Plancia Locale — SOLO PC (nessuna rete)"
  Write-Host " Cartella: $ScriptDir"
  Write-Host "============================================================"
  Write-Host ""

  # Sblocca Mark-of-the-Web su tutti i file in questa cartella
  Get-ChildItem -LiteralPath $ScriptDir -File -ErrorAction SilentlyContinue | ForEach-Object {
    try { Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue } catch {}
  }

  if ($ScriptDir -match '(?i)\\Temp\\|AppData\\Local\\Temp|\.zip') {
    Fail "Esecuzione da TEMP/ZIP. Copia i file in C:\Atlas\DEPLOY_PIANCIA\AVVIO_PC e rilancia da li."
  }

  $Root = Find-RepoRoot $ScriptDir
  if (-not $Root) {
    Fail "backend\package.json non trovato. Metti il progetto completo sotto C:\Atlas (con cartella backend) oppure C:\Atlas\ops-Commerce-Dashboard-main."
  }

  $avvioDir = Join-Path $Root "DEPLOY_PIANCIA\AVVIO_PC"
  if (-not (Test-Path -LiteralPath (Join-Path $avvioDir "start-plancia.bat"))) { $avvioDir = $ScriptDir }
  Ensure-DesktopShortcut -AvvioDir $avvioDir

  $Backend = Join-Path $Root "backend"
  Write-Host "Progetto: $Root"
  Write-Host "Backend:  $Backend"
  Write-Host "PROGETTO_LOCALE (docs/env): $(Join-Path $Root 'DEPLOY_PIANCIA\PROGETTO_LOCALE')"
  Write-Host ""

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Node.js non e' nel PATH. Installa Node 20 LTS da https://nodejs.org (spunta Add to PATH), riavvia il PC, poi rilancia."
  }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Fail "npm non e' nel PATH. Reinstalla Node da https://nodejs.org e riavvia il PC."
  }
  Write-Host "Node: $(node -v)   npm: $(npm -v)"
  Write-Host ""

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
    Write-Host "Installazione dipendenze locali..." -ForegroundColor Cyan
    npm ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) {
      npm install --ignore-scripts
      if ($LASTEXITCODE -ne 0) {
        Fail "npm install non riuscito. Verifica che la cartella backend sia completa sotto C:\Atlas."
      }
    }
  }

  $envExample = Join-Path $Root "DEPLOY_PIANCIA\PROGETTO_LOCALE\env.plancia-locale.example"
  if ((-not (Test-Path -LiteralPath ".env")) -and (Test-Path -LiteralPath $envExample)) {
    Copy-Item -LiteralPath $envExample -Destination ".env" -Force
    Write-Host "Creato backend\.env da PROGETTO_LOCALE — modifica SITE_PASSWORD se serve." -ForegroundColor Yellow
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
