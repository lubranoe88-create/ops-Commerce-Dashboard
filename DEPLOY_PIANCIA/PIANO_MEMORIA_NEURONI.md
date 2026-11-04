# Piano — memoria unica a neuroni (Atlas = plancia)

## Obiettivo
Una sola memoria live: **Atlas è il cervello**. Skill, prompt, funzioni, fatti, sessione e concetti non sono più elenchi separati.

## Prima (oggi)
- `expandable.json` — note / sticky / prompt
- `memory.sqlite` — concetti/link dashboard
- UI MEMORY live con due sezioni (`expandable` + `sqlite`)

## Dopo
- File unico: `brain-neurons.json` sotto `ATLAS_MEMORY_DIR` (o `data/agentq-memory`)
- Unità: **neurone** `{ id, kind, title, body, tags, links, at, weight, source }`
- `kind`: `skill` | `prompt` | `function` | `fact` | `session` | `concept` | `tool` | **`heritage`** (Agent Q = come Atlas opera)
- **Agent Q obbligatorio in migrazione**: regole di comportamento, plan/critique/verify, ask-user, verification loop (`ATLAS_AGENTQ_QUALITIES` + tag `atlas-agentq-heritage`)
- Grafo: archi per tag/link condivisi (come X4)
- Live API: `GET /api/ai/agentq/memory/live` espone `neurons[]` unificati
- UI: una lista **CERVELLO · neuroni** + grafo

## Migrazione
All’avvio / prima lettura: importa note expandable + concetti SQLite in neuroni (idempotente per `source`).
Le scritture legacy (`appendExpandableMemory`) restano valide e vengono riflesse nel cervello.

## Fasi
1. Store `atlasBrain.js` + migrazione  
2. `memoryLiveSnapshot` unificato  
3. UI live unica  
4. Test + seed sticky come neuroni `prompt`/`skill`  
5. (dopo) recall M1 legge neuroni; deprecare sezioni duali UI
