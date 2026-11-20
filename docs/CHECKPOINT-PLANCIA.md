# Checkpoint Plancia — hub struttura

**Data:** 2026-11-20 (Atlantic/Bermuda)  
**Repo:** `lubranoe88-create/ops-commerce-dashboard`  
**Branch base:** `main` @ `8a3507ed`  
**Live (Render):** vedi `render.yaml` / deploy esistente  

Questo file è il **punto di ingresso** a tutta la struttura Plancia.  
Da qui puoi aprire ogni area del progetto senza cercare a caso.

---

## 0. Mappa a colpo d’occhio

```
ops-commerce-dashboard/
├── public/                 → UI plancia (frontend statico servito)
├── backend/                → API Node, Atlas, memoria, agenti, chat/voce
├── DEPLOY_PIANCIA/         → pacchetto PC Windows (LLM locale + avvio)
├── docs/                   → design moduli + questo checkpoint
├── agent-q-dev/            → Agent Q (dev locale)
├── scripts/                → test live / monitor ops
├── .github/workflows/      → CI / monitor
└── dashboard-piste-ricerca.md  → 17 piste + architettura ricerca
```

| Area | Path | Cosa fa |
|------|------|---------|
| UI ops | `public/` | Globo, chat, MIC, rail, function board |
| API | `backend/src/` | Server, route, Atlas, memoria SQLite |
| Locale PC | `DEPLOY_PIANCIA/` | Qwen/llama.cpp, router, avvio Windows |
| Spec moduli | `docs/*-design.md` | Globo, pipeline, memoria, chat |
| Agent Q | `agent-q-dev/` | Orchestratore Python locale |
| Piste | `dashboard-piste-ricerca.md` | 17 fonti + pipeline AI |

---

## 1. Frontend plancia (`public/`)

| Path | Ruolo |
|------|-------|
| `public/index.html` | Shell HTML |
| `public/css/app.css` | Tema ops |
| `public/js/app.js` | Core UI (rail, chat, MIC, moduli) |
| `public/js/mapGlobe.js` | Globo 3D |
| `public/js/functionBoardUi.js` | Function board |
| `public/js/agentqUi.js` | UI Agent Q |
| `public/js/aiAgentUi.js` | UI agente AI |
| `public/js/atlasWake.js` | Wake word / ascolto |
| `public/js/atlasCall.js` | Chiamata voce |
| `public/js/atlasSpeak.js` | TTS / speak |
| `public/js/atlasRoute.js` | Routing Atlas UI |
| `public/js/atlasCockpitUi.js` | Cockpit |
| `public/js/atlasHandsPlan.js` | Hands / piano azioni |
| `public/js/atlasHoloDispatch.js` | Dispatch olografico |
| `public/js/atlasMemoryGraphUi.js` | Grafo memoria UI |
| `public/mockups/` | Mockup HTML moduli |

Copia speculare servita dal backend: `backend/public/` (stessi asset).

---

## 2. Backend (`backend/`)

### Entrypoint
| Path | Ruolo |
|------|-------|
| `backend/src/server.js` | HTTP server |
| `backend/src/config.js` | Env / config |
| `backend/package.json` | Dipendenze Node |
| `backend/README.md` | Avvio backend |

### Route
| Path | Ruolo |
|------|-------|
| `backend/src/routes/chat.js` | Chat + voce |
| `backend/src/routes/ai.js` | AI paid / OpenRouter |
| `backend/src/routes/dashboard.js` | Dati dashboard |

### Middleware
| Path | Ruolo |
|------|-------|
| `backend/src/middleware/passwordGate.js` | `SITE_PASSWORD` |
| `backend/src/middleware/aiPaidGate.js` | Gate AI a pagamento |
| `backend/src/middleware/validateChat.js` | Validazione chat |

### Memoria locale
| Path | Ruolo |
|------|-------|
| `backend/src/memory/db.js` | SQLite |
| `backend/src/memory/store.js` | Store concetti |
| `backend/src/memory/aiStore.js` | Store AI |
| `backend/src/memory/consistency.js` | Consistency ranking |
| `backend/src/memory/schema.sql` | Schema |

### Agenti / pipeline
| Path | Ruolo |
|------|-------|
| `backend/src/agents/router.js` | Router agenti |
| `backend/src/agents/pipeline.js` | Pipeline |
| `backend/src/agents/registry.js` | Registry |
| `backend/src/agents/catalog.json` | Catalogo |
| `backend/src/agents/runners.js` | Runner |

### Servizi Atlas (selezione)
| Path | Ruolo |
|------|-------|
| `backend/src/services/atlasBrain.js` | Cervello Atlas |
| `backend/src/services/atlasResident.js` | Resident loop |
| `backend/src/services/localLlm.js` | LLM locale (plancia PC) |
| `backend/src/services/openrouter.js` | OpenRouter |
| `backend/src/services/chatModels.js` | Selezione modelli chat |
| `backend/src/services/agentqBridge.js` | Bridge Agent Q |
| `backend/src/services/functionBoard.js` | Function board API |
| `backend/src/services/browserUse.js` | Browser-use |
| `backend/src/services/atlasMemoryGraph.js` | Grafo memoria |
| `backend/src/services/atlasCockpit.js` | Cockpit stato |
| `backend/workers/` | Worker Python (browser-use) |

Docs backend: `backend/docs/AGENT_ROUTER.md`, `backend/docs/OSS_INTEGRATION.md`.

---

## 3. Deploy Plancia locale PC (`DEPLOY_PIANCIA/`)

Pacchetto Windows: LLM locale + avvio plancia. **Niente esecuzione automatica** da questo repo.

| Path | Ruolo |
|------|-------|
| `DEPLOY_PIANCIA/INDICE.md` | Indice cartella |
| `DEPLOY_PIANCIA/README.md` | Install llama.cpp + GGUF |
| `DEPLOY_PIANCIA/RIEPILOGO.md` | Hardware, modelli, verdetto |
| `DEPLOY_PIANCIA/CHECKLIST.md` | Passi ordinati sul PC |
| `DEPLOY_PIANCIA/CONFIG_LOCALE.md` | Flag cervello 35B-A3B |
| `DEPLOY_PIANCIA/ROUTER_PICCOLO.md` | Router Qwen3-8B |
| `DEPLOY_PIANCIA/COLLEGAMENTO_PLANCIA.md` | Plancia ↔ llama-server |
| `DEPLOY_PIANCIA/AVVIO_PC/` | Script avvio (`AVVIA-PLANCIA.bat`, …) |
| `DEPLOY_PIANCIA/PROGETTO_LOCALE/` | Stack UI+API+cervello sul PC |
| `DEPLOY_PIANCIA/config/` | Env / JSON llama |
| `DEPLOY_PIANCIA/scripts/` | start-llama-server / router |
| `DEPLOY_PIANCIA/prompts/` | System prompt voce + router |
| `DEPLOY_PIANCIA/host/` | Validatore tool + router_logic |
| `DEPLOY_PIANCIA/client/` | Client esempio / hybrid voice |
| `DEPLOY_PIANCIA/PORTABLE_ROOT/` | Root portatile |
| `DEPLOY_PIANCIA/Plancia-Locale.zip` | Archivio deploy |

Hardware target (da `RIEPILOGO.md`): RTX 5070 12 GB · 32 GB RAM · Qwen3.5-35B-A3B Q4_K_M + router 8B.

---

## 4. Design moduli (`docs/`)

| Modulo | Spec | Stato |
|--------|------|-------|
| 1 Globo 3D | `docs/map-module-design.md` | design |
| 2 Pipeline 17 piste | `docs/pipeline-graph-module-design.md` | design |
| 3 Memoria grafo | `docs/memory-graph-module-design.md` | design |
| 4 Chat voce | `docs/chat-module-design.md` | design |
| Correzioni / coverage | `docs/corrections-and-coverage-design.md` | design |
| Mockup HTML | `docs/mockups/html/` | mockup |
| Checkpoint precedente | `docs/CHECKPOINT-2026-10-31.md` | storico |

Piste di ricerca (elenco 17): `dashboard-piste-ricerca.md` (root).

---

## 5. Agent Q e script ops

| Path | Ruolo |
|------|-------|
| `agent-q-dev/` | Dev Agent Q (Python) |
| `scripts/live-ops-monitor.mjs` | Monitor live |
| `scripts/live-ipad-mic-voice-test.mjs` | Test MIC iPad |
| `scripts/live-plancia-full-suite.mjs` | Suite plancia |
| `.github/workflows/live-ops-monitor.yml` | Cron monitor |

---

## 6. Come entrare in lavoro (scorciatoie)

1. **Capire la plancia UI** → `public/js/app.js` + `public/index.html`  
2. **API / Atlas** → `backend/src/server.js` → `routes/` → `services/atlas*.js`  
3. **Voce / MIC** → `public/js/atlasWake.js`, `atlasCall.js`, `atlasSpeak.js` + `routes/chat.js`  
4. **LLM sul PC** → `DEPLOY_PIANCIA/COLLEGAMENTO_PLANCIA.md` + `backend/src/services/localLlm.js`  
5. **Avvio Windows** → `DEPLOY_PIANCIA/AVVIO_PC/ISTRUZIONI.txt`  
6. **17 piste** → `dashboard-piste-ricerca.md`  
7. **Spec moduli** → `docs/*-design.md`

---

## 7. Checkpoint precedenti

| File | Note |
|------|------|
| `docs/CHECKPOINT-2026-10-31.md` | Overlap holo, voice TTS off entry, MIC |
| `docs/CHECKPOINT-PLANCIA.md` | **Questo file** — hub struttura intera |

---

## 8. Regole rapide

- Nessuna API key nel frontend.  
- `SITE_PASSWORD` sul gate.  
- OpenRouter solo server-side.  
- Memoria/SQLite locale senza token AI dove possibile.  
- `DEPLOY_PIANCIA` è documentazione + script PC: non parte da sola.
