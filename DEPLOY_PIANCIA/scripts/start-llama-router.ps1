# Avvio llama-server per Qwen3-8B Q4_K_M — router voce full-GPU (porta 8070).
# Niente -ncmoe, niente MTP, thinking OFF, ctx corto.

[CmdletBinding()]
param(
    [string]$EnvFile = "",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $EnvFile) {
    $EnvFile = Join-Path $Root "config\llama-router.env"
}

function Read-DotEnv {
    param([string]$Path)
    $map = @{}
    if (-not (Test-Path $Path)) {
        throw "File env mancante: $Path`nCopia config\llama-router.env.example come config\llama-router.env"
    }
    Get-Content -Path $Path -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $idx = $line.IndexOf("=")
        if ($idx -lt 1) { return }
        $key = $line.Substring(0, $idx).Trim()
        $val = $line.Substring($idx + 1).Trim().Trim('"')
        $map[$key] = $val
    }
    return $map
}

$cfg = Read-DotEnv -Path $EnvFile

function Require([string]$Key) {
    if (-not $cfg.ContainsKey($Key) -or [string]::IsNullOrWhiteSpace($cfg[$Key])) {
        throw "Variabile obbligatoria mancante: $Key"
    }
    return $cfg[$Key]
}

$bin   = Require "LLAMA_SERVER_BIN"
$model = Require "LLAMA_MODEL"
$host_ = if ($cfg["LLAMA_HOST"]) { $cfg["LLAMA_HOST"] } else { "127.0.0.1" }
$port  = if ($cfg["LLAMA_PORT"]) { [int]$cfg["LLAMA_PORT"] } else { 8070 }
$ngl   = if ($cfg["N_GPU_LAYERS"]) { [int]$cfg["N_GPU_LAYERS"] } else { 99 }
$ctx   = if ($cfg["CTX_SIZE"]) { [int]$cfg["CTX_SIZE"] } else { 2048 }
$npred = if ($cfg["N_PREDICT"]) { [int]$cfg["N_PREDICT"] } else { 96 }
$temp  = if ($cfg["TEMPERATURE"]) { $cfg["TEMPERATURE"] } else { "0.4" }
$top_p = if ($cfg["TOP_P"]) { $cfg["TOP_P"] } else { "0.9" }
$rpen  = if ($cfg["REPEAT_PENALTY"]) { $cfg["REPEAT_PENALTY"] } else { "1.1" }
$thr   = if ($cfg["THREADS"]) { [int]$cfg["THREADS"] } else { 8 }
$thrb  = if ($cfg["THREADS_BATCH"]) { [int]$cfg["THREADS_BATCH"] } else { $thr }
$noThink = if ($cfg["DISABLE_THINKING"]) { $cfg["DISABLE_THINKING"] } else { "1" }
$apiKey = if ($cfg["API_KEY"]) { $cfg["API_KEY"] } else { "" }

if ($cfg.ContainsKey("N_CPU_MOE") -and -not [string]::IsNullOrWhiteSpace($cfg["N_CPU_MOE"])) {
    Write-Warning "N_CPU_MOE e' impostato sul router denso: verra' ignorato."
}
if ($cfg.ContainsKey("DRAFT_MODEL") -and -not [string]::IsNullOrWhiteSpace($cfg["DRAFT_MODEL"])) {
    throw "DRAFT_MODEL vietato sul router. Rimuovilo da llama-router.env."
}
if (-not (Test-Path $bin)) { throw "llama-server non trovato: $bin" }
if (-not (Test-Path $model)) { throw "GGUF router non trovato: $model" }

$argsList = @(
    "-m", $model,
    "--host", $host_,
    "--port", "$port",
    "-ngl", "$ngl",
    "-c", "$ctx",
    "-n", "$npred",
    "--temp", "$temp",
    "--top-p", "$top_p",
    "--repeat-penalty", "$rpen",
    "-t", "$thr",
    "-tb", "$thrb",
    "-np", "1",
    "--flash-attn",
    "--no-warmup"
)

if ($noThink -eq "1") {
    $argsList += @("--chat-template-kwargs", '{"enable_thinking":false}')
}
if ($apiKey) {
    $argsList += @("--api-key", $apiKey)
}

Write-Host "=== Router plancia: Qwen3-8B full-GPU ===" -ForegroundColor Cyan
Write-Host "LISTEN: http://${host_}:${port}/v1  (-ngl $ngl, no ncmoe, thinking=off)"

if ($DryRun) {
    Write-Host "DryRun:" ($bin + " " + ($argsList -join " "))
    exit 0
}

& $bin @argsList
exit $LASTEXITCODE
