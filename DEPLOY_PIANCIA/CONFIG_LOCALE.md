# CONFIG_LOCALE — runtime locale plancia (LM Studio su Bionic)

Profilo **voce plancia**: latenza e stabilità tool prima del contesto lungo.

## Runtime attuale (Emilio)

| Voce | Valore |
|------|--------|
| Motore | **LM Studio** sul desktop **Bionic** (Ubuntu 24.04) |
| Host LAN | `bionic.local` (mDNS) → fallback `bionic` |
| Porta UI/API | **23000** (browser: `http://localhost:23000`) |
| Base URL plancia | `http://bionic.local:23000/v1` |
| Modello | Qwen 3.x 35B-A3B (GGUF Q4_K_M o equivalente caricato in LM Studio) |
| Env | `LOCAL_LLM_*` in `PROGETTO_LOCALE/env.plancia-locale.example` |

**Non** usare `127.0.0.1` sul server Cursor/cloud: LM Studio non è lì.  
Dettaglio collegamento: **`COLLEGAMENTO_PLANCIA.md`**.

---

## Alternativa: flag llama.cpp (se non usi LM Studio)

Modello primario (cervello): **Qwen3.5-35B-A3B** (alternativa: Qwen3.6-35B-A3B)  
Quant: **Q4_K_M** (accettabili UD-Q4_K_M / UD-Q4_K_XL Unsloth)

Router piccolo (documento dedicato): **`ROUTER_PICCOLO.md`** + `config/llama-router.env.example`  
Qwen3-8B Q4_K_M full-GPU, porta **8070**, **senza** `-ncmoe`.

---

## Valori esatti consigliati

| Parametro | Flag CLI | Valore | Note |
|-----------|----------|--------|------|
| GPU layers | `-ngl` / `--n-gpu-layers` | **99** | Offload massimo dei layer; gli expert MoE sono gestiti a parte |
| Expert su CPU | `-ncmoe` / `--n-cpu-moe` | **40** | Tipico per Qwen3.x 35B-A3B (~40 layer MoE): expert in RAM sistema |
| Contesto | `-c` / `--ctx-size` | **4096** | Default voce. Alternative: **2048** (più snello) o **8192** (max consigliato voce) |
| Max token out | `-n` / `--n-predict` | **256** | Risposte corte per TTS |
| Temperature | `--temp` | **0.6** | Bilanciata per italiano parlato |
| Top-p | `--top-p` | **0.95** | |
| Repeat penalty | `--repeat-penalty` | **1.1** | Riduce loop |
| Thread | `-t` | **8** | Adatta ai core CPU; lascia headroom a STT/TTS/OS |
| Thread batch | `-tb` | **8** | Allineato a `-t` se non sai diversamente |
| Slot paralleli | `-np` | **1** | Una sessione voce stabile |
| Flash attention | `--flash-attn` | **on** | Se supportato dalla build CUDA |
| Thinking | `--chat-template-kwargs` | **`{"enable_thinking":false}`** | **Thinking OFF** obbligatorio in voce |
| Host | `--host` | **127.0.0.1** | Solo locale |
| Port | `--port` | **8080** | |
| MTP / draft | *(nessun flag draft)* | **OFF** | **Non** passare modello draft / speculative |

---

## Esempio comando completo

```bat
llama-server.exe ^
  -m C:\Models\Qwen3.5-35B-A3B-Q4_K_M.gguf ^
  --host 127.0.0.1 --port 8080 ^
  -ngl 99 ^
  -ncmoe 40 ^
  -c 4096 ^
  -n 256 ^
  --temp 0.6 ^
  --top-p 0.95 ^
  --repeat-penalty 1.1 ^
  -t 8 -tb 8 ^
  -np 1 ^
  --flash-attn ^
  --chat-template-kwargs "{\"enable_thinking\":false}"
```

Lo script `scripts\start-llama-server.ps1` costruisce questo comando da `config\llama-server.env`.

---

## Contesto: quale scegliere

| CTX | Quando |
|-----|--------|
| **2048** | Turni cortissimi, massima VRAM libera |
| **4096** | **Default plancia vocale** |
| **8192** | Serve più storia conversazione; monitora VRAM/KV |
| **>8192** | **Non** per profilo voce su 12 GB |

---

## Rete di sicurezza “thinking off”

Anche con `enable_thinking:false`, il client di esempio aggiunge `/no_think` al messaggio utente.  
Non mostrare eventuali blocchi di ragionamento all’interfaccia vocale.

---

## Cosa non mettere in config

- `DRAFT_MODEL` / speculative / MTP  
- `--host 0.0.0.0` senza autenticazione (evitare esposizione LAN)  
- Contesti 32k–128k “perché si può” in sessione voce  
- Quant sotto Q4 se la qualità tool decade (meglio restare su Q4_K_M)

---

## Stima risorse

| Risorsa | Atteso |
|---------|--------|
| Disco GGUF | ~**21–23 GB** |
| VRAM | vicino al **limite 12 GB** (attenzione + path attivi + KV) |
| RAM sistema | expert offload + OS: tipico uso elevato su **32 GB** (chiudi browser pesanti in test) |
| Endpoint | `http://127.0.0.1:8080/v1/chat/completions` |

Se OOM VRAM: abbassa `CTX_SIZE` a 2048, verifica `-ncmoe 40`, chiudi altri processi GPU.  
Se troppo lento: aumenta thread con cautela; verifica che CUDA sia davvero usata (`nvidia-smi` durante inferenza).
