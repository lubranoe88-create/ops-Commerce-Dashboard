# Idee di miglioramento — plancia + LLM locale

Tre proposte per lo stack già descritto in questa cartella  
(llama.cpp, router 8B, cervello 35B, memoria unificata plancia–Atlas).  
Solo idee: nessuna esecuzione qui.

---

## 1) Logging conversazioni (timestamp + tag)

**Descrizione**  
Salvare ogni turno vocale/testuale con ora, percorso (`router` / `brain`), modello usato, testo utente, risposta Atlas, eventuali tool bloccati o errori. Tag semplici (`ok`, `errore-tool`, `allucinazione`, `latenza`) per rivedere i fallimenti e correggere il prompt di sistema.

**Priorità suggerita:** alta (prima di allargare i tool in produzione).

**Integrazione nello stack**  
- Scrivere un file append-only nella **stessa** cartella memoria unificata (es. accanto a `expandable.json`), non un secondo “cervello”.  
- Il client ibrido (`hybrid_voice_client` / futuro bridge plancia) logga dopo ogni decisione di route 8B→35B.  
- Il validatore tool aggiunge tag se uno schema fallisce.  
- Revisione umana: filtrare per tag e aggiornare `system-voice-plancia.txt` / sticky truth pack.

---

## 2) Test automatico ogni mattina

**Descrizione**  
Script schedulato (Task Scheduler Windows) che al mattino manda 2–3 domande campione («Ciao», una FAQ, una che richiede memoria/tool) a router e cervello, controlla risposta e salute memoria, e segnala (file log / avviso) se qualcosa non risponde.

**Priorità suggerita:** media (dopo che server locale e collegamento plancia sono stabili).

**Integrazione nello stack**  
- Riusa `hybrid_voice_client.mjs` o un `morning_smoke.mjs` gemello contro `:8070` e `:8080`.  
- Verifica anche lettura della memoria unificata (list expandable / sqlite locale), senza API cloud.  
- Esito `PASS`/`FAIL` in un JSON nella cartella deploy o in `agentq-memory` / `atlas-memory`.  
- Non spegne i modelli: solo ping leggero (ctx corto, pochi token).

---

## 3) Pulsante di spegnimento dolce

**Descrizione**  
Un controllo “Spegni dolce” che: smette di accettare nuove chiamate, aspetta il turno in corso, salva memoria e log, poi chiude i processi `llama-server` (router e cervello) in ordine.

**Priorità suggerita:** media-alta (evita file a metà e sessioni perse sul PC Windows).

**Integrazione nello stack**  
- Script `stop-soft.ps1` / `.bat` in `scripts/`, richiamabile anche da un bottone UI plancia.  
- Ordine: (1) flag “non accettare turni”, (2) flush memoria unificata + log conversazioni, (3) stop router `:8070`, (4) stop cervello `:8080`.  
- Nessun nuovo store: solo chiusura ordinata di ciò che già esiste.  
- All’accensione successiva: ripartono gli stessi path GGUF e la stessa cartella memoria.
