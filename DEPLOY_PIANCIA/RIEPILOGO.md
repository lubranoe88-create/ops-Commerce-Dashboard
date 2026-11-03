# Riepilogo — LLM locale per la plancia vocale

Documento autonomo: si legge anche senza aver seguito la chiamata.  
Hardware target, problema, classifica modelli, verdetto, deploy e cosa evitare.

---

## 1. Hardware del PC Windows

| Voce | Valore |
|------|--------|
| Macchina | **MSI Infinity S3 2026** |
| GPU | **NVIDIA RTX 5070 Blackwell** |
| VRAM | **12 GB** |
| RAM di sistema | **32 GB** |
| Storage | **1 TB** |
| Sistema | Windows |
| Runtime consigliato | **llama.cpp** (`llama-server`) con CUDA + expert offload MoE |

Su questa macchina i modelli **densi 32B+** in split VRAM/RAM diventano troppo lenti per la voce. I **MoE con pochi parametri attivi** (≈2–4B) restano usabili perché solo una frazione dei pesi lavora a ogni token; il resto degli expert può stare in RAM.

---

## 2. Problema originale

Sulla plancia vocale è stato valutato **Qwen3 32B** (denso).  
Con offload aggressivo su 12 GB VRAM + 32 GB RAM la generazione cadeva a circa **3–8 token/s**: percepito come “modello in sforzo”, pause lunghe, esperienza vocale inutilizzabile.

Obiettivo aggiornato: massima qualità **realmente usabile in voce**, con split VRAM/RAM, buon italiano, tool-calling affidabile, privacy locale — per un agente che **gestisce persone in produzione**.

---

## 3. Classifica top 5 (con dettagli)

Per ogni modello: **parametri totali / attivi**, architettura, note su contesto, quant, VRAM/RAM, velocità attesa, italiano, tool-calling, licenza, aderenza produzione.

### 1) Qwen3.6-35B-A3B (e famiglia Qwen3.5 MoE)

| Campo | Dettaglio |
|-------|-----------|
| Tot / Attivi | **~35B / ~3B** |
| Architettura | **MoE** (expert offload su CPU) |
| Contesto | fino a finestre molto lunghe in card; **in voce usare 2–8k** |
| Quant | **Q4_K_M** (o UD-Q4_K_M / UD-Q4_K_XL) |
| VRAM / RAM | attenzione+attivi ≈ **10–12 GB** VRAM; expert in **RAM** (GGUF ~21–23 GB su disco) |
| Velocità | su GPU 12 GB simili: decine di tok/s con `-ncmoe` (report community fino a ~40–80+ a seconda di quant/flag) |
| Italiano | forte |
| Tool-calling | buono; su **3.6** in run lunghi segnalati loop / tool malformati (MTP peggiora) |
| Licenza | **Apache 2.0** |
| Produzione | **usabile** con thinking OFF, no MTP, validazione host; per affidabilità agent molti preferiscono **Qwen3.5-35B-A3B** |

### 2) Gemma 4 26B-A4B

| Campo | Dettaglio |
|-------|-----------|
| Tot / Attivi | **~26B / ~4B** |
| Architettura | **MoE** |
| Contesto | fino a **256k** (non necessario in voce) |
| Quant | Q4_K_M / equivalenti |
| VRAM / RAM | simile profilo MoE “fit + offload” |
| Velocità | buona per MoE a 4B attivi |
| Italiano | **ottimo** (multilingue Google) |
| Tool-calling | **inconsistente** (format, stabilità overnight) |
| Licenza | **Apache 2.0** (Gemma 4) |
| Produzione | ottimo **dialogo**; meno adatto come unico cervello tool-heavy |

### 3) GLM-4.7-Flash (30B-A3B)

| Campo | Dettaglio |
|-------|-----------|
| Tot / Attivi | **~30B / ~3B** |
| Architettura | **MoE** |
| Contesto | ampio (card vendor) |
| Quant | Q4 family |
| VRAM / RAM | teoricamente simile agli altri MoE A3B |
| Velocità / stabilità | community: lentezza, looping, quant fragili |
| Italiano | accettabile |
| Tool-calling | parser dedicato ma **poco affidabile** in pratica |
| Licenza | **MIT** |
| Produzione | **non** come primario oggi |

### 4) gpt-oss-20b

| Campo | Dettaglio |
|-------|-----------|
| Tot / Attivi | **~20,9B / ~3,6B** |
| Architettura | **MoE** |
| Contesto | tipico stack OpenAI-compat |
| Quant | MXFP4 / GGUF a seconda del canale |
| VRAM / RAM | **stretto** su 12 GB |
| Velocità | buona se entra |
| Italiano | discreto su MMMLU-like |
| Tool-calling | **molto forte** in formato |
| Licenza | Apache 2.0 + **usage policy** (limiti su consigli regolati) |
| Produzione | **allucinazioni alte** su fatti → **no come solo modello** verso utenti |

### 5) Nemotron 3.5 Lightning / LFM2.5-24B-A2B

**Nemotron Lightning (~30B / ~3B, MoE ibrido, OpenMDW)**  
Italiano dichiarato; pensato per agent worker NVIDIA. In pratica footprint tipico **oltre 12 GB** (stime ~25 GB+ anche in Q4 / path NIM) → **fuori hardware** della 5070 12 GB.

**LFM2.5-24B-A2B (~24B / ~2–2,5B, MoE, LFM Open)**  
Velocissimo e “agent-oriented”, ma **reasoning spesso sempre attivo** (latenza voce) e licenza con **soglia revenue (~$10M)** → non default senza clearance legale.

---

## 4. Verdetto finale (produzione con persone)

**Primario consigliato:** **Qwen3.5-35B-A3B** in **Q4_K_M** via **llama.cpp**, non il solo “benchmark più alto”.

Motivo: su carichi agent/tool la community e i report indipendenti indicano **Qwen3.5 più affidabile** di **Qwen3.6** (meno loop, migliore obedience). Qwen3.6 resta un’alternativa potente se si applicano i vincoli sotto.

**Stack operativo obbligatorio:**

1. **Router piccolo** — **Qwen3-8B** o **14B** full-GPU per triage / chat corta / bassa latenza  
2. **Cervello MoE** — Qwen3.5-35B-A3B (o 3.6 con vincoli) per turni difficili  
3. **Validazione tool host-side** — allowlist + JSON Schema **prima** di eseguire  
4. **Thinking OFF** in voce  
5. **Niente MTP / speculative decoding** sui turni con tool  
6. Contesto corto **2–8k**  
7. Orchestrazione a **regole/FSM** per azioni critiche (non solo “il modello decide”)

Privacy: inferenza **self-host** sul PC → niente invio chat al cloud se non configurato altrimenti.

---

## 5. Passaggi deploy sul PC (sintesi)

Dettaglio operativo in `CHECKLIST.md`, `CONFIG_LOCALE.md`, `README.md`.

1. Aggiornare Windows / driver NVIDIA  
2. Installare e compilare **llama.cpp** con CUDA (`llama-server`)  
3. Scaricare GGUF **Qwen3.5-35B-A3B Q4_K_M** da Hugging Face  
4. Copiare `llama-server.env.example` → `llama-server.env` e impostare percorsi  
5. Avviare `scripts\start-llama-server.bat` (flag già tarati per split VRAM/RAM)  
6. `cd host && npm install && npm test && npm run client`  
7. Solo dopo: collegare la plancia all’URL locale `http://127.0.0.1:8080/v1` (non basta aprire Cursor)

---

## 6. Stack ibrido raccomandato

```
Microfono → STT (es. Whisper) → [FSM / regole plancia]
                                    ↓
                         Heuristica host (+ opz. classificazione)
                                    ↓
              Qwen3-8B Q4_K_M full-GPU (:8070)     Qwen3.5-35B-A3B (:8080)
              saluti / FAQ / small-talk            turni complessi + tool
                                    ↓
                         Validatore schema tool (host)  ← solo sul brain
                                    ↓
                         Tool allowlist / conferma umana
                                    ↓
                         TTS → altoparlante
```

**Router piccolo (dettaglio operativo):** vedi **`ROUTER_PICCOLO.md`**.

- Modello: **Qwen3-8B Q4_K_M**, full-GPU (`-ngl 99`, niente `-ncmoe`), porta **8070**, ctx **2048**, thinking OFF  
- Fallback automatico al **35B-A3B** su tool, ambiguità, multi-step, rischio, bassa confidenza  
- Logica: `host/router_logic.js` — modi `heuristic` | `llm` | **`hybrid`** (default)  
- Esempio end-to-end: `client/hybrid_voice_client.mjs`  
- Attenzione: **12 GB VRAM** — misurare se 8B + 35B coesistono; strategie A–D in `ROUTER_PICCOLO.md`

Principi:

- Cascata **STT → LLM → TTS** (non speech-to-speech monolitico)  
- Regole deterministiche prima del modello sulle azioni pericolose  
- Router per latenza sub-secondo; MoE per qualità  
- Il router **non** esegue tool  
- Mai mostrare CoT / `<think>` grezzo all’utente  
- Un solo slot parallelo per processo voce (`-np 1`)

---

## 7. Cosa NON usare (in questo contesto)

| Da evitare | Perché |
|------------|--------|
| **GLM-4.7-Flash come primario** | looping / stabilità consumer scarsa |
| **gpt-oss-20b da solo** verso utenti | allucinazioni + policy su consigli sensibili |
| **LFM2.5 senza clearance legale** | licenza revenue; latenza reasoning |
| **Nemotron Lightning su 12 GB** | fuori footprint tipico |
| **Fork uncensored / “abliterated”** | inappropriati per gestire persone in produzione |
| **Qwen3 32B denso** come prima | già dimostrato in sforzo sulla voce |
| **MTP / draft model** | peggiora affidabilità tool-call |
| **Thinking ON in voce** | latenza e loop |

---

## File in questa cartella

Vedi elenco in fondo a `CHECKLIST.md` oppure l’albero in `README.md`.  
Pacchetto pensato per **copia sul PC Windows**; nessuna esecuzione automatica dal cloud agent sul PC utente.
