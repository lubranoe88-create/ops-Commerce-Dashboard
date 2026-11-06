# PROGETTO LOCALE — Atlas plancia sul PC di Emilio

Due mondi **separati**. Nessun collegamento tra loro.

| | **PC locale (questo progetto)** | **Render** |
|---|----------------------------------|------------|
| Ruolo | Stack **completo** autonomo: frontend + backend + cervello | Deploy **separato**, resta online così com’è |
| Dati | `brain-neurons.json`, `expandable.json`, ~123 skill sul disco PC | Propri disco / env cloud — **nessuna** condivisione col PC |
| Rete | Solo `http://127.0.0.1:8787` | `ops-commerce-dashboard.onrender.com` |
| Link API / proxy / tunnel | **Vietati** verso Render e viceversa | **Nessuna** dipendenza dalla macchina di Emilio |

**Non** collegare locale con Render. **Non** puntare il frontend Render al backend del PC. **Non** sincronizzare o proxy-are memoria tra i due.

## Regola permanente (standing rule)

> **Ogni futuro aggiornamento plancia deve aggiornare anche questa pipeline locale**  
> (`DEPLOY_PIANCIA/PROGETTO_LOCALE/` + checklist).  
> Il progetto locale e Render restano due installazioni indipendenti.

---

## 1. Architettura (solo PC)

```
PC Windows — stack chiuso
────────────────────────
browser ──► http://127.0.0.1:8787
               │
               ▼
        backend Node (Express)
          ├─ frontend statico (backend/public)
          ├─ API /api/ai/agentq/memory*
          ├─ atlasBrain.js → brain-neurons.json
          └─ expandable.json

LM Studio su desktop Bionic (LAN)
  http://bionic.local:23000/v1  — Qwen locale (COLLEGAMENTO_PLANCIA.md)
  (fallback hostname: bionic)

Render ── (nessuna freccia) ── non fa parte di questo diagramma
```


Un processo Node sul PC serve UI + API + memoria (same-origin). Nessun URL Render nelle chiamate.

| Pezzo | Dove | Path |
|-------|------|------|
| Frontend | PC | `backend/public/` |
| Backend | PC | `backend/src/server.js` → `npm start` |
| Cervello | PC | `ATLAS_MEMORY_DIR/brain-neurons.json` |
| Sticky | PC | `expandable.json` |
| Skill (~123) | PC | neuroni `kind: skill` |

---

## 2. Struttura cartelle (sul PC)

```
ops-Commerce-Dashboard/          # copia sul disco del PC
├── backend/
│   ├── public/                  # UI locale
│   ├── src/server.js
│   ├── src/services/atlasBrain.js
│   ├── data/agentq-memory/      # cervello PC (non cancellare)
│   │   ├── brain-neurons.json
│   │   └── expandable.json
│   ├── .env                     # da env.plancia-locale.example
│   └── package.json
└── DEPLOY_PIANCIA/PROGETTO_LOCALE/
    ├── PROGETTO_LOCALE.md
    ├── MEMORIA_LOCALE_PC.md
    ├── start-plancia-locale.ps1
    ├── start-plancia-locale.bat
    └── env.plancia-locale.example
```

Memoria fuori repo (opzionale): `set ATLAS_MEMORY_DIR=D:\AtlasMemory`

---

## 3. Porte (solo locale)

| Servizio | Porta |
|----------|------:|
| Plancia UI+API+memoria | **8787** → `http://127.0.0.1:8787` |
| LM Studio su Bionic (LAN) | **23000** → `http://bionic.local:23000` |
| llama.cpp (opz., alternativa) | 8080 |
| router (opz.) | 8070 |

`HOST=127.0.0.1` — niente esposizione Internet. Nessuna porta verso Render.

---

## 4. Frontend ↔ backend (tutto sul PC)

1. Avvia il backend locale (`npm start` / script sotto).
2. Apri **http://127.0.0.1:8787** (solo questo host per lo stack PC).
3. Login con la password del `.env` **locale**.
4. MEMORY chiama `/api/ai/agentq/memory/live` sullo **stesso** origin locale.

Niente `VITE_` verso Render, niente proxy, niente tunnel, niente CORS cross-deploy.

---

## 5. Avvio

**Prima volta**

```bat
cd backend
npm ci
copy ..\DEPLOY_PIANCIA\PROGETTO_LOCALE\env.plancia-locale.example .env
notepad .env
```

**Ogni sessione:** doppio clic `start-plancia-locale.bat` oppure:

```bat
cd backend
set HOST=127.0.0.1
set PORT=8787
set ATLAS_MEMORY_DIR=%CD%\data\agentq-memory
npm start
```

Poi browser → `http://127.0.0.1:8787`.

---

## 6. Checklist Emilio

- [ ] Node ≥ 20 sul PC
- [ ] Copia plancia su disco fisso
- [ ] `agentq-memory` (o `ATLAS_MEMORY_DIR`) con le ~123 skill
- [ ] Backup periodico di quella cartella
- [ ] `.env` locale (password, `COOKIE_SECURE=false`, host 127.0.0.1)
- [ ] `npm ci` + `npm start` → listen su 8787
- [ ] Uso quotidiano cervello: solo `127.0.0.1:8787`
- [ ] Render lasciato stare — **zero** integrazioni col PC
- [ ] Ad ogni update plancia: aggiornare anche `PROGETTO_LOCALE/`

---

## 7. Pipeline update

Ad ogni release plancia: aggiornare codice/docs di **questo** progetto locale e verificarlo sul PC. Render, se aggiornato, è un deploy **indipendente** (nessun passo “collega a Emilio”).

---

## 8. Cosa non fare

- Collegare / proxy / tunnel tra PC e Render
- Puntare il frontend Render alle API del PC (o il contrario)
- Condividere `brain-neurons.json` / cookie / password tra i due ambienti come se fossero uno
- Spegnere Render “per far posto” al locale
- Cancellare `agentq-memory` sul PC senza backup

---

## 9. Riferimenti

| Doc | Ruolo |
|-----|--------|
| `MEMORIA_LOCALE_PC.md` (questa cartella) | Memoria = solo PC; separazione da Render |
| `../COLLEGAMENTO_PLANCIA.md` | LLM locale sul PC |
| `../CONFIG_LOCALE.md` | llama.cpp |
| `backend/.env.example` | Variabili (base); preferisci `env.plancia-locale.example` |
