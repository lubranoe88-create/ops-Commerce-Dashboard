# Modulo 4 — Chat con l’AI del dashboard (solo design, niente UI)

Stato: **spec**. Non implementare l’UI.

| Modulo | Vista |
|---|---|
| **1** | Globo 3D mondo — `docs/map-module-design.md` |
| **2** | Grafo 3D pipeline — `docs/pipeline-graph-module-design.md` |
| **3** | Memoria grafo 5D — `docs/memory-graph-module-design.md` |
| **4** | Questo documento — **chat** (testo + voce) sull’AI economica OpenRouter |

Tema: **dark military / COP ops**, coerente con i moduli 1–3 (feeling sala operativa, non chat consumer colorata). Niente asset Palantir.

---

## Obiettivo

Interfaccia conversazionale per **parlare col dashboard**: domande su top revenue, fallimenti, bottleneck, pipeline health, memoria, correzioni, copertura.  
Il modello economico OpenRouter è la **facciata conversazionale** sui dati già raccolti/filtrati — non sostituisce la pipeline meccanica né cerca a scala sul web a ogni messaggio.

---

## 1) Cronologia chat salvata (resume)

| Requisito | Specifica |
|---|---|
| Persistenza | **SQLite locale** (es. tabelle `chat_threads`, `chat_messages`) |
| Thread | Lista conversazioni con titolo, `created_at`, `updated_at` |
| Messaggi | `role` user/assistant/system, `content`, `created_at`, optional `audio_ref` |
| Resume | Come una chat AI normale: riapri thread → scroll storia → continua |
| Binding memoria | Opzionale link a `conversations` / reliability già in memory module; non duplicare logica giudice top |
| Sicurezza | Dietro `SITE_PASSWORD`; niente API key in frontend |

Flusso: nuovo chat · elenco storici · elimina/archivia (futuro).

---

## 2) Tema dark military (allineato 1–3)

- Sfondo nero/ops, testo chiaro, accenti **ciano**  
- Header compatto: modello in uso (low-cost), stato backend, eventuale PIPELINE HEALTH in sola lettura  
- Bolle messaggio sobrie (no gradienti/emoji decorativi)  
- Input fisso in basso: testo + mic + send  
- Coerenza tipografica con COP degli altri moduli  

---

## 3) Funzione voce

| Direzione | Specifica |
|---|---|
| **Input** | L’utente pone **qualsiasi domanda a voce** (mic → speech-to-text locale o API STT; testo finisce nel thread come messaggio user) |
| **Output** | Risposta AI anche in **audio** (text-to-speech sulla risposta assistant; play automatico opzionale + replay) |
| Controlli | Mic on/off, mute TTS, mostra sempre il testo trascritto/risposta per accessibilità |
| Fallback | Se voce non disponibile → solo testo |
| Privacy | Audio non obbligatorio in cloud se STT/TTS locali; se cloud, key solo server-side |

La voce è un canale I/O; il cervello resta OpenRouter economico via backend esistente (`POST /api/chat` + cookie auth).

---

## Ruolo del modello (OpenRouter economico)

- **Fa:** rispondere in linguaggio naturale usando **contesto dashboard** (tops, consistency, health, errori, coverage, correzioni utente, dossier già in memoria).  
- **Non fa:** raccolta grezza sulle 17 piste; filtro rumore a scala; bypass delle regole meccaniche / soglie / user corrections.  
- Contesto in prompt: snapshot meccanico + regole attive; token solo sulla conversazione (e giudice ranking resta flusso separato se già definito).

System prompt di design (idea): *“Sei l’interfaccia conversazionale del dashboard. Usa solo i dati forniti. Rispetta regole meccaniche e correzioni utente. Non inventare revenue non verificati.”*

---

## Layout COP Modulo 4

```
[ CHAT OPS | thread title | model low-cost | auth ok ]
[ Lista thread ]     [ Messaggi testo (± waveform TTS) ]
                     [ mic | text input | send ]
```

---

## Dati (SQLite — design)

**chat_threads:** `id`, `title`, `created_at`, `updated_at`, `meta_json`  
**chat_messages:** `id`, `thread_id`, `role`, `content`, `created_at`, `speech_input` bool, `tts_played` bool, `meta_json`  

Opzionale: `audio_blobs` o path file locali per replay (non obbligatorio in v1).

---

## Collegamento backend esistente

- Auth: stesso gate password  
- LLM: `OPENROUTER_API_KEY` server-side, modello economico env  
- Rate limit / validazione prompt già previsti su `/api/chat`  
- Estensione futura: endpoint thread CRUD + STT/TTS proxy server-side  

---

## Cosa non fare

- Build UI in questo passo  
- Mettere la key OpenRouter in pagina  
- Far “cercare il mondo” a ogni turno vocale bypassando la pipeline  
- Tema chiaro consumer / bubble colorate tipo social  

---

## Relazione moduli

1–3 = **vedere** mondo / pipeline / memoria · **4** = **chiedere e ascoltare** spiegazioni sui dati già nel sistema  

**Niente build UI in questo passo.**
