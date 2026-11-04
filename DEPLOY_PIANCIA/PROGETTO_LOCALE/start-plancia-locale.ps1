# Start full Atlas stack on this PC (UI + API + local brain).
# Render site stays online separately — this is the local source of truth for memory.
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Backend = Join-Path $Root "backend"
if (-not (Test-Path (Join-Path $Backend "package.json"))) {
  Write-Error "backend/package.json not found at $Backend"
}

Set-Location $Backend
$env:HOST = if ($env:HOST) { $env:HOST } else { "127.0.0.1" }
$env:PORT = if ($env:PORT) { $env:PORT } else { "8787" }
if (-not $env:ATLAS_MEMORY_DIR) {
  $env:ATLAS_MEMORY_DIR = (Join-Path $Backend "data\agentq-memory")
}
New-Item -ItemType Directory -Force -Path $env:ATLAS_MEMORY_DIR | Out-Null

Write-Host "ATLAS_MEMORY_DIR=$($env:ATLAS_MEMORY_DIR)"
Write-Host "Open http://127.0.0.1:$($env:PORT) after listen (local brain, not Render)."
npm start
