# Plancia locale launcher (Windows). Double-click start-plancia.bat.
# Auto-update from GitHub main, then start backend. Never closes silently on error.
param(
  [switch]$SkipUpdate
)

$ErrorActionPreference = "Stop"
$RepoSlug = "lubranoe88-create/ops-Commerce-Dashboard"
$RepoHttps = "https://github.com/$RepoSlug.git"
$Branch = "main"
$PreferredRoot = "C:\Atlas\ops-Commerce-Dashboard"

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

function Get-RemoteMainSha {
  $headers = @{ "User-Agent" = "plancia-avvio"; "Accept" = "application/vnd.github+json" }
  if ($env:PLANCIA_GH_TOKEN) { $headers["Authorization"] = "Bearer $($env:PLANCIA_GH_TOKEN)" }
  elseif ($env:GH_TOKEN) { $headers["Authorization"] = "Bearer $($env:GH_TOKEN)" }
  $url = "https://api.github.com/repos/$RepoSlug/commits/$Branch"
  $resp = Invoke-RestMethod -Uri $url -Headers $headers -TimeoutSec 30
  return [string]$resp.sha
}

function Update-WithGit([string]$Root) {
  $git = Get-Command git -ErrorAction SilentlyContinue
  if (-not $git) { return $false }

  Push-Location -LiteralPath $Root
  try {
    if (-not (Test-Path -LiteralPath (Join-Path $Root ".git"))) {
      Write-Host "Cartella senza .git — provo git clone in $PreferredRoot ..." -ForegroundColor Cyan
      return $false
    }
    Write-Host "Aggiornamento via git (origin/$Branch)..." -ForegroundColor Cyan
    git remote get-url origin 2>$null | Out-Null
    git fetch origin $Branch
    if ($LASTEXITCODE -ne 0) {
      Fail "git fetch non riuscito. Il repo e' privato: accedi con GitHub (git credential) oppure imposta PLANCIA_GH_TOKEN. Poi riprova."
    }
    $local = (git rev-parse HEAD).Trim()
    $remote = (git rev-parse "origin/$Branch").Trim()
    Write-Host "Locale:  $local"
    Write-Host "Remoto:  $remote"
    if ($local -eq $remote) {
      Write-Host "Gia' aggiornato." -ForegroundColor Green
      return $true
    }
    git pull --ff-only origin $Branch
    if ($LASTEXITCODE -ne 0) {
      Fail "git pull non riuscito (conflitto o rete). Risolvi a mano oppure elimina la cartella e riclona."
    }
    Write-Host "Aggiornamento git completato." -ForegroundColor Green
    return $true
  }
  finally { Pop-Location }
}

function Update-WithZip([string]$Root) {
  Write-Host "Aggiornamento via ZIP GitHub..." -ForegroundColor Cyan
  $sha = $null
  try { $sha = Get-RemoteMainSha } catch {
    Fail "Impossibile leggere il commit su GitHub (repo privato). Installa Git e clona il repo, oppure crea un token e imposta: setx PLANCIA_GH_TOKEN tuo_token. Dettaglio: $($_.Exception.Message)"
  }

  $stampFile = Join-Path $Root ".plancia-commit"
  $localSha = if (Test-Path -LiteralPath $stampFile) { (Get-Content -LiteralPath $stampFile -Raw).Trim() } else { "" }
  if ($localSha -and $localSha -eq $sha) {
    Write-Host "Gia' aggiornato (SHA $sha)." -ForegroundColor Green
    return
  }

  $headers = @{ "User-Agent" = "plancia-avvio"; "Accept" = "application/vnd.github+json" }
  if ($env:PLANCIA_GH_TOKEN) { $headers["Authorization"] = "Bearer $($env:PLANCIA_GH_TOKEN)" }
  elseif ($env:GH_TOKEN) { $headers["Authorization"] = "Bearer $($env:GH_TOKEN)" }

  $zipUrl = "https://api.github.com/repos/$RepoSlug/zipball/$Branch"
  $tmpDir = Join-Path $env:TEMP ("plancia-update-" + [guid]::NewGuid().ToString("N"))
  $zipPath = Join-Path $env:TEMP "plancia-main.zip"
  New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

  Write-Host "Download $Branch ..."
  try {
    Invoke-WebRequest -Uri $zipUrl -Headers $headers -OutFile $zipPath -TimeoutSec 600
  } catch {
    Fail "Download ZIP fallito (repo privato senza token?). Installa Git e usa un clone autenticato, oppure setx PLANCIA_GH_TOKEN. Dettaglio: $($_.Exception.Message)"
  }

  Write-Host "Estrazione..."
  Expand-Archive -LiteralPath $zipPath -DestinationPath $tmpDir -Force
  $extracted = Get-ChildItem -LiteralPath $tmpDir -Directory | Select-Object -First 1
  if (-not $extracted) { Fail "ZIP estratto ma cartella vuota." }

  Write-Host "Copia file su $Root ..."
  # Robocopy-like copy; exclude .git so we don't wipe a git checkout accidentally if mixed
  $src = $extracted.FullName
  Get-ChildItem -LiteralPath $src -Force | ForEach-Object {
    $dest = Join-Path $Root $_.Name
    if ($_.PSIsContainer) {
      Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force
    } else {
      Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
    }
  }
  Set-Content -LiteralPath $stampFile -Value $sha -NoNewline
  try { Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue } catch {}
  try { Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}
  Write-Host "Aggiornamento ZIP completato (SHA $sha)." -ForegroundColor Green
}

function Ensure-Updated([string]$Root) {
  if ($SkipUpdate) {
    Write-Host "SkipUpdate: nessun controllo aggiornamenti." -ForegroundColor DarkGray
    return
  }
  Write-Host "Controllo aggiornamenti GitHub ($RepoSlug / $Branch)..." -ForegroundColor Cyan
  $usedGit = $false
  if (Get-Command git -ErrorAction SilentlyContinue) {
    if (Test-Path -LiteralPath (Join-Path $Root ".git")) {
      $usedGit = Update-WithGit -Root $Root
    } else {
      Write-Host "Nessun .git qui. Consiglio una tantum:" -ForegroundColor Yellow
      Write-Host "  git clone $RepoHttps $PreferredRoot" -ForegroundColor Yellow
      Write-Host "Poi lancia sempre da quella cartella. Provo ZIP..." -ForegroundColor Yellow
    }
  } else {
    Write-Host "Git non installato — uso ZIP. (Consigliato: installa Git for Windows)" -ForegroundColor Yellow
  }
  if (-not $usedGit) {
    Update-WithZip -Root $Root
  }

  # Rilancia lo script aggiornato (evita codice vecchio in memoria)
  $newPs1 = Join-Path $Root "DEPLOY_PIANCIA\AVVIO_PC\start-plancia.ps1"
  if (-not (Test-Path -LiteralPath $newPs1)) {
    $newPs1 = Join-Path $ScriptDir "start-plancia.ps1"
  }
  Write-Host "Rilancio launcher aggiornato..." -ForegroundColor Cyan
  $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$newPs1`" -SkipUpdate"
  Start-Process -FilePath "powershell.exe" -ArgumentList $argList -WorkingDirectory (Split-Path -Parent $newPs1) -Wait
  exit $LASTEXITCODE
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
    $extra = @()
    if ($SkipUpdate) { $extra += "-SkipUpdate" }
    $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$ps`" " + ($extra -join " ")
    try {
      Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argList.Trim() -WorkingDirectory $ScriptDir | Out-Null
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

  Get-ChildItem -LiteralPath $ScriptDir -File -ErrorAction SilentlyContinue | ForEach-Object {
    try { Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue } catch {}
  }

  if ($ScriptDir -match '(?i)\\Temp\\|AppData\\Local\\Temp|\.zip') {
    Fail "Stai eseguendo da TEMP/ZIP. Metti il progetto in C:\Atlas e lancia start-plancia.bat da li."
  }

  $Root = Find-RepoRoot $ScriptDir
  if (-not $Root) {
    Fail "backend\package.json non trovato. Serve il repo completo sotto C:\Atlas (non solo AVVIO_PC)."
  }

  Ensure-Updated -Root $Root

  # --- avvio backend (dopo update / SkipUpdate) ---
  $Backend = Join-Path $Root "backend"
  Write-Host "Repo:    $Root"
  Write-Host "Backend: $Backend"
  Write-Host ""

  $node = Get-Command node -ErrorAction SilentlyContinue
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $node) {
    Fail "Node.js non e' nel PATH. Installa Node 20 LTS da https://nodejs.org (Add to PATH), riavvia il PC, rilancia start-plancia.bat."
  }
  if (-not $npm) {
    Fail "npm non e' nel PATH. Reinstalla Node da https://nodejs.org e riavvia il PC."
  }
  Write-Host "Node: $(node -v)   npm: $(npm -v)"
  Write-Host ""

  if ($ScriptDir -match '(?i)OneDrive|\\Documents\\') {
    Write-Host "AVVISO: Documents/OneDrive. Se Accesso negato, sposta in C:\Atlas." -ForegroundColor Yellow
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
    Write-Host "Installazione dipendenze (npm ci --ignore-scripts)..." -ForegroundColor Cyan
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
  Write-Host "Avvio server. Attendi: Dashboard listening" -ForegroundColor Green
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
