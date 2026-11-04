# Memoria Atlas = solo disco del PC locale

**Regola di Emilio:** il cervello (`brain-neurons.json`, `expandable.json`, skill, heritage) vive **solo sul PC Windows**, su disco locale illimitato.  
**Non** salvare il brain su Render (disco free ephemeral / limiti di spazio).  
Render, se usato, è al massimo **frontend**; il preferito è far girare **tutto in locale**.

## Cosa resta sul PC

| Path | Contenuto |
|------|-----------|
| `backend/data/agentq-memory/brain-neurons.json` | Cervello unificato (skill, prompt, …) |
| `backend/data/agentq-memory/expandable.json` | Note sticky / append |
| (opz.) `ATLAS_MEMORY_DIR` | Cartella alternativa persistente, es. `D:\AtlasMemory` |

Oggi in workspace: **~123 skill** già sul brain locale — fonte di verità.

## Avvio stack completo in locale (consigliato)

1. Installa **Node.js ≥ 20** sul PC.
2. Copia/clona il repo plancia sul disco locale (SSD/HDD interno, non sola cartella temp).
3. Nella cartella `backend`:
   ```bat
   npm ci
   set ATLAS_MEMORY_DIR=%CD%\data\agentq-memory
   set HOST=127.0.0.1
   set PORT=8787
   npm start
   ```
   Oppure PowerShell:
   ```powershell
   cd backend
   npm ci
   $env:ATLAS_MEMORY_DIR = (Join-Path $PWD "data\agentq-memory")
   $env:HOST = "127.0.0.1"
   $env:PORT = "8787"
   npm start
   ```
4. Apri il browser su **http://127.0.0.1:8787** (UI + API + memoria sullo stesso processo).
5. (Opzionale voce/LLM) avvia `start-llama-server.bat` come in `COLLEGAMENTO_PLANCIA.md`.

Il server Express serve già `public/` **e** le API `/api/ai/agentq/memory*`: non serve un secondo servizio per la memoria.

## Cosa fa Emilio sul suo lato

1. Tenere il repo (o una copia) su disco fisso del PC.
2. Lanciare `npm start` in `backend` (o uno script `.bat` dedicato) **prima** di usare MEMORY.
3. Non punta MEMORY a `ops-commerce-dashboard.onrender.com` se vuole il cervello locale.
4. Backup periodico della cartella `data\agentq-memory\` (copia su altro disco).
5. **Non** serve esporre porte su Internet se usa solo browser sullo stesso PC (`127.0.0.1`).
6. Se un giorno vuole UI su un altro device in LAN: bind `HOST=0.0.0.0` e firewall solo sulla LAN — **non** pubblicare il brain su Render.

## Variante “UI su Render, API memoria sul PC” (sconsigliata)

Richiede tunnel (Cloudflare Tunnel / ngrok) dal PC verso HTTPS, CORS, e cookie/auth allineati.  
Emilio dovrebbe fornire l’URL pubblico del tunnel **solo se** sceglie questa variante.  
Default del progetto: **stack intero in locale**, Render fuori dal percorso memoria.

## Cosa non fare

- Non commitare seed-pack di skill “per Render”.
- Non affidarsi a `ATLAS_MEMORY_DIR=data/atlas-memory` sul free tier Render.
- Non cancellare `backend/data/agentq-memory` sul PC senza backup.
