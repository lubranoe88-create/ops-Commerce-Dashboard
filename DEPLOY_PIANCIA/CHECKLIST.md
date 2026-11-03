# Checklist — deploy sul PC Windows (plancia vocale)

Segui i passi **in ordine**. Spunta a mano.  
Non richiede Cursor aperto: Cursor non sostituisce il server LLM locale.

---

## A. Sistema e driver

- [ ] **Windows aggiornato** (aggiornamenti completati, reboot se richiesto)
- [ ] Driver **NVIDIA** recenti per **RTX 5070** installati
- [ ] Verifica GPU: in PowerShell `nvidia-smi` mostra la 5070 e **~12 GB** VRAM
- [ ] Verifica RAM: Task Manager → circa **32 GB**
- [ ] Spazio libero su disco: almeno **~40 GB** (GGUF ~22 GB + build + margine)

---

## B. Tool di build (llama.cpp)

- [ ] Installato **Git for Windows**
- [ ] Installato **CMake**
- [ ] Installato **Visual Studio Build Tools** con workload C++
- [ ] Installato **CUDA Toolkit** compatibile con la build llama.cpp scelta
- [ ] Clonato llama.cpp (es. `C:\Tools\llama.cpp`)
- [ ] Build Release con CUDA, target `llama-server`
- [ ] Esiste `llama-server.exe` (path annotato)

Comandi di riferimento (adatta i path):

```bat
git clone https://github.com/ggerganov/llama.cpp C:\Tools\llama.cpp
cd C:\Tools\llama.cpp
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release -t llama-server
```

---

## C. Download modelli (cervello + router)

- [ ] Account Hugging Face se il repo lo richiede
- [ ] Scaricato **Qwen3.5-35B-A3B** quant **Q4_K_M** (GGUF) — cervello
  - Alternativa studiata: Qwen3.6-35B-A3B Q4_K_M / UD-Q4_K_M
- [ ] File salvato in path fisso, es. `C:\Models\Qwen3.5-35B-A3B-Q4_K_M.gguf`
- [ ] Scaricato **Qwen3-8B** quant **Q4_K_M** (GGUF) — router full-GPU
- [ ] File router es. `C:\Models\Qwen3-8B-Q4_K_M.gguf`
- [ ] Verificata integrità/size dei file (non download troncati)
- [ ] Letto `ROUTER_PICCOLO.md` (strategie VRAM se entrambi residenti)

---

## D. Configurazione split VRAM / RAM (questa cartella)

- [ ] Copiata l’intera cartella `DEPLOY_PIANCIA` sul PC (es. `C:\DEPLOY_PIANCIA`)
- [ ] Eseguito: `copy config\llama-server.env.example config\llama-server.env`
- [ ] In `config\llama-server.env` impostati:
  - [ ] `LLAMA_SERVER_BIN=...llama-server.exe`
  - [ ] `LLAMA_MODEL=...Q4_K_M.gguf`
  - [ ] `N_GPU_LAYERS=99`
  - [ ] `N_CPU_MOE=40`
  - [ ] `CTX_SIZE=4096` (o 2048 / 8192)
  - [ ] `DISABLE_THINKING=1`
  - [ ] **Nessun** `DRAFT_MODEL` (niente MTP)
- [ ] Letto `CONFIG_LOCALE.md` per i flag esatti

---

## E. Avvio server locali (cervello + router)

- [ ] Cervello: `scripts\start-llama-server.bat` → `http://127.0.0.1:8080/v1`
- [ ] (Opzionale) dry-run cervello: `.\scripts\start-llama-server.ps1 -DryRun`
- [ ] Log cervello senza OOM; modello 35B caricato
- [ ] `copy config\llama-router.env.example config\llama-router.env` e path 8B
- [ ] Router: `scripts\start-llama-router.bat` → `http://127.0.0.1:8070/v1`
- [ ] Se OOM con entrambi attivi: applica strategia C o D in `ROUTER_PICCOLO.md`

---

## F. Test validatore e client

- [ ] Installato **Node.js ≥ 20**
- [ ] `cd host`
- [ ] `npm install`
- [ ] `npm test` → self-test OK
- [ ] Con cervello avviato: `npm run client`
- [ ] Il client risponde; eventuali tool fuori schema risultano **BLOCCATI**
- [ ] Con router (+ cervello se possibile): `node ../client/hybrid_voice_client.mjs "Ciao"` → route router
- [ ] `node ../client/hybrid_voice_client.mjs "Cerca in memoria l'ultimo deploy"` → route brain

---

## G. Collegamento plancia (dopo che A–F funzionano)

- [ ] Capito che **aprire Cursor non basta** a far parlare la plancia col modello locale
- [ ] Configurato il backend plancia (env / pannello / proxy) verso  
  `http://127.0.0.1:8080/v1` (OpenAI-compatible) **oppure** un bridge dedicato
- [ ] Se la plancia oggi usa **OpenRouter** / chiavi remote: punto di switch = base URL + modello lato server plancia, non “magia” IDE
- [ ] Test voce end-to-end: STT → risposta locale → TTS
- [ ] Tool critici ancora dietro conferma / FSM plancia

---

## H. Policy produzione (check finale)

- [ ] Thinking **OFF** in voce
- [ ] MTP **OFF**
- [ ] Ctx **≤ 8192** in profilo voce
- [ ] Nessun fork uncensored
- [ ] Logging errori tool lato host attivo
- [ ] Backup del file `llama-server.env` (senza committere segreti)

---

## Ordine minimo “primo successo”

1. Windows + driver  
2. llama-server CUDA  
3. GGUF Qwen3.5-35B-A3B Q4_K_M  
4. `llama-server.env`  
5. `start-llama-server.bat`  
6. `npm test` + `npm run client`  
7. Collegamento plancia  

Se qualcosa fallisce, fermati al passo e non saltare al collegamento plancia.
