# Modulo 2 — Grafo 3D pipeline di ricerca (solo design, niente UI)

Stato: **spec**. Non implementare l’UI.

- **Modulo 1** = globo 3D **satellitare mondo** (`docs/map-module-design.md`)  
- **Modulo 2** = questo documento: **network graph 3D** della pipeline (non è il globo terra)  
- **Modulo 3** = memoria grafo 5D (`docs/memory-graph-module-design.md`)  

Tema: dark military / COP ops, coerente col Modulo 1 (feeling Foundry/Gotham-like **senza** copiare asset Palantir).

---

## Obiettivo

Vista operativa della **pipeline di ricerca**: ogni nodo è una delle **17 piste**; ogni arco è un **flusso dati** (verso score, router, memoria, giudice). Serve a capire *dove* cerca il sistema oggi, *quanto*, *se è verificato*, e *quali agent OSS* sono attaccati.

In più: un **indicatore di salute globale** (un solo numero) e un **registro errori** delle fonti fallite/sospette, per correggere prima che inquinino il top ranking.

Navigazione: **zoom + rotazione 3D** per andare direttamente all’informazione cercata (nodo, hub, o cluster errori).

---

## Forma: grafo 3D (non globo terra, non piano 2D)

| Requisito | Specifica |
|---|---|
| Geometria | **Force-directed / layered graph in 3D** (nodi con x,y,z) |
| Non usare | Planisfero 2D fisso; mesh satellitare terrestre (quello è Modulo 1) |
| Layout suggerito | Corsie lungo un asse (es. Z o X): Collection → Score → Router/Agents → Judge → Memory; fonti 01–17 disposte a corona/layer attorno agli hub |
| Densità | 17 nodi fonte + 4–6 nodi stage; archi solo flussi reali |
| **Zoom** | Scroll/pinch; doppio-click o “fly-to” su nodo da registro errori / ricerca |
| **Rotazione** | Orbit drag (pitch/yaw); inertia leggera; bottone **Reset view** |
| **Focus** | Selezione nodo → camera orbit/dolly verso il target senza perdere il contesto ops |
| Labels | Billboard sempre leggibili verso camera; a zoom basso solo ID, a zoom alto volume + status + chips |

---

## Nodi — 17 research leads

Ogni nodo fonte mostra **sempre**:

1. **ID + label** (01–17, nome corto)  
2. **Daily search volume** — conteggio/job della giornata (richieste, record ingestiti, o proxy “attempts”); glyph a barra o ring sul bordo  
3. **Verification status** — `verified` | `unverified` (e opzionale `partial`), secondo **soglie differenziate** (fonte forte standalone vs news che richiede corroborazione — vedi sotto)  
4. **Agents attached** — chip/icone testo per subset di:  
   `browser-use` · `CrewAI`/`LangGraph` · `PyOD` · `FinRobot` · `FinGPT` · `OpenBusiness`

### Tabella default agent ↔ pista (design)

| # | Pista | Agent tipici (allegati) |
|---|---|---|
| 01 | Filing legali | browser-use, FinRobot, PyOD |
| 02 | Marketplace B2B | browser-use, PyOD |
| 03 | Forum / Telegram import | browser-use, PyOD |
| 04 | Satellitari aperti | browser-use, PyOD |
| 05 | Piattaforme indie | browser-use, PyOD |
| 06 | Community founder | browser-use |
| 07 | Report fatturazione | browser-use, PyOD |
| 08 | Accelerator | browser-use |
| 09 | Database acquisizioni | browser-use, FinRobot |
| 10 | Licenze / permessi | browser-use, PyOD |
| 11 | Dogane import-export | browser-use, PyOD |
| 12 | WHOIS / domini | browser-use, PyOD |
| 13 | Hiring | browser-use, PyOD |
| 14 | Offshore / holding | browser-use, FinRobot, OpenBusiness* |
| 15 | Recensioni clienti | browser-use, FinGPT, PyOD |
| 16 | Traffico web | browser-use, PyOD |
| 17 | Brevetti business model | browser-use, OpenBusiness* |

\* **OpenBusiness** compare sul grafo come allegato **solo in modalità post-verifica** (nodo spento/grigio finché il business non è revenue-verified); non gira sulla raccolta grezza.

**Orchestrazione:** `LangGraph` (primario) / `CrewAI` (alt) compaiono come **nodi stage** (o badge globali), non ripetuti su tutte e 17 le fonti.

---

## Nodi stage (hub)

| Nodo | Ruolo |
|---|---|
| `ingest` / collectors | Ingresso meccanico (browser-use + API free) |
| `pyod-score` | Anomalie zero-token |
| `router` | Selezione agenti (regole; futuro LangGraph) |
| `selected-agents` | FinRobot / FinGPT / stub |
| `openrouter-judge` | Solo decisioni |
| `memory` | Conversazioni, tops, neural links, consistency |
| `openbusiness-deepen` | Post-verifica only |

---

## Archi — flussi dati

- **Source → ingest → pyod-score** (sempre meccanico)  
- **pyod-score → router** (candidati con anomaly_score)  
- **router → selected-agents** (sottinsieme)  
- **selected-agents → openrouter-judge** (dossier)  
- **judge → memory** (verdetto, daily tops)  
- **memory → openbusiness-deepen** (solo verified tops)  
- Cross-link fonte↔fonte solo se co-feed esplicito (es. dogane ↔ satellitare), glow ciano debole  

Stile arco: linea sottile ciano/grigio in 3D; spessore ∝ volume giornaliero sul flusso; pulse lento se job in corso; depth-fade sugli archi lontani dalla camera.

---

## Encoding visuale (dark ops)

| Elemento | Specifica |
|---|---|
| Sfondo | Nero/ops dark; griglia/assi di riferimento molto discreti (opzionale) |
| Nodo verified | Bordo **ciano**, fill grigio-scuro |
| Nodo unverified | Bordo **ambra/grigio**, stroke tratteggiato |
| Nodo partial | Bordo ciano spezzato |
| Volume | Anello progress o bar sotto label (0–max day) |
| Agent chips | Testo monospace piccolo; max 3 visibili + “+N” (a zoom alto) |
| Selezione | Halo ciano + **fly-to** camera + pannello dettaglio |
| Legenda | Minimale: verified / unverified / volume / agent chips / orbit+zoom hints |

Coerenza con Modulo 1: stessa palette (ciano, verde revenue, rosso stress), stessa densità tipografica — spazio **3D di pipeline**, non terra.

---

## Indicatore di salute globale (pipeline health)

Un **solo numero** in evidenza nell’header COP (non una dashboard di KPI multipli).

| Campo | Specifica |
|---|---|
| Nome UI | `PIPELINE HEALTH` (o `SALUTE OGGI`) |
| Valore | Intero **0–100** (oppure 0.00–1.00 visualizzato come %) |
| Domanda che risponde | “Oggi la pipeline produce **abbastanza dati verificati**, o è in difficoltà?” |
| Input tipici (meccanici) | Quota fonti `verified` sulle 17; volume verificato vs soglia giornaliera; tasso errori/suspicious; freschezza (`last_run`); eventuale calo vs ieri |
| Encoding colore | **Verde** ≥ soglia ok · **Ambra** zona debole · **Rosso** in difficoltà (allineato al tema ops) |
| Click | Apre/filtra il **registro errori** + evidenzia nodi unhealthy + **fly-to** cluster errori |
| Cosa non è | Non è il giudice OpenRouter; non sostituisce il top-25 revenue |

Formula esatta = implementazione futura; in design basta: **un numero**, aggiornato col job giornaliero, calcolabile senza LLM.

---

## Registro errori (error registry)

Elenco operativo di ogni fonte **fallita** o **sospetta**, con **causa**, per fix **prima** che i dati inquinino il top ranking.

| Colonna | Contenuto |
|---|---|
| `time` | Timestamp evento |
| `source` | Pista 01–17 (link → selezione nodo + **fly-to** 3D) |
| `severity` | `failed` \| `suspicious` |
| `cause` | Causa breve machine-readable + testo umano (es. `timeout`, `http_429`, `schema_drift`, `empty_payload`, `tos_block`, `anomaly_spike`, `stale_feed`) |
| `impact` | Es. esclusa dallo score / quarantena / retry scheduled |
| `volume_at_fail` | Volume tentato quel giorno |
| `status` | `open` \| `acknowledged` \| `resolved` |

Regole di design:

- Comparire in pannello laterale o drawer; badge conteggio `open` sull’header accanto a PIPELINE HEALTH.  
- Nodi con errori `open` → alone **rosso** / bordo stress nel grafo 3D.  
- **Gate ranking:** candidati da fonti in `failed`/`suspicious` non verificati **non** entrano nel top finché non `resolved` o override esplicito.  
- Nessuna generazione LLM obbligatoria per le cause (log meccanici); eventuale testo giudice solo su richiesta, fuori da questo modulo.

---

## Layout COP Modulo 2

```
[ Titolo: PIPELINE OPS | giorno | job status | PIPELINE HEALTH: NN ]
[ Filtri: verified only | agent | volume>N | errors open ]
[ Controlli: orbit / zoom / reset / fly-to ]
[ GRAFO 3D 17 fonti + hub ]     [ Dettaglio nodo ]
[ REGISTRO ERRORI (failed / suspicious + causa) ]
[ Legenda minimale ]
```

---

## Dati (binding futuro)

Campi per nodo fonte (es. da SQLite / job log):

- `source_key`, `label`, `day_key`  
- `daily_search_volume` (int)  
- `verification_status`: `verified` | `unverified` | `partial`  
- `attached_agents[]`  
- `last_run_at`, `error_count`  
- `layout_x`, `layout_y`, `layout_z` (opzionale, cache layout 3D)

Salute globale (aggregato giornaliero):

- `pipeline_health_score` (0–100)  
- `verified_source_count`, `verified_volume`, `error_open_count`  
- `health_updated_at`  

Registro errori (righe):

- `id`, `day_key`, `source_key`, `severity`, `cause_code`, `cause_text`  
- `impact`, `status`, `created_at`, `resolved_at`  

Niente OpenRouter per disegnare il grafo o calcolare lo health score di default.

---

## Correzioni prodotto (pipeline)

Dettaglio: `docs/corrections-and-coverage-design.md`.

### A) Correzione utente → regola meccanica immediata
- Sulla top list (fuori o accanto al grafo): **Correct / Incorrect** + **una riga** di motivo.  
- Persistenza SQLite → regola nel **filtro meccanico** subito (niente coda AI).  
- Health / error registry possono riflettere “user_rule_active”; nodi legati a claim smentiti restano in quarantena finché la regola vale.

### B) Soglie di verifica (più passaggio, stessa affidabilità)
- **Forte** (es. bilancio annuale depositato): basta **una** fonte → `verified`.  
- **Debole** (es. notizia di settore): serve **≥1 segnale corroborante** indipendente, altrimenti `unverified`/`partial`.  
- Il grafo mostra lo stato risultante; il gate ranking usa le stesse regole.

### C) Trasparenza di copertura
- Aggregati geo/settore (se noti alle fonti) espongono `coverage_degree`.  
- PIPELINE HEALTH può incorporare copertura media, ma la dichiarazione esplicita “quanto manca” resta visibile (badge/pannello), non nascosta nel solo score.

---

## Cosa non fare

- Usare il **globo terrestre** del Modulo 1 come grafo pipeline  
- Tornare a un grafo **solo 2D** come default di prodotto  
- UI build in questo passo  
- Mostrare OpenBusiness come collector di massa  
- Copiare diagrammi o chrome Palantir  

---

## Relazione Modulo 1 ↔ 2 ↔ 3

| Modulo | Vista |
|---|---|
| 1 | Dove nel **mondo** (globo satellitare) stanno revenue / failure / bottleneck |
| 2 | Come la **macchina di ricerca** lavora sulle 17 piste (**grafo pipeline 3D** + health + errori) |
| 3 | Cosa la **memoria** ha imparato (concetti, link, consistenza) — `docs/memory-graph-module-design.md` |
| 4 | **Chat** testo+voce sui dati del dashboard — `docs/chat-module-design.md` |

**Niente build UI in questo passo.**
