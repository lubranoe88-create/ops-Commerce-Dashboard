# Correzioni operative dashboard — design spec (niente UI)

Tre correzioni di prodotto. Si applicano a memoria, pipeline e mappa. **Solo documentazione**; nessuna build UI.

---

## 1) Meccanismo di correzione utente (top list)

### Cosa
Su **ogni voce della top list** (daily tops): controlli **Correct** / **Incorrect**.  
Se Incorrect: campo **una riga** (perché era sbagliato).

### Dove vive
- Persistenza immediata in **SQLite locale** (nuova tabella di design, es. `user_corrections`).  
- Campi tipici: `id`, `day_key`, `business_key`, `rank_at_time`, `verdict` (`correct`|`incorrect`), `reason_line`, `created_at`, `rule_id`.

### Effetto (senza attendere l’AI)
1. Salvataggio in DB al submit.  
2. Derivazione immediata di una **regola meccanica** (es. escludi/penalizza `business_key`, pair fonte+pattern, settore, o fingerprint del claim).  
3. La regola entra nel **filtro meccanico** (pre-giudice / pre-top) al ciclo successivo **subito** — non in coda OpenRouter.  
4. Opzionale: rinforzo anti-errore in memoria (quarantena concetto/business, decay link) via calcoli locali.  
5. L’AI giudice può *leggere* le regole in un dossier futuro, ma **non** è richiesta per attivarle.

### UI (solo spec)
Pulsanti sulla riga top; se Incorrect → input monolinea + salva. Feedback “regola attiva”.

### Cosa non fare
- Aspettare il modello economico per applicare la correzione.  
- Saggi lunghi: **una riga**.

---

## 2) Strategia soglie di verifica (più candidati, stessa affidabilità)

Obiettivo: far passare **più candidati** senza abbassare l’affidabilità percepita — soglie **differenziate per forza della fonte**.

| Classe segnale | Esempio | Soglia |
|---|---|---|
| **Forte (standalone)** | Bilancio annuale depositato / filing XBRL ufficiale | **Basta da sola** → può marchiare revenue/claim come `verified` (o `verified_strong`) |
| **Media** | Dogane aggregate, licenze, hiring spike multi-giorno | Preferibile 1 segnale di supporto o soglia quantitativa |
| **Debole** | Notizia di settore, forum/Telegram, single review burst | **Almeno un altro segnale** indipendente (corroboration) prima di `verified` |

### Regole di design
- News di settore **da sola** → `unverified` o `partial`, non entra nel top “hard” finché non c’è corroborazione.  
- Concorroborazione: altra pista (filing, dogane, hiring, satellitare, ecc.) sullo stesso `business_key` / area entro finestra temporale.  
- Pipeline health e nodi Modulo 2 usano gli stessi stati.  
- Giudice AI resta solo per ranking/anomalia **dopo** il filtro meccanico + soglie.

---

## 3) Trasparenza di copertura (geo / settore)

Per ogni **macro-area geografica** e/o **settore**, dichiarare il **grado di copertura** così l’utente sa quanto manca — niente illusione di completezza globale.

| Campo | Specifica |
|---|---|
| Chiave | `area_key` (geo) e/o `sector_key` |
| Metrica | `coverage_degree` 0–100 (o bande: low / mid / high) |
| Significato | Quanto della popolazione attesa di segnali/fonti è effettivamente osservata oggi |
| Input tipici | Fonti attive vs attese per area; volumi vs baseline; errori open; lag filing |
| UI mappa (Modulo 1) | Overlay o etichetta per regione; legenda “copertura”; click → dettaglio cosa manca |
| UI pipeline (Modulo 2) | Badge aggregato per cluster geo/settore se disponibile |
| Messaggio utente | Testo corto tipo “Copertura stimata 35% — non interpretare come censimento completo” |

Calcolo: **meccanico** in SQLite/job; non LLM.

---

## Impatto moduli

| Modulo | Aggiornamento |
|---|---|
| **1 Mappa** | Choropleth/layer `coverage`; non assumere completezza; punti top solo se passano soglie |
| **2 Pipeline** | Stati verified secondo soglie; health considera copertura e correzioni; errori ↔ correzioni utente |
| **3 Memoria** | `user_corrections` + regole meccaniche; anti-errore immediato; consistency non conta entry smentite dall’utente finché regola attiva |
