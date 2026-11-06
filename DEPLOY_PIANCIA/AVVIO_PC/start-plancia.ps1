# Plancia locale launcher (Windows).
# Controlla GitHub main, aggiorna se serve, poi avvia. Se la rete fallisce, usa i file locali.
# Doppio clic su AVVIA-PLANCIA.bat / start-plancia.bat oppure icona Desktop "Plancia".
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
  Wait-Key "Sistemato il problema, richiudi e rilancia AVVIA-PLANCIA.bat (o l'icona Plancia)." "Yellow"
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
  $bat = Join-Path $AvvioDir "AVVIA-PLANCIA.bat"
  if (-not (Test-Path -LiteralPath $bat)) { $bat = Join-Path $AvvioDir "start-plancia.bat" }
  if (-not (Test-Path -LiteralPath $bat)) { return }
  try {
    $desktop = [Environment]::GetFolderPath("Desktop")
    if (-not $desktop) { $desktop = Join-Path $env:USERPROFILE "Desktop" }
    $lnkPath = Join-Path $desktop "Plancia.lnk"
    $w = New-Object -ComObject WScript.Shell
    $s = $w.CreateShortcut($lnkPath)
    $s.TargetPath = $bat
    $s.WorkingDirectory = $AvvioDir
    $s.WindowStyle = 1
    $s.Description = "Atlas Plancia Locale (auto-update GitHub)"
    $s.IconLocation = "$env:SystemRoot\System32\shell32.dll,14"
    $s.Save()
    Write-Host "Icona Desktop: $lnkPath" -ForegroundColor Green
  } catch {
    Write-Host "AVVISO: icona Desktop non creata: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

function Get-GhHeaders {
  $headers = @{ "User-Agent" = "plancia-avvio"; "Accept" = "application/vnd.github+json" }
  if ($env:PLANCIA_GH_TOKEN) { $headers["Authorization"] = "Bearer $($env:PLANCIA_GH_TOKEN)" }
  elseif ($env:GH_TOKEN) { $headers["Authorization"] = "Bearer $($env:GH_TOKEN)" }
  return $headers
}

function Get-RemoteMainSha {
  $url = "https://api.github.com/repos/$RepoSlug/commits/$Branch"
  $resp = Invoke-RestMethod -Uri $url -Headers (Get-GhHeaders) -TimeoutSec 20
  return [string]$resp.sha
}

# Returns: "updated" | "current" | "skip" (try next method) | never throws for network - caller wraps ZIP.
function Update-WithGit([string]$Root) {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return "skip" }
  if (-not (Test-Path -LiteralPath (Join-Path $Root ".git"))) { return "skip" }

  Push-Location -LiteralPath $Root
  try {
    Write-Host "Aggiornamento via git (origin/$Branch)..." -ForegroundColor Cyan
    git fetch origin $Branch 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
      Write-Host "AVVISO: git fetch non riuscito. Provo ZIP o file locali." -ForegroundColor Yellow
      return "skip"
    }
    $local = (git rev-parse HEAD).Trim()
    $remote = (git rev-parse "origin/$Branch").Trim()
    Write-Host "Locale:  $local"
    Write-Host "Remoto:  $remote"
    if ($local -eq $remote) {
      Write-Host "Gia' aggiornato." -ForegroundColor Green
      $stampFile = Join-Path $Root ".plancia-commit"
      Set-Content -LiteralPath $stampFile -Value $local -NoNewline
      return "current"
    }
    git pull --ff-only origin $Branch 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
      Write-Host "AVVISO: git pull non riuscito. Provo ZIP o file locali." -ForegroundColor Yellow
      return "skip"
    }
    $head = (git rev-parse HEAD).Trim()
    Set-Content -LiteralPath (Join-Path $Root ".plancia-commit") -Value $head -NoNewline
    Write-Host "Aggiornamento git completato." -ForegroundColor Green
    return "updated"
  } catch {
    Write-Host "AVVISO: git update fallito ($($_.Exception.Message))." -ForegroundColor Yellow
    return "skip"
  } finally {
    Pop-Location
  }
}

# Returns: "updated" | "current" - throws on network/download failure (caller soft-fails).
function Update-WithZip([string]$Root) {
  Write-Host "Aggiornamento via ZIP GitHub..." -ForegroundColor Cyan
  $sha = Get-RemoteMainSha
  if (-not $sha) { throw "SHA remoto assente" }

  $stampFile = Join-Path $Root ".plancia-commit"
  $localSha = if (Test-Path -LiteralPath $stampFile) { (Get-Content -LiteralPath $stampFile -Raw).Trim() } else { "" }
  if ($localSha -and $localSha -eq $sha) {
    Write-Host "Gia' aggiornato (SHA $sha)." -ForegroundColor Green
    return "current"
  }

  $zipUrl = "https://api.github.com/repos/$RepoSlug/zipball/$Branch"
  $tmpDir = Join-Path $env:TEMP ("plancia-update-" + [guid]::NewGuid().ToString("N"))
  $zipPath = Join-Path $env:TEMP "plancia-main.zip"
  New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

  Write-Host "Download $Branch ..."
  Invoke-WebRequest -Uri $zipUrl -Headers (Get-GhHeaders) -OutFile $zipPath -TimeoutSec 600

  Write-Host "Estrazione..."
  Expand-Archive -LiteralPath $zipPath -DestinationPath $tmpDir -Force
  $extracted = Get-ChildItem -LiteralPath $tmpDir -Directory | Select-Object -First 1
  if (-not $extracted) { throw "ZIP estratto ma cartella vuota." }

  # Conserva backend\.env locale
  $envPath = Join-Path $Root "backend\.env"
  $envBackup = $null
  if (Test-Path -LiteralPath $envPath) {
    $envBackup = Get-Content -LiteralPath $envPath -Raw -ErrorAction SilentlyContinue
  }

  Write-Host "Copia file su $Root ..."
  $src = $extracted.FullName
  Get-ChildItem -LiteralPath $src -Force | ForEach-Object {
    if ($_.Name -eq ".git" -or $_.Name -eq "node_modules") { return }
    $dest = Join-Path $Root $_.Name
    if ($_.PSIsContainer) {
      Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force
    } else {
      Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
    }
  }

  if ($null -ne $envBackup) {
    $backendDir = Join-Path $Root "backend"
    if (-not (Test-Path -LiteralPath $backendDir)) { New-Item -ItemType Directory -Force -Path $backendDir | Out-Null }
    Set-Content -LiteralPath $envPath -Value $envBackup -NoNewline
  }

  Set-Content -LiteralPath $stampFile -Value $sha -NoNewline
  try { Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue } catch {}
  try { Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}
  Write-Host "Aggiornamento ZIP completato (SHA $sha)." -ForegroundColor Green
  return "updated"
}

function Write-UpdateBanner([string]$Title, [string]$Color) {
  Write-Host ""
  Write-Host "============================================================" -ForegroundColor $Color
  Write-Host " $Title" -ForegroundColor $Color
  Write-Host "============================================================" -ForegroundColor $Color
  Write-Host ""
}

function Write-UpdateLog([string]$Line) {
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $text = "[$stamp] $Line"
  $logA = Join-Path $ScriptDir "last-update.txt"
  $logB = Join-Path $env:TEMP "plancia-avvio-last-run.txt"
  try { Add-Content -LiteralPath $logA -Value $text -ErrorAction SilentlyContinue } catch {}
  try { Add-Content -LiteralPath $logB -Value $text -ErrorAction SilentlyContinue } catch {}
}

function Ensure-Updated([string]$Root) {
  if ($SkipUpdate) {
    Write-Host "SkipUpdate: nessun controllo aggiornamenti." -ForegroundColor DarkGray
    return
  }

  Write-UpdateBanner "CONTROLLO AGGIORNAMENTO GITHUB (main)" "Cyan"
  Write-Host "Controllo aggiornamenti GitHub ($RepoSlug / $Branch)..." -ForegroundColor Cyan
  Write-UpdateLog "Controllo aggiornamenti su $Root"
  $result = "skip"
  try {
    $result = Update-WithGit -Root $Root
    if ($result -eq "skip") {
      $result = Update-WithZip -Root $Root
    }
  } catch {
    Write-UpdateBanner "AGGIORNAMENTO FALLITO - uso file locali" "Red"
    Write-Host "Dettaglio: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "Per riprovare: doppio clic su FORZA-AGGIORNAMENTO.bat" -ForegroundColor Cyan
    Write-UpdateLog ("FALLITO: " + $_.Exception.Message)
    Start-Sleep -Seconds 4
    return
  }

  if ($result -eq "updated") {
    Write-UpdateBanner "AGGIORNAMENTO RIUSCITO" "Green"
    Write-UpdateLog "RIUSCITO (updated)"
    $newPs1 = Join-Path $Root "DEPLOY_PIANCIA\AVVIO_PC\start-plancia.ps1"
    if (-not (Test-Path -LiteralPath $newPs1)) { $newPs1 = Join-Path $ScriptDir "start-plancia.ps1" }
    Write-Host "Rilancio launcher aggiornato..." -ForegroundColor Cyan
    $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$newPs1`" -SkipUpdate"
    Start-Process -FilePath "powershell.exe" -ArgumentList $argList -WorkingDirectory (Split-Path -Parent $newPs1) -Wait
    exit $LASTEXITCODE
  }

  if ($result -eq "current") {
    Write-UpdateBanner "GIA' AGGIORNATO - avvio locale" "Green"
    Write-UpdateLog "GIA AGGIORNATO (current)"
  } else {
    Write-UpdateBanner "AGGIORNAMENTO NON ESEGUITO - avvio file locali" "Yellow"
    Write-Host "Per forzare: doppio clic su FORZA-AGGIORNAMENTO.bat" -ForegroundColor Cyan
    Write-UpdateLog "NON ESEGUITO (result=$result)"
    Start-Sleep -Seconds 3
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
    $extra = @()
    if ($SkipUpdate) { $extra += "-SkipUpdate" }
    $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$ps`" " + ($extra -join " ")
    try {
      Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argList.Trim() -WorkingDirectory $ScriptDir | Out-Null
      exit 0
    } catch {
      Fail "Impossibile elevare i privilegi. Tasto destro su AVVIA-PLANCIA.bat -> Esegui come amministratore."
    }
  }

  Write-Host "============================================================"
  Write-Host " Atlas Plancia Locale - auto-update GitHub + avvio"
  Write-Host " Cartella: $ScriptDir"
  Write-Host "============================================================"
  Write-Host ""

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

  Ensure-Updated -Root $Root

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
    Write-Host "Creato backend\.env da PROGETTO_LOCALE - modifica SITE_PASSWORD se serve." -ForegroundColor Yellow
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
