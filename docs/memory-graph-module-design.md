# Modulo 3 — Memoria a lungo termine come grafo 5D (solo design, niente UI)

Stato: **spec**. Non implementare l’UI.

| Modulo | Vista |
|---|---|
| **1** | Globo 3D mondo — `docs/map-module-design.md` |
| **2** | Grafo **3D** pipeline 17 piste — `docs/pipeline-graph-module-design.md` |
| **3** | Questo documento — **memoria / neural links** in grafo **ruotabile a 5 dimensioni** |
| **4** | Chat testo+voce — `docs/chat-module-design.md` |

Tema: dark military / COP ops, coerente con Moduli 1–2 (feeling ops **senza** copiare asset Palantir).

Store sottostante: **SQLite locale** (`backend/src/memory/`). Aggiornamenti di apprendimento = **calcoli semplici in locale**, **non** chiamate token AI / OpenRouter.

---

## Obiettivo

Visualizzare la memoria duratura: **concetti = nodi**, **collegamenti neurali = archi**, più **regole anti-errore** e **ranking di consistenza** (mese/anno), così si vede come il sistema impara nel tempo e confronta i top giorno per giorno.

---

## Grafo a 5 dimensioni (ruotabile)

Non è un globo terra (Modulo 1) né il piano pipeline (Modulo 2). È uno **spazio concettuale** in cui l’utente ruota la proiezione per vedere tutti gli aggiornamenti.

### Le cinque dimensioni

| Dim | Nome | Significato | Encoding tipico |
|---|---|---|---|
| **D1** | Layout X | Separazione semantica / cluster | Posizione asse X (force / PCA locale) |
| **D2** | Layout Y | Separazione semantica / cluster | Posizione asse Y |
| **D3** | Layout Z | Profondità di cluster / generazioni di link | Posizione asse Z (vista 3D orbitale) |
| **D4** | Tempo / freschezza | Quando il concetto/link è stato rafforzato | Colore temperatura, trail, o asse “tempo” selezionabile in rotazione |
| **D5** | Affidabilità × consistenza | `reliability_ema` + `consistency_score` (o peso link) | Dimensione nodo / spessore arco / saturazione |

**Rotazione “5D” (UX):** controlli orbit su D1–D3 + selettore di **piano di proiezione** (es. mostrare D4 o D5 come asse al posto di Z) e/o dial “slice” temporale, così si esplorano tutti gli update senza perdere il grafo. Reset view obbligatorio.

Default: orbit 3D su D1–D3; D4/D5 sempre leggibili via colore/size anche quando non sono assi.

---

## Nodi — concetti

Da tabella `concepts` (+ join opzionale a business/consistency):

- `slug`, `label`  
- `mention_count` → base size  
- `reliability_ema` → D5 / alone  
- `first_seen_at` / `last_seen_at` → D4  
- Opzionale: badge se il concetto è anche un `business_key` in `business_consistency` (streak / appearance)

Stile: fill grigio-scuro, bordo ciano se high reliability, alone verde se high consistency, alone rosso se sotto quarantine anti-errore.

---

## Archi — neural links

Da `concept_links`:

- `weight`, `evidence_count`, `last_reinforced_at`, `kind` (default `co_occurrence`)  
- Stroke ciano debole; spessore ∝ weight; **pulse** solo su link rafforzati “oggi”  
- Decay visuale se `last_reinforced_at` vecchio (D4)

---

## Regole anti-errore (learning locale)

Apprendimento **nel DB**, non via LLM. La viz le rende visibili.

| Regola | Comportamento (calcolo SQLite/app) | Effetto sul grafo |
|---|---|---|
| Quarantena fonte | Fonti `failed`/`suspicious` (Modulo 2 registry) non rinforzano link | Nodi/archi da quelle evidence restano grigi o non crescono |
| No promote su errore | Candidati da fonti open-error non aggiornano `daily_tops` / consistency | Nessun “jump” di size verso il verde |
| Decay | Pesi link non rinforzati decadono lentamente (formula fissa) | Archi si assottigliano nel tempo |
| EMA reliability | `reliability_ema` aggiornata solo da conversazioni/score affidabili | Alone nodi |
| Reorg post-conversazione | Dopo ogni save: upsert concetti + reinforce co-occorrenze (`reorganizeAfterConversation`) | Nuovi nodi/archi compaiono al refresh |
| Gate OpenBusiness | Deepen solo post revenue-verified | Non crea rumore di concetti da claim non verificati |
| **Correzione utente** | Incorrect + una riga → riga SQLite + **regola meccanica immediata** (filtro pre-top) | Nodo/business in quarantine visuale; niente attesa AI |
| **Soglie verifica** | Fonte forte standalone; news solo con corroborazione | Solo evidence che passa le soglie rinforza EMA/link |
| **Coverage** | `coverage_degree` per area/settore in meta memoria | Overlay/legenda: non assumere grafo “completo” |

Dettaglio: `docs/corrections-and-coverage-design.md`.

---

## Consistency ranking (integrato nella stessa vista)

Da `business_consistency` (finestre `month` / `year`):

- Pannello o layer overlay: top consistenti (appearance_count, current_streak, max_streak, consistency_score)  
- Nodi business evidenziati se in top consistency  
- Toggle `month` | `year`  
- Confronto “ieri vs oggi” sui daily tops = highlight delta rank (freccia su/giù sul nodo), calcolato in SQL  

---

## Layout COP Modulo 3

```
[ MEMORY 5D | day | last reorg | anti-error: ON ]
[ Assi / piano proiezione: D1–D5 ] [ month|year consistency ]
[ GRAFO 5D RUOTABILE: concepts + neural links ]
[ Dettaglio concetto/link ] [ Consistency top ]
[ Legenda: reliability · freschezza · peso link · quarantine ]
```

---

## Aggiornamenti — dove vivono

| Operazione | Dove | AI tokens? |
|---|---|---|
| Save conversation + sources + reliability | SQLite `conversations*` | No |
| Reorganize concepts/links | SQLite + `reorganize.js` | No |
| Consistency frequency/streaks | SQLite + `consistency.js` | No |
| Anti-error quarantine flags | SQLite / job log (allineato Modulo 2) | No |
| **User corrections → mechanical rules** | SQLite `user_corrections` + rule apply | No |
| Verification thresholds / corroboration | Job meccanico | No |
| Coverage degree per area/settore | SQLite / aggregati job | No |
| OpenRouter judge | Fuori da questo modulo (solo decisioni ranking) | Sì, solo lì |
| Render grafo 5D | Client viz su snapshot SQLite | No |

**Nota consistency:** entry smentite da correzione utente attiva **non** incrementano streak/appearance finché la regola non è revocata.

---

## Binding dati (già nello scaffold memoria)

- `concepts`, `concept_links`, `conversation_concepts`, `reorg_runs`  
- `daily_tops`, `business_consistency`  
- (futuro) flag `quarantine` / join a error registry  

---

## Cosa non fare

- Usare OpenRouter per “imparare” pesi o layout  
- Confondere Modulo 3 col globo terra o col grafo 17 fonti  
- Copiare UI Palantir  
- Build UI in questo passo  

---

## Relazione tra moduli

1 = **dove** nel mondo · 2 = **come** cerca la macchina · 3 = **cosa ha imparato** e quanto è stabile nel tempo  

**Niente build UI in questo passo.**
