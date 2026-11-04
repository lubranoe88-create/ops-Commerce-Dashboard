# Qwen locale per plancia vocale (Windows)

Pacchetto di preparazione per far girare **Qwen3.6-35B-A3B** (o **Qwen3.5-35B-A3B**) in **Q4_K_M** su PC Windows:

- GPU: **RTX 5070 Blackwell 12 GB VRAM**
- RAM: **32 GB**
- Runtime: **llama.cpp** `llama-server` (API OpenAI-compatible)
- Policy voce: **thinking OFF**, **niente MTP**, contesto **2–8k**, expert MoE su CPU

> Questo README non esegue nulla da solo: sono istruzioni per il PC Windows dell’utente.

Documenti principali:

- **[RIEPILOGO.md](./RIEPILOGO.md)** — contesto chiamata e verdetto
- **[CHECKLIST.md](./CHECKLIST.md)** — passi ordinati sul PC Windows
- **[CONFIG_LOCALE.md](./CONFIG_LOCALE.md)** — flag esatti del cervello 35B-A3B
- **[ROUTER_PICCOLO.md](./ROUTER_PICCOLO.md)** — Qwen3-8B full-GPU + fallback automatico al 35B

## 1. Installare llama.cpp su Windows (CUDA)

1. Installa **Git**, **CMake**, **Visual Studio Build Tools** (C++), driver **NVIDIA** aggiornati, **CUDA Toolkit** compatibile con la build.
2. Clona e compila (esempio):

```bat
git clone https://github.com/ggerganov/llama.cpp C:\Tools\llama.cpp
cd C:\Tools\llama.cpp
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release -t llama-server
```

3. Verifica che esista qualcosa come:

`C:\Tools\llama.cpp\build\bin\Release\llama-server.exe`

## 2. Scaricare il GGUF Q4_K_M

Scarica un quant **Q4_K_M** (o **UD-Q4_K_M** / **UD-Q4_K_XL** Unsloth) di:

- Preferito produzione: **Qwen3.5-35B-A3B**
- Alternativa già studiata: **Qwen3.6-35B-A3B**

Esempio Hugging Face (adatta il repo al file reale al momento del download):

- `unsloth/Qwen3.6-35B-A3B-GGUF` → file `*Q4_K_M*.gguf`

Salvalo in un path fisso, es.:

`C:\Models\Qwen3.6-35B-A3B-Q4_K_M.gguf`

Serve ~**21–23 GB** di disco + margine per cache/OS sul 1 TB.

## 3. Configurare l’env

```bat
cd qwen-plancia-local
copy config\llama-server.env.example config\llama-server.env
notepad config\llama-server.env
```

Imposta almeno:

- `LLAMA_SERVER_BIN=...llama-server.exe`
- `LLAMA_MODEL=...Q4_K_M.gguf`
- `N_GPU_LAYERS=99`
- `N_CPU_MOE=40`
- `CTX_SIZE=4096` (oppure 2048 / 8192)
- `DISABLE_THINKING=1`
- **non** impostare `DRAFT_MODEL` (niente MTP)

## 4. Avviare il server

Doppio click / da prompt:

```bat
scripts\start-llama-server.bat
```

Oppure:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-llama-server.ps1
```

Dry-run (stampa comando senza avviare):

```powershell
.\scripts\start-llama-server.ps1 -DryRun
```

Endpoint locale atteso:

`http://127.0.0.1:8080/v1/chat/completions`

## 5. Validatore tool + client di esempio

```bat
cd host
npm install
npm test
npm run client
```

Il client chiama il server locale e **blocca** tool non in allowlist o con JSON schema errato (`host/schema_validator.js` + `host/tool_schemas/plancia_tools.json`).

## Flag chiave (riepilogo)

| Flag | Valore tipico | Perché |
|------|---------------|--------|
| `-ngl` | `99` | layer su GPU |
| `-ncmoe` / `--n-cpu-moe` | `40` | expert MoE in RAM sistema |
| `-c` | `2048`–`8192` | ctx corto per voce |
| thinking | off | latenza + meno loop |
| MTP / draft | **disabilitato** | tool-calling più stabile |

## Note plancia

Collegare la plancia al server locale **non** avviene aprendo solo Cursor: serve che il backend della plancia usi un base URL tipo `http://127.0.0.1:8080/v1` (o un proxy) al posto di OpenRouter/remoto. Dettagli di integrazione: vedere ricerca config nel repo plancia e `RIEPILOGO.md`.
