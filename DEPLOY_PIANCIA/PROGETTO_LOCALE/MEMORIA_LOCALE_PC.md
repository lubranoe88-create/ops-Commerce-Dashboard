# Memoria Atlas = solo disco del PC locale

**Separazione totale:** il progetto locale sul PC e il sito Render sono **due sistemi indipendenti**.  
Niente API link, niente proxy, niente tunnel, niente dati condivisi.

| | PC locale | Render |
|---|-----------|--------|
| Cervello | `brain-neurons.json` + `expandable.json` + ~123 skill sul disco Windows | Store cloud proprio (se c’è) — **non** è il cervello di Emilio |
| UI / API | `http://127.0.0.1:8787` (frontend + backend insieme) | Deploy separato, resta online, **senza** dipendere dal PC |

## Path sul PC

| Path | Contenuto |
|------|-----------|
| `backend/data/agentq-memory/brain-neurons.json` | Cervello unificato |
| `backend/data/agentq-memory/expandable.json` | Note sticky |
| `ATLAS_MEMORY_DIR` (opz.) | Es. `D:\AtlasMemory` |

## Avvio (solo PC)

```bat
cd backend
npm ci
set ATLAS_MEMORY_DIR=%CD%\data\agentq-memory
set HOST=127.0.0.1
set PORT=8787
npm start
```

Browser: **http://127.0.0.1:8787** — non usare l’URL Render per questo cervello.

Dettaglio stack: `PROGETTO_LOCALE.md` nella stessa cartella.

## Cosa non fare

- Collegare memoria PC ↔ Render
- Puntare il frontend Render al backend del PC
- Seed-pack cloud al posto del brain sul disco
- Cancellare `agentq-memory` senza backup
