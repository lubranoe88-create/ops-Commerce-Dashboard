# Aggiorna Plancia da GitHub main. Messaggi chiari in italiano (niente silenzio).
param(
  [switch]$Interactive
)

$ErrorActionPreference = "Stop"
$RepoSlug = "lubranoe88-create/ops-Commerce-Dashboard"
$Branch = "main"
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$LogFile = Join-Path $ScriptDir "last-update.txt"
$TempLog = Join-Path $env:TEMP "plancia-avvio-last-run.txt"

function Write-Log([string]$Line) {
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $text = "[$stamp] $Line"
  Write-Host $text
  try {
    Add-Content -LiteralPath $LogFile -Value $text -ErrorAction SilentlyContinue
    Add-Content -LiteralPath $TempLog -Value $text -ErrorAction SilentlyContinue
  } catch {}
}

function Show-Banner([string]$Title, [string]$Color) {
  Write-Host ""
  Write-Host "============================================================" -ForegroundColor $Color
  Write-Host " $Title" -ForegroundColor $Color
  Write-Host "============================================================" -ForegroundColor $Color
  Write-Host ""
}

function Resolve-Install {
  # 1) Portable pack: ...\Plancia-Locale\ with app\backend
  $packApp = Join-Path $ScriptDir "app\backend\package.json"
  if (Test-Path -LiteralPath $packApp) {
    return [pscustomobject]@{
      Kind = "pack"
      Root = $ScriptDir
      Dest = (Join-Path $ScriptDir "app")
      Stamp = (Join-Path $ScriptDir ".plancia-commit")
    }
  }
  # 2) Script inside DEPLOY_PIANCIA\AVVIO_PC → climb to repo root
  $dir = $ScriptDir
  for ($i = 0; $i -lt 8; $i++) {
    if (Test-Path -LiteralPath (Join-Path $dir "backend\package.json")) {
      return [pscustomobject]@{
        Kind = "repo"
        Root = $dir
        Dest = $dir
        Stamp = (Join-Path $dir ".plancia-commit")
      }
    }
    $parent = Split-Path -Parent $dir
    if (-not $parent -or $parent -eq $dir) { break }
    $dir = $parent
  }
  foreach ($extra in @("C:\Atlas\ops-Commerce-Dashboard", "C:\Atlas\ops-Commerce-Dashboard-main", "C:\Atlas")) {
    if (Test-Path -LiteralPath (Join-Path $extra "backend\package.json")) {
      return [pscustomobject]@{
        Kind = "repo"
        Root = $extra
        Dest = $extra
        Stamp = (Join-Path $extra ".plancia-commit")
      }
    }
    if (Test-Path -LiteralPath (Join-Path $extra "app\backend\package.json")) {
      return [pscustomobject]@{
        Kind = "pack"
        Root = $extra
        Dest = (Join-Path $extra "app")
        Stamp = (Join-Path $extra ".plancia-commit")
      }
    }
  }
  return $null
}

try {
  try { Set-Content -LiteralPath $LogFile -Value "" -ErrorAction SilentlyContinue } catch {}
  try { Set-Content -LiteralPath $TempLog -Value "" -ErrorAction SilentlyContinue } catch {}

  Show-Banner "AGGIORNAMENTO PLANCIA DA GITHUB (main)" "Cyan"
  Write-Log "Cartella script: $ScriptDir"

  $install = Resolve-Install
  if (-not $install) {
    Show-Banner "AGGIORNAMENTO FALLITO" "Red"
    Write-Log "ERRORE: cartella progetto non trovata (serve backend\package.json oppure app\backend\package.json)."
    Write-Host "Metti Plancia in C:\Atlas oppure usa la cartella estratta da Plancia-Locale.zip" -ForegroundColor Yellow
    if ($Interactive) {
      Write-Host ""
      Write-Host "Premi INVIO per chiudere..." -ForegroundColor Cyan
      try { [void][Console]::ReadLine() } catch { cmd /c pause }
    }
    exit 1
  }

  Write-Log ("Tipo installazione: " + $install.Kind)
  Write-Log ("Destinazione: " + $install.Dest)

  $headers = @{ "User-Agent" = "plancia-forza-aggiornamento"; "Accept" = "application/vnd.github+json" }
  Write-Log "Controllo commit su GitHub main..."
  $sha = [string](Invoke-RestMethod -Uri "https://api.github.com/repos/$RepoSlug/commits/$Branch" -Headers $headers -TimeoutSec 30).sha
  if (-not $sha) { throw "SHA remoto assente" }
  Write-Log "Commit remoto: $sha"

  $prev = if (Test-Path -LiteralPath $install.Stamp) { (Get-Content -LiteralPath $install.Stamp -Raw).Trim() } else { "" }
  if ($Interactive -and $prev -eq $sha) {
    Write-Log "Gia' al commit corrente — forzo comunque il download perche' hai chiesto FORZA-AGGIORNAMENTO."
  } elseif (-not $Interactive -and $prev -eq $sha) {
    Show-Banner "GIA' AGGIORNATO" "Green"
    Write-Log "Nessun download: locale gia' = $sha"
    Write-Host "Puoi aprire la plancia normalmente." -ForegroundColor Green
    exit 0
  }

  $tmp = Join-Path $env:TEMP ("plancia-force-" + [guid]::NewGuid().ToString("n"))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $zip = Join-Path $tmp "main.zip"
  Write-Log "Download ZIP main in corso (puo' richiedere un minuto)..."
  Invoke-WebRequest -Uri "https://api.github.com/repos/$RepoSlug/zipball/$Branch" -Headers $headers -OutFile $zip -TimeoutSec 600
  Write-Log "Estrazione ZIP..."
  Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
  $extracted = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1
  if (-not $extracted) { throw "ZIP estratto ma vuoto" }

  $envPath = Join-Path $install.Dest "backend\.env"
  $envBackup = $null
  if (Test-Path -LiteralPath $envPath) {
    $envBackup = Get-Content -LiteralPath $envPath -Raw -ErrorAction SilentlyContinue
  }

  Write-Log "Copia file nuovi sulla cartella locale..."
  foreach ($name in @("backend", "public", "DEPLOY_PIANCIA", "docs")) {
    $src = Join-Path $extracted.FullName $name
    if (-not (Test-Path -LiteralPath $src)) { continue }
    $dest = Join-Path $install.Dest $name
    Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force
    Write-Log "  OK: $name"
  }

  if ($null -ne $envBackup) {
    $bd = Join-Path $install.Dest "backend"
    if (-not (Test-Path -LiteralPath $bd)) { New-Item -ItemType Directory -Force -Path $bd | Out-Null }
    Set-Content -LiteralPath $envPath -Value $envBackup -NoNewline
    Write-Log "Conservato backend\.env locale."
  }

  Set-Content -LiteralPath $install.Stamp -Value $sha -NoNewline
  try { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue } catch {}

  $check = Join-Path $install.Dest "backend\public\js\atlasMemoryGraphUi.js"
  $hasBrain = $false
  if (Test-Path -LiteralPath $check) {
    $hasBrain = Select-String -LiteralPath $check -Pattern "layoutBrainShape|cervello neurale" -Quiet
  }
  if ($hasBrain) {
    Write-Log "Verifica OK: trovato cervello neurale / layoutBrainShape nel file aggiornato."
  } else {
    Write-Log "AVVISO: file aggiornato ma layoutBrainShape non trovato — controlla il percorso."
  }

  Show-Banner "AGGIORNAMENTO RIUSCITO" "Green"
  Write-Log "Completato. SHA=$sha"
  Write-Host "Ora chiudi questa finestra e fai DOPPIO CLIC su AVVIA-PLANCIA." -ForegroundColor Green
  Write-Host "Poi nel browser premi Ctrl+F5 su http://127.0.0.1:8787" -ForegroundColor Green
  if ($Interactive) {
    Write-Host ""
    Write-Host "Premi INVIO per chiudere..." -ForegroundColor Cyan
    try { [void][Console]::ReadLine() } catch { cmd /c pause }
  }
  exit 0
}
catch {
  Show-Banner "AGGIORNAMENTO FALLITO" "Red"
  Write-Log ("ERRORE: " + $_.Exception.Message)
  Write-Host "La plancia usera' i file locali vecchi finche' l'aggiornamento non riesce." -ForegroundColor Yellow
  Write-Host "Serve internet. Se il repo e' privato, serve accesso GitHub." -ForegroundColor Yellow
  Write-Host ("Log: " + $LogFile) -ForegroundColor DarkGray
  Write-Host ("Log: " + $TempLog) -ForegroundColor DarkGray
  if ($Interactive) {
    Write-Host ""
    Write-Host "Premi INVIO per chiudere..." -ForegroundColor Cyan
    try { [void][Console]::ReadLine() } catch { cmd /c pause }
  }
  exit 1
}
