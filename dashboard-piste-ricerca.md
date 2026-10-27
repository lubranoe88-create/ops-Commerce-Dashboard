# Dashboard olografica — layer di ricerca

## Architettura ricerca + AI (concordata)

1. **Pipeline meccanica, free/low-cost** — raccoglie dati grezzi da tutte le **17** fonti sotto; niente AI in raccolta. OSS verificato: **browser-use** (collection).
2. **Score preliminare meccanico** — **PyOD** (+ regole) per anomalie zero-token; poi buffer notturno di conferma.
3. **Router agenti** — seleziona pochi specialisti; orchestrazione futura **LangGraph** (primaria) / **CrewAI** (alternativa).
4. **Agenti finance open** — **FinRobot** / **FinGPT** solo se selezionati (filing/NLP); non sul low-cap informale da soli.
5. **AI = giudice finale** — modello economico OpenRouter solo per top ranking o causa anomalia; token solo sulle **decisioni**.
6. **Post-verifica** — **OpenBusiness** approfondisce modello di business / settore / operazioni **solo** sui top già verificati.
7. **Sicurezza invariata** — `SITE_PASSWORD`; chiave OpenRouter solo server-side; 17 piste intatte.

Dettaglio integrazione: `backend/docs/OSS_INTEGRATION.md` (dipendenze pesanti **non** installate).

**Modulo 1 — mappa (design only):** **globo 3D ruotabile**, satellitare scura, overlay ops. Spec: `docs/map-module-design.md`.

**Modulo 2 — pipeline (design only):** **grafo 3D** delle 17 piste (zoom/rotazione, volume, verified/unverified, agent allegati) + **PIPELINE HEALTH** + **registro errori**. Spec: `docs/pipeline-graph-module-design.md`.

**Modulo 3 — memoria (design only):** **grafo 5D ruotabile** (concetti + neural links), regole anti-errore e consistency ranking; update in **SQLite locale** senza token AI. Spec: `docs/memory-graph-module-design.md`.

**Correzioni prodotto (design only):** (1) Correct/Incorrect + una riga → regola meccanica immediata in SQLite; (2) soglie verifica — filing forte standalone, news con corroborazione; (3) `coverage_degree` per area/settore. Spec: `docs/corrections-and-coverage-design.md`.

**Modulo 4 — chat (design only):** chat con **cronologia riprendibile**, tema ops scuro, **voce in/out**; modello economico OpenRouter come interfaccia ai dati del dashboard. Spec: `docs/chat-module-design.md`. UI non costruita.

> Ordine di lavoro: 1) scopo e informazioni → 2) struttura, sicurezza e pagina → 3) miglioramenti. Nessuna key nel frontend.

---

## 1. Piste di ricerca (17)

### 01. Filing legali
Revenue formale, contratti pubblici e pipeline R&D da bilanci, gare e brevetti depositati.

### 02. Marketplace B2B
Volume e domanda fornitura (Alibaba, ThomasNet) prima che appaiano nei bilanci.

### 03. Forum di settore e Telegram import
Prezzi reali, lead time e stress di filiera prima che diventino pubblici.

### 04. Dati satellitari aperti
Proxy di produzione e logistica da luci notturne e traffico portuale.

### 05. Piattaforme indie
Traction di business piccoli/nuovi (Gumroad, Etsy, Stripe) assenti dai grandi registri.

### 06. Community di founder
Revenue self-reported (Indie Hackers) come early signal da triangolare.

### 07. Report piattaforme di fatturazione
Volumi aggregati anonimi (Stripe Atlas, Paddle) per trend di pagamento digitale.

### 08. Tracking accelerator
Crescita early-stage da portfolio pubbliche (es. Y Combinator).

### 09. Database acquisizioni
Funding/M&A (Crunchbase Pro, PitchBook) incrociati con filing fondi europei.

### 10. Licenze e permessi pubblici
Aperture, chiusure e capacità operativa autorizzata come indicatore di volume.

### 11. Dichiarazioni doganali
Flussi import-export ufficiali e shock di supply chain per codice merce.

### 12. Pattern WHOIS / domini
Lanci brand, shell digitali e attività pre-mercato da burst di registrazioni.

### 13. Segnali di hiring
Espansione o contrazione operativa (LinkedIn, Indeed) prima dei bilanci.

### 14. Entità offshore e holding
Strutture di controllo (Delaware, Lussemburgo) che mascherano il commercio reale.

### 15. Recensioni clienti
Volume e momentum di vendita da Trustpilot, Google Reviews e piattaforme simili.

### 16. Traffico web
Proxy di domanda e reach da fonti come SimilarWeb.

### 17. Brevetti di business model
Protezione di processi innovativi come segnale di modelli commerciali proprietari.

---

## 2. Modelli AI (OpenRouter) — solo decisioni

Ruolo: **giudice finale** (top ranking / causa anomalia). Non raccolta, non filtro rumore a scala.

### Small Llama (via OpenRouter)
Decisioni di ranking e spiegazione anomalie — non ricerca.

### Mistral small / low-cost (via OpenRouter)
Decisioni di ranking e spiegazione anomalie — non ricerca.

Chiave solo backend · credito/wallet · costo token solo sulle decisioni.
