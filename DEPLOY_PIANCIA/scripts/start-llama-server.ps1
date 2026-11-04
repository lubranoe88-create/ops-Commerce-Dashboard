# Avvio llama-server per Qwen3.6-35B-A3B (Q4_K_M) — profilo plancia vocale.
# Requisiti: Windows, NVIDIA driver, llama.cpp build con CUDA, GGUF locale.
# Policy: thinking OFF, niente MTP/speculative, ctx corto, MoE expert su CPU.

[CmdletBinding()]
param(
    [string]$EnvFile = "",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $EnvFile) {
    $EnvFile = Join-Path $Root "config\llama-server.env"
}

function Read-DotEnv {
    param([string]$Path)
    $map = @{}
    if (-not (Test-Path $Path)) {
        throw "File env mancante: $Path`nCopia config\llama-server.env.example come config\llama-server.env e imposta i percorsi."
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
        throw "Variabile obbligatoria mancante in env: $Key"
    }
    return $cfg[$Key]
}

$bin   = Require "LLAMA_SERVER_BIN"
$model = Require "LLAMA_MODEL"
$host_ = if ($cfg["LLAMA_HOST"]) { $cfg["LLAMA_HOST"] } else { "127.0.0.1" }
$port  = if ($cfg["LLAMA_PORT"]) { [int]$cfg["LLAMA_PORT"] } else { 8080 }
$ngl   = if ($cfg["N_GPU_LAYERS"]) { [int]$cfg["N_GPU_LAYERS"] } else { 99 }
$ncmoe = if ($cfg["N_CPU_MOE"]) { [int]$cfg["N_CPU_MOE"] } else { 40 }
$ctx   = if ($cfg["CTX_SIZE"]) { [int]$cfg["CTX_SIZE"] } else { 4096 }
$npred = if ($cfg["N_PREDICT"]) { [int]$cfg["N_PREDICT"] } else { 256 }
$temp  = if ($cfg["TEMPERATURE"]) { $cfg["TEMPERATURE"] } else { "0.6" }
$top_p = if ($cfg["TOP_P"]) { $cfg["TOP_P"] } else { "0.95" }
$rpen  = if ($cfg["REPEAT_PENALTY"]) { $cfg["REPEAT_PENALTY"] } else { "1.1" }
$thr   = if ($cfg["THREADS"]) { [int]$cfg["THREADS"] } else { 8 }
$thrb  = if ($cfg["THREADS_BATCH"]) { [int]$cfg["THREADS_BATCH"] } else { $thr }
$noThink = if ($cfg["DISABLE_THINKING"]) { $cfg["DISABLE_THINKING"] } else { "1" }
$apiKey = if ($cfg["API_KEY"]) { $cfg["API_KEY"] } else { "" }

if ($cfg.ContainsKey("DRAFT_MODEL") -and -not [string]::IsNullOrWhiteSpace($cfg["DRAFT_MODEL"])) {
    throw "DRAFT_MODEL e' impostato: MTP/speculative e' vietato in questo profilo voce. Rimuovilo da llama-server.env."
}

if (-not (Test-Path $bin)) { throw "llama-server non trovato: $bin" }
if (-not (Test-Path $model)) { throw "GGUF non trovato: $model" }

if ($ctx -lt 2048 -or $ctx -gt 8192) {
    Write-Warning "CTX_SIZE=$ctx fuori dal range voce consigliato 2048-8192. Procedo comunque."
}

# Argomenti llama-server (OpenAI-compatible su /v1)
$argsList = @(
    "-m", $model,
    "--host", $host_,
    "--port", "$port",
    "-ngl", "$ngl",
    "-ncmoe", "$ncmoe",
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

# Thinking OFF per Qwen3.x (chat-template-kwargs JSON).
# Se la build non supporta il flag, rimuovilo e forza /no_think nel system prompt lato client.
if ($noThink -eq "1") {
    $argsList += @("--chat-template-kwargs", '{"enable_thinking":false}')
}

if ($apiKey) {
    $argsList += @("--api-key", $apiKey)
}

Write-Host "=== Plancia locale: Qwen3.6-35B-A3B ===" -ForegroundColor Cyan
Write-Host "BIN:    $bin"
Write-Host "MODEL:  $model"
Write-Host "LISTEN: http://${host_}:${port}/v1"
Write-Host "FLAGS:  -ngl $ngl  -ncmoe $ncmoe  -c $ctx  thinking=off  mtp=off"
Write-Host ""

if ($DryRun) {
    Write-Host "DryRun:" ($bin + " " + ($argsList -join " "))
    exit 0
}

& $bin @argsList
exit $LASTEXITCODE
