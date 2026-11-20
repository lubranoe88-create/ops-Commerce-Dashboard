# MESSAGGIO HANDOFF — copia tutto sotto nel nuovo chat Cursor

---

Ciao. Continua il progetto **Plancia** (repo GitHub `lubranoe88-create/ops-Commerce-Dashboard`, anche scritto `ops-commerce-dashboard`).

Questo messaggio è il **contesto completo** per ripartire senza perdere nulla: struttura, password/sicurezza, URL, stack locale vs Render, e **tutto ciò che i worker Cursor hanno già fatto** (branch `cursor/*`, rail stamps, merge su `main`).

---

## 1. Cos’è Plancia

Dashboard ops / “plancia” olografica per commercio e intelligence:

- UI scura ops con **globo 3D**, rail sinistra, chat voce, MIC, function board, memoria neurale
- Backend Node che fa da **gate password**, proxy AI (OpenRouter), memoria SQLite, Atlas (agente residente), Agent Q, browser-use
- Pacchetto **DEPLOY_PIANCIA** per far girare cervello LLM **locale sul PC Windows** (separato da Render)
- **17 piste di ricerca** (filing, marketplace, satelliti, hiring, …) — pipeline meccanica + AI giudice solo sulle decisioni

**Nome agente UI:** **Atlas** (prima a volte chiamato Jarvis; prodotto correlato **Agent Q**).

---

## 2. Punti di ingresso nel repo (obbligatori)

Apri prima questi file:

1. `CHECKPOINT.md` → punta a `docs/CHECKPOINT-PLANCIA.md` (**hub struttura intera**, creato 2026-11-20)
2. `docs/CHECKPOINT-PLANCIA.md` — mappa path per path
3. `dashboard-piste-ricerca.md` — architettura 17 piste + AI
4. `DEPLOY_PIANCIA/INDICE.md` + `DEPLOY_PIANCIA/RIEPILOGO.md` — stack PC locale
5. `docs/CHECKPOINT-2026-10-31.md` — checkpoint storico (holo/voice)
6. PR hub struttura: https://github.com/lubranoe88-create/ops-Commerce-Dashboard/pull/2 (branch `cursor/plancia-checkpoint-struttura-0eed`)

Branch tip Cursor: `cursor/<nome>-0eed` o storici `-0bb5`.

---

## 3. URL e ambienti

| Ambiente | URL / path | Note |
|----------|------------|------|
| **Live Render** | `https://ops-commerce-dashboard.onrender.com` (anche scritto `ops-Commerce-Dashboard.onrender.com`) | Deploy da `render.yaml`, rootDir `backend`, porta **8787** |
| **Locale PC / Cloud Agent** | `http://127.0.0.1:8787` | UI+API insieme; **non** mischiare memoria/cookie con Render |
| Health | `GET /health` | Health check Render |
| Login | `POST /login` form password | Cookie `dash_auth` HttpOnly, senza Max-Age / senza idle timeout server |

Config Cloud Agent (`.cursor/environment.json`):

```json
{
  "install": "cd backend\nnpm ci --ignore-scripts",
  "start": "cd backend\nHOST=127.0.0.1 PORT=8787 node src/server.js"
}
```

---

## 4. Password e segreti (CRITICO)

### Come funziona
- **Una sola password di sito**, env `SITE_PASSWORD` — **nessun username**
- Middleware: `backend/src/middleware/passwordGate.js`
- Valore letto in `backend/src/config.js` (`secretOrPlaceholder`)
- **Mai** nel frontend, **mai** committata nel repo
- Placeholder in repo: `CHANGE_ME_SITE_PASSWORD` (`backend/.env.example`) e `CHANGE_ME_LOCAL_PASSWORD` (`DEPLOY_PIANCIA/PROGETTO_LOCALE/env.plancia-locale.example`)
- Opzionale 2FA: `SITE_TOTP_SECRET` (base32); se assente → solo password
- Sessione: `SESSION_SECRET` (o derivato da password + `-session`)
- Cookie: `COOKIE_SECURE=true` su Render, `false` in locale

### Dove starebbe la password reale
| Dove | Chiave |
|------|--------|
| **Render Dashboard** → Environment del service `ops-commerce-dashboard` | `SITE_PASSWORD` (`sync: false` in `render.yaml` — non sovrascritta dal blueprint) |
| **PC locale** | `backend/.env` (creato da example / da AVVIO_PC) |
| Repo Git | **NON c’è** — non inventarla |

**Per il nuovo agent:** la password **non è in questo messaggio** perché non è nel codice. Leggila da Render (Environment) o dal `.env` sul PC Windows. Se serve solo sviluppare in Cloud Agent, usa un `.env` locale con una password di test.

### Altri secret tipici (valori solo su host, mai in chat)
- `OPENROUTER_API_KEY`
- `SESSION_SECRET`
- Eventuali: `ELEVENLABS_API_KEY`, `CARTESIA_API_KEY`, TOTP

### Login di prova (locale)
```bash
curl -c /tmp/dash.jar -b /tmp/dash.jar -X POST http://127.0.0.1:8787/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'password=YOUR_SITE_PASSWORD'
curl -b /tmp/dash.jar -s http://127.0.0.1:8787/health
```

---

## 5. Struttura completa del repo

```
ops-commerce-dashboard/
├── CHECKPOINT.md                 → hub (punta al doc sotto)
├── docs/
│   ├── CHECKPOINT-PLANCIA.md     → mappa struttura (2026-11-20)
│   ├── CHECKPOINT-2026-10-31.md  → checkpoint storico
│   ├── HANDOFF-NUOVO-CHAT.md     → questo handoff
│   ├── map-module-design.md      → Modulo 1 Globo (spec)
│   ├── pipeline-graph-module-design.md → Modulo 2 Pipeline (spec)
│   ├── memory-graph-module-design.md   → Modulo 3 Memoria (spec)
│   ├── chat-module-design.md     → Modulo 4 Chat (spec)
│   ├── corrections-and-coverage-design.md
│   ├── atlas-prove.md
│   └── mockups/
├── public/                       → UI statica (mirror anche in backend/public/)
│   ├── index.html
│   ├── css/app.css
│   ├── js/
│   │   ├── app.js                → core UI (~5k+ righe)
│   │   ├── mapGlobe.js
│   │   ├── functionBoardUi.js
│   │   ├── agentqUi.js, aiAgentUi.js
│   │   ├── atlasWake.js, atlasCall.js, atlasSpeak.js
│   │   ├── atlasRoute.js, atlasCockpitUi.js
│   │   ├── atlasHandsPlan.js, atlasHoloDispatch.js
│   │   └── atlasMemoryGraphUi.js
│   └── mockups/
├── backend/
│   ├── package.json
│   ├── .env.example
│   ├── README.md
│   ├── docs/ (AGENT_ROUTER.md, OSS_INTEGRATION.md)
│   ├── public/                   → stessa UI servita da Node
│   ├── src/
│   │   ├── server.js             → entrypoint
│   │   ├── config.js
│   │   ├── routes/ (chat.js, ai.js, dashboard.js)
│   │   ├── middleware/ (passwordGate, aiPaidGate, validateChat)
│   │   ├── memory/ (SQLite: db, store, schema, consistency…)
│   │   ├── agents/ (router, pipeline, registry, catalog…)
│   │   ├── integrations/
│   │   └── services/             → Atlas* (~60 file), localLlm, openrouter,
│   │                               agentqBridge, functionBoard, browserUse…
│   └── workers/                  → Python browser-use
├── DEPLOY_PIANCIA/               → pacchetto Windows LLM locale
│   ├── INDICE.md, README.md, RIEPILOGO.md, CHECKLIST.md
│   ├── CONFIG_LOCALE.md, ROUTER_PICCOLO.md, COLLEGAMENTO_PLANCIA.md
│   ├── AVVIO_PC/                 → AVVIA-PLANCIA.bat, FORZA-AGGIORNAMENTO…
│   ├── PROGETTO_LOCALE/
│   ├── config/, scripts/, prompts/, host/, client/
│   ├── PORTABLE_ROOT/
│   └── Plancia-Locale.zip
├── agent-q-dev/                  → Agent Q Python
├── scripts/                      → live-ops-monitor, mic tests, full suite
├── .github/workflows/live-ops-monitor.yml
├── dashboard-piste-ricerca.md
├── render.yaml
└── Dockerfile
```

---

## 6. Stack tecnico essenziale

### Backend (Render + locale)
- Node, porta **8787**
- Modello default OpenRouter (Render): `deepseek/deepseek-v4.1-flash`
- Router AI economico + escalate Grok (vedi `.env.example`)
- Budget giornaliero EUR (`AI_DAILY_BUDGET_EUR=10` tipico)
- `AI_ENTITLEMENT=paid` su Render
- Memoria: SQLite (`MEMORY_DB_PATH`) + Atlas memory dir `data/atlas-memory`
- `VOICE_ALWAYS_ON=true` su Render (wake dopo primo gesto MIC)
- browser-use abilitato
- Threshold verifica: `0.72`

### Locale PC Windows (DEPLOY_PIANCIA) — SEPARATO da Render
- Hardware target: **MSI Infinity S3**, **RTX 5070 12 GB**, **32 GB RAM**
- Runtime: **llama.cpp** `llama-server`
- Cervello: **Qwen3.5-35B-A3B** Q4_K_M (preferito vs 3.6 per tool stability)
- Router: **Qwen3-8B** full-GPU → fallback 35B
- Porte tipiche: cervello `:8080`, router `:8070`, plancia `:8787`
- Policy voce: **thinking OFF**, **no MTP**, ctx **2–8k**, expert MoE su CPU (`-ncmoe`)
- Validazione tool host-side: `DEPLOY_PIANCIA/host/`
- Avvio: `DEPLOY_PIANCIA/AVVIO_PC/AVVIA-PLANCIA.bat` (dopo extract fuori da Temp)
- LM Studio path sperimentale: `bionic.local:23000`, modello Huihui Qwen3.6 MTP GGUF Q4_K (branch locale)

### Frontend
- Vanilla JS + CSS ops (non React SPA)
- Cesium/Three per globo / memoria
- Cache-bust “rail-XX” sugli asset (ultimo visto in storia: **rail-44**)

---

## 7. Moduli prodotto (design + implementazione)

| # | Modulo | Spec | Stato tipico |
|---|--------|------|----------------|
| 1 | Globo 3D | `docs/map-module-design.md` | UI live in `mapGlobe.js` + evoluzioni military/holo |
| 2 | Pipeline 17 piste | `docs/pipeline-graph-module-design.md` | design + parti live |
| 3 | Memoria grafo / cervello neurale | `docs/memory-graph-module-design.md` | **implementato** come brain 3D (vedi worker MEMORY) |
| 4 | Chat + voce | `docs/chat-module-design.md` | live + molti fix MIC/TTS Safari/iPad |

Correzioni prodotto: `docs/corrections-and-coverage-design.md`.

---

## 8. Aggiornamenti fatti dai worker Cursor (cronologia consolidata)

Tutto ciò sotto è già stato fatto da agent Cursor (branch `cursor/*-0bb5` / merge su `main`). Usa questa lista come “già fatto — non rifare da zero”.

### A) UI plancia / rail / holo
- Left rail cleanup: rimossi NORD, ORBIT, ANALIZZA, ZOOM, MIC dalla nav; **CONTROLLI** ripristinato per **Funzionamento plancia**
- Panel Funzionamento + wires + fix swipe globo
- Holo pack / light-points z-index sopra globo; clickable con moduli aperti
- Voice overlap polish; layout mockups HTML
- Military globe / Reearth buildings (branch dedicati)
- Map zoom keys, UI page isolation, voice command fixes
- Function board live + chiarimenti errori UI
- Checkpoint 2026-10-31: TTS off all’entry; ack in chat/toast senza readback parlato

### B) MIC / voce / Safari / iPad (molto lavoro)
- Fix gesture `getUserMedia`, Analizza-bar mic start
- Whisper-only, server TTS; stop SpeechSynthesis fallback iPad
- Fix registrazioni vuote, TTS silenzioso, secondo tap che droppa speech
- Continuous voice-call MIC (rail-21); call resta aperta fino a END (rail-24)
- Live ops monitor + soft-fail MIC browser check; report status su GitHub
- Briefing modal non deve più trap MIC/rail
- Desktop **always-on mic** + Atlas **wake-word** (rail-37)
- Safari tablet: mic-level meter; clone mic tracks per Analyser PCM non silenzioso (rail stream-clone)
- ElevenLabs Flash TTS, spelled codes, barge-in
- Agent Q voice gated sul gesto MIC; un solo AudioContext TTS

**Rail stamps rilevanti:** rail-5…11, 18–21, 24, 36-prove, 37-atlas-voice, 38, **44**

### C) Atlas (agente residente)
- Identity/personality: ogni chat path è Atlas; greet una volta per sessione
- Persona su ogni completion
- L3 autonomy policy su hands path; ASK→AUTO dopo 3 confirm
- Resident loop dentro la plancia
- News literacy, startup integrity, zoom/popup actuation
- Trust, spend, session; state answers da dati live
- Recall, provider fallback, decision log
- Suggestions, self-heal, quiet ingress
- Routing, durable runs, MCP tools, operator cockpit
- Prove pack (rail-36)
- Always-on default, memory dir, geo pack (rail-38)
- Live MEMORY panel con note espandibili

### D) Memoria / cervello neurale
- Unificazione memoria Atlas in neuron brain + heritage Agent Q
- Color neuron by kind; merge live+memory; dedupe
- Sostituzione vecchio hologram con pagina 3D neural brain
- Spiral force graph; orbit/zoom utente; no auto-rotate aggressivo
- Cervello neurale layout nero; demand-driven Three.js render; batch synapse draws
- Sync mirror `public/` ↔ `backend/public/`

### E) Agent Q
- Bridge in plancia (rail-10); naming Agent Q (non Jarvis)
- Concordato briefing pinnato all’apertura chat (rail-8)
- Sandbox seed boot; SQLite search allowlisted; expandable memory store
- Problem monitoring; complete-plancia branch

### F) DEPLOY_PIANCIA / PC Windows / LM Studio
- Pack completo: Qwen locale, router 8B, checklist, config, prompts, host validator
- COLLEGAMENTO_PLANCIA semplificato per non-tecnici
- PROGETTO_LOCALE separato da Render
- AVVIO_PC: script hardenati (no Temp/zip, Mark-of-the-Web, path banner, TEMP logs)
- Shortcut Desktop; soft auto-update da GitHub main; FORZA-AGGIORNAMENTO
- Plancia-Locale.zip refresh con UI cervello neurale
- Punta chat a LM Studio `bionic.local:23000`; fallback graceful; 50/85 proposte miglioramento

### G) Infra / Cloud / monitor
- `.cursor/environment.json` + PR #1 merge (cloud env plancia)
- live-ops-monitor (poi schedule allungato a ~5h)
- paid AI agent / Deepseek default / chat model selector / Perplexity Sonar (branch)
- browser-use runtime
- Checkpoint hub struttura (PR #2, 2026-11-20): `CHECKPOINT.md` + `docs/CHECKPOINT-PLANCIA.md`

### H) Branch Cursor ancora presenti su remote (riferimento)
```
cursor/add-perplexity-sonar-0bb5
cursor/agentq-complete-plancia-0bb5
cursor/atlas-brain-neurons-0bb5
cursor/atlas-identity-personality-0bb5
cursor/browser-use-runtime-0bb5
cursor/chat-model-selector-0bb5
cursor/cloud-env-plancia-0bb5
cursor/deepseek-default-model-0bb5
cursor/fix-map-zoom-keys-0bb5
cursor/fix-mic-structure-0bb5
cursor/fix-ui-page-isolation-0bb5
cursor/fix-voice-command-0bb5
cursor/function-board-live-0bb5
cursor/holo-pack-complete-0bb5
cursor/inventory-finish-b4c7
cursor/layout-mockups-html-0bb5
cursor/left-rail-native-0bb5
cursor/memory-orbit-hold-0bb5
cursor/memory-spiral-graph-0bb5
cursor/memory-still-camera-0bb5
cursor/military-globe-0bb5
cursor/paid-ai-agent-0bb5
cursor/plancia-checkpoint-struttura-0eed
cursor/plancia-lmstudio-locale-0bb5
cursor/progetto-locale-docs-0bb5
cursor/reearth-buildings-0bb5
cursor/safari-mic-fix-0bb5
cursor/safari-mic-stream-clone-0bb5
cursor/top10-ops-features-0bb5
cursor/voice-overlap-polish-0bb5
```
Nota: un branch chiesto in passato `cursor/plancia-mic-robust-c21c` **non esiste** su remote; i lavori MIC equivalenti sono nei branch `safari-mic-*` e `fix-mic-structure` + commit su `main`.

---

## 9. Regole da rispettare sempre

1. **Niente API key / SITE_PASSWORD nel frontend o nei commit**
2. OpenRouter e TTS keys solo server-side
3. Stack **PC locale** ≠ **Render** (memoria, cookie, URL diversi)
4. `DEPLOY_PIANCIA` non si auto-esegue: istruzioni + script Windows
5. Preferire continuare da `docs/CHECKPOINT-PLANCIA.md` e da questo handoff
6. Su Windows: non lanciare da Temp/zip; usare `AVVIO_PC` estratto in `C:\Atlas\...`
7. Per nuove feature voce: testare Safari/iPad (storico di bug PCM/TTS)

---

## 10. Cosa fare adesso (per il nuovo chat)

Dimmi il compito concreto. Contesto già caricato:

- Repo e hub struttura aperti
- Password: **prendere da Render env / `.env` locale** (non è in Git)
- Live: `https://ops-commerce-dashboard.onrender.com`
- Locale: `http://127.0.0.1:8787`
- Lavori Cursor precedenti: sezione 8 sopra — non rifare MIC/Atlas/memoria da zero senza motivo

Se serve riprendere MIC robusto: parti da `public/js/atlasWake.js`, `atlasCall.js`, `atlasSpeak.js`, `app.js` e dai branch `safari-mic-*`.

Se serve LLM locale: `DEPLOY_PIANCIA/COLLEGAMENTO_PLANCIA.md` + `backend/src/services/localLlm.js`.

---

*Generato 2026-11-20 (Atlantic/Bermuda) · tip main storico `8a3507ed` + hub checkpoint `75fb802` su branch `cursor/plancia-checkpoint-struttura-0eed`*
