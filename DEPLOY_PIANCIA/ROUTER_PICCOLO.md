# Router piccolo — Qwen3-8B (full-GPU) + fallback 35B-A3B

Obiettivo: **latenza sub-secondo** su saluti e domande semplici, senza accendere il cervello MoE a ogni turno.  
Il router gira **full-GPU** (entra intero in 12 GB). Il **Qwen3.5-35B-A3B** resta il cervello per turni complessi.

Tutto self-host sul PC Windows. Solo preparazione file: nessuna esecuzione da questo documento.

---

## Ruoli

| Ruolo | Modello | Quant | Porta tipica | Caricamento |
|-------|---------|-------|--------------|-------------|
| **Router** | **Qwen3-8B** Instruct | **Q4_K_M** | `8070` | **Full-GPU** (`-ngl 99`, **senza** `-ncmoe`) |
| **Cervello** | **Qwen3.5-35B-A3B** | **Q4_K_M** | `8080` | GPU + **`--n-cpu-moe 40`** (vedi `CONFIG_LOCALE.md`) |

Endpoint:

- Router: `http://127.0.0.1:8070/v1/chat/completions`
- Cervello: `http://127.0.0.1:8080/v1/chat/completions`

---

## Quando resta sul router (turno “facile”)

Passa **solo** dal 8B se **tutte** queste condizioni sono vere:

1. Testo utente corto (consiglio: **≤ 220 caratteri** / ~40 parole)
2. Intent in: saluto, ringraziamento, conferma sì/no, small-talk, “ripeti”, “chiudi microfono” già coperto da FSM, domanda FAQ con risposta già in system prompt
3. **Nessun** bisogno evidente di tool (memoria, stato plancia, azioni write)
4. Nessuna richiesta multi-step (“prima controlla X poi Y”)
5. Nessun contenuto ad alto rischio (dati personali di terzi, decisioni irreversibili, medicale/legale/finanziario serio)
6. Score di confidenza del classificatore router ≥ soglia (default **0.75**)

Risposta attesa: **1–2 frasi**, `max_tokens` basso (**64–96**), thinking **OFF**.

---

## Quando fare fallback al cervello 35B-A3B

Inoltra al **35B** se **una qualsiasi** condizione è vera:

| Segnale | Esempio |
|---------|---------|
| Intent complesso | ragionamento, piano, confronto, spiegazione lunga |
| Tool richiesti | memoria, status, mic session, messaggi, qualsiasi function-call |
| Ambiguo | il router non classifica con confidenza ≥ 0.75 |
| Lungo / multi-turn denso | messaggio lungo, o storia che richiede più contesto |
| Sicurezza / persone | dubbi su fatti che riguardano utenti reali |
| Router chiede escalate | output strutturato `route=brain` |
| Errore router | timeout, 5xx, JSON di routing invalido |

Il cervello usa ctx **2–8k**, thinking **OFF**, **niente MTP**, e **validazione schema tool** (`host/schema_validator.js`) **prima** di eseguire qualsiasi tool.

---

## Logica di routing (algoritmo)

Implementazione di riferimento: `host/router_logic.js` e client `client/hybrid_voice_client.mjs`.

```
ingresso_utente
    │
    ├─(1) FSM / regole plancia ──match azione critica?──► esegui regola (niente LLM)
    │
    ├─(2) heuristica veloce (regex/keyword tool|lunghezza|rischio)
    │         └─ hit ──► BRAIN (35B) diretto
    │
    ├─(3) ROUTER 8B in modalità classificazione JSON
    │         { "route": "router"|"brain", "intent": "...", "confidence": 0.0-1.0 }
    │         oppure, se route=router e confidence alta, genera subito la reply breve
    │
    └─(4) se route=brain o confidence bassa ──► BRAIN 35B
              └─ tool_calls? ──► schema_validator ──► allowlist / conferma ──► esegui
```

**Importante:** il router **non** esegue tool. Al massimo propone `route=brain`.  
I tool li vede solo il cervello (o l’host dopo validazione).

### Due modalità operative

**A — Classifica poi genera (più sicuro)**  
1. 8B restituisce solo JSON di routing (pochi token).  
2. Se `route=router`, seconda chiamata 8B per la frase vocale **oppure** una sola chiamata “classify+reply”.  
3. Se `route=brain`, una chiamata al 35B.

**B — Heuristica-first (più rapido, consigliato in voce)**  
1. Keyword/tool/lunghezza → brain subito (0 ms di classificazione LLM).  
2. Solo i saluti/FAQ passano dall’8B in un unico shot reply.  
Questa cartella implementa **B** + classificazione LLM opzionale (`ROUTER_MODE=heuristic|llm|hybrid`).

Default consigliato: **`hybrid`** (heuristica prima, LLM router solo se incerto).

---

## Config llama.cpp del router

File: `config/llama-router.env.example`  
Script: `scripts/start-llama-router.ps1` / `.bat`  
Dettaglio flag: sezione sotto e parallelo a `CONFIG_LOCALE.md`.

| Parametro | Valore router 8B |
|-----------|------------------|
| `-ngl` | **99** (full GPU) |
| `-ncmoe` | **non usare** (modello denso) |
| `-c` | **2048** (router: ctx corto) |
| `-n` | **96** |
| `--temp` | **0.4** (più deterministico in classificazione) |
| `--top-p` | **0.9** |
| `-np` | **1** |
| thinking | **OFF** |
| MTP | **OFF** |
| `--port` | **8070** |
| `--host` | **127.0.0.1** |

Stima: Qwen3-8B Q4_K_M ≈ **5–6 GB** VRAM → lascia spazio al 35B **solo se non li tieni entrambi residenti**.

### Attenzione VRAM (12 GB)

**Non** caricare router 8B e cervello 35B **insieme** in VRAM piena senza piano:

| Strategia | Descrizione |
|-----------|-------------|
| **A — Sequenziale (semplice)** | Un solo `llama-server` alla volta. Per turni easy avvii/usi 8B; per hard switch al 35B (cold start lento). Poco pratico in voce. |
| **B — Due processi, cervello con più CPU MoE** | Router ~6 GB VRAM; cervello con `-ncmoe` alto e ctx basso per restare nel residuo VRAM. **Da misurare** con `nvidia-smi`. |
| **C — Solo cervello + heuristica senza 8B** | Fallback se 12 GB non bastano a due server: keyword router in Node, solo 35B in GPU. |
| **D — Router sempre on, cervello on-demand** | 8B sempre in ascolto; avvio 35B solo su escalate (latenza al primo turno complesso). |

Per la plancia: prova **B**; se OOM, scendi a **C** o **D**. Annota i risultati in checklist.

---

## Integrazione nello stack ibrido (`RIEPILOGO.md` §6)

Stack aggiornato:

```
Microfono
  → STT (Whisper / già in plancia)
  → FSM / regole plancia          ← azioni critiche deterministiche
  → Heuristica routing (host)
  → [opz.] Qwen3-8B Q4_K_M        ← saluti / FAQ / small-talk (porta 8070)
  → Qwen3.5-35B-A3B Q4_K_M        ← turni complessi + tool (porta 8080)
  → schema_validator (host)       ← allowlist + JSON Schema
  → Tool plancia / conferma umana
  → TTS
  → altoparlante
```

Punti di innesto codice plancia (concettuali):

1. **Prima** della chiamata LLM unica attuale: inserire `decideRoute(userText, history)`.
2. Se `route === "router"` → `LLAMA_ROUTER_URL` (8070), senza `tools`.
3. Se `route === "brain"` → `LLAMA_BRAIN_URL` (8080), con `tools` + validazione.
4. Logging: ogni turno registra `route`, `reason`, `latency_ms`, `model`.

File pronti in questa cartella:

- `config/llama-router.env.example`
- `scripts/start-llama-router.ps1` / `.bat`
- `prompts/system-router.txt` — classificazione / reply breve
- `host/router_logic.js` — regole + decisione
- `client/hybrid_voice_client.mjs` — esempio end-to-end sui due endpoint

---

## Prompt router (comportamento)

Il file `prompts/system-router.txt` impone:

- italiano breve
- output di classificazione JSON stretto **oppure** reply vocale senza tool
- escalate esplicito su dubbio
- mai inventare dati su persone

---

## Checklist rapida router

- [ ] Scaricato GGUF **Qwen3-8B Q4_K_M**
- [ ] `config/llama-router.env` compilato
- [ ] `scripts/start-llama-router.bat` ok su `:8070`
- [ ] Cervello già ok su `:8080` (o strategia VRAM scelta)
- [ ] `node client/hybrid_voice_client.mjs "Ciao"` → resta su router
- [ ] `node client/hybrid_voice_client.mjs "Cerca in memoria l'ultimo deploy"` → brain + validatore
- [ ] Aggiornata plancia: due base URL, non un solo modello remoto

---

## Cosa non fare

- Non dare **tool** al modello 8B in produzione persone  
- Non usare router uncensored  
- Non lasciare thinking ON sul router  
- Non esporre `:8070`/`:8080` in LAN senza auth  
- Non assumere che Cursor instradi da solo: il routing è **host plancia** + questi script
