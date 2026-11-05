# 50+ proposte di miglioramento — Plancia locale (LM Studio / Qwen / memoria)

Research snapshot: LM Studio 0.4.x (CLI/SDK, MCP, speculative decoding, OpenAI-compat `/v1`), llama.cpp continuous batching / speculative / KV cache, Qwen3.x MoE serving practice, RAG/memory best practices, plancia reliability/UI gaps found in audit. Solo proposte — nessuna deploy Render.

---

## A. Serving LLM locale (LM Studio / llama.cpp / Qwen)

1. **Pin modello via `lms` CLI** — avvio automatico di Huihui-Qwen3.6-35B… con `--context-length`, GPU offload e porta 23000 all’accensione di Bionic, così la plancia non parte “a vuoto”.
2. **Health gate pre-chat** — prima di ogni `/chat` locale, `GET /v1/models` + warmup ping; se fallisce, UI “cervello offline” invece di timeout silenzioso.
3. **Speculative decoding / MTP** — sfruttare il ramo MTP del GGUF (draft tokens) in LM Studio 0.4.x per abbassare latenza percettiva sulla 35B MoE.
4. **Contesto dinamico** — esporre slider o preset (4k / 8k / 16k / 32k) mappati su `LOCAL_LLM_CONTEXT` e su LM Studio, con warning RAM quando si alza.
5. **KV cache persistente** — riusare prefix cache tra turni della stessa sessione (llama.cpp / LM Studio) per sticky truth pack + system prompt lunghi.
6. **Continuous batching** — se più client (plancia + prove + function-board) colpiscono lo stesso endpoint, abilitare batching server-side per non serializzare tutto.
7. **Quantizzazione A/B** — tenere Q4_K come default e un profilo Q5_K / Q6 per “qualità alta” notturna, switchabile da function board.
8. **GPU layers auto-tune** — script che misura VRAM libera e setta `-ngl` / offload ottimale all’avvio su Bionic.
9. **Separare router 8B e cervello 35B** — porta 8070 (router veloce) + 23000 (cervello), come già ideato in `IDEE_MIGLIORAMENTO.md`, con routing esplicito nella plancia.
10. **Timeout differenziati** — `LOCAL_LLM_TIMEOUT_MS` corto per probe board, lungo per chat/agent; oggi un unico valore crea falsi errori.
11. **Retry con jitter** — su `ECONNRESET` / cold-load LM Studio, 2–3 retry esponenziali prima del fallback OpenRouter.
12. **Fallback policy esplicita in UI** — badge “Locale → OpenRouter” / “Locale → Mechanical” quando scatta `completeChat` fallback (già nel codice).
13. **Model fingerprint in health** — `/health.localLlm` riporta `id` esatto del modello caricato, non solo URL, per evitare mismatch stamp/prove.
14. **lms SDK / Node client ufficiale** — valutare `@lmstudio/sdk` al posto di fetch raw OpenAI per load/unload e progress.
15. **MCP tools in LM Studio 0.4** — collegare tool plancia (memory, map, function-board) come MCP server verso il modello locale.
16. **Prompt cache / sticky system** — file `system-voice-plancia.txt` versionato + hash in health; invalidazione solo su cambio.
17. **Grammar / JSON mode** — forzare risposte tool-call in JSON schema (llama.cpp grammar / LM Studio constrained) per ridurre allucinazioni di formato.
18. **Temperatura per rail** — chat creativa ≠ prove pack ≠ memory rewrite; profili `temp/top_p` per endpoint.
19. **Unload idle** — dopo N minuti senza chat, scaricare la 35B per liberare VRAM; reload on demand con spinner.
20. **LAN bind hardening** — LM Studio solo su `bionic.local` / IP LAN, firewall deny WAN; documentare in `CONFIG_LOCALE.md`.

---

## B. Memoria e cervello (244 neuroni / live)

21. **Compact + archive** — policy automatica: neuroni >90 giorni → archive file, live restano “hot” (sticky + recenti).
22. **Embedding locale** — piccolo modello embedding su Bionic per retrieval semantico sopra `memory/live` invece di solo keyword/limit.
23. **Dedup neuroni** — merge near-duplicate (hash + cosine) prima di gonfiare i 244+.
24. **Provenance UI** — ogni riga memoria mostra source (chat / prove / import / Philip-pipeline) e timestamp timezone Atlantic/Bermuda.
25. **Write-ahead log** — append-only JSONL delle mutazioni memoria prima del commit SQLite/JSON, per recovery crash.
26. **Memory still / rail-44 sync check** — job che confronta count live vs stamp prove e alert se diverge.
27. **Conflict resolution** — se due agent scrivono lo stesso id, last-write-wins con audit trail, non silent overwrite.
28. **Scoped memory packs** — pack “ops”, “persona”, “map” caricati solo quando il rail li richiede (meno token).
29. **Export GDPR-style** — un click export JSON/Markdown di tutta la memoria locale per backup Emilio.
30. **Import dry-run** — anteprima diff prima di importare dump memoria (evita overwrite accidentali).
31. **Philip → Pipeline rename** — allineare UI/docs: “Philip” non esiste in repo; etichettare Pipeline ovunque.
32. **Memory search API** — `GET /memory/live?q=` full-text + filtri tag, già parzialmente utile per UI.
33. **Decay scores** — neuroni raramente richiamati scendono di priorità nel prompt injection.
34. **Human review queue** — tag `needs-review` su allucinazioni rilevate, da approvare prima che restino sticky.

---

## C. Affidabilità, test, ops locale

35. **Morning smoke schedulato** — Task Scheduler / cron: 2–3 prompt + health + prove 35/35 → log PASS/FAIL (già in idee #2).
36. **Prove pack in CI locale** — `npm test` + prove script su ogni push branch `cursor/plancia-*` prima del merge mentale.
37. **Function-board zero unverified** — oggi 1 unverified; aggiungere probe o marcare esplicitamente “manual-only”.
38. **Circuit breaker OpenRouter** — dopo N fallimenti cloud, spegnere tentativi per M minuti (risparmio + meno rumore log).
39. **Structured error codes** — `NO_LOCAL_LLM`, `LM_TIMEOUT`, `BOARD_PROBE` stabili per UI e monitor live-ops.
40. **Log conversation append-only** — timestamp + route + model + tag (idea #1 esistente); utile per hillclimb prompt.
41. **Graceful shutdown button** — spegnimento dolce modelli + flush memoria (idea #3).
42. **Watchdog processo** — se `node src/server.js` muore, restart automatico su 8787 con alert file.
43. **Disk quota alert** — avviso se `agentq-memory` / logs superano soglia su Bionic.
44. **Timezone coerente** — tutte le UI/log in Atlantic/Bermuda con label zona (regola già richiesta).
45. **Cookie/session hardening** — SameSite, idle timeout, CSRF su POST login locale.
46. **Rate limit locale** — protezione accidentale flood da prove/loop agent contro LM Studio.
47. **Snapshot pre-change** — prima di migration memoria, zip automatico cartella brain.
48. **Diff stamp rail** — CI check che `?v=` / build stamp frontend = `atlasBuild` backend (fix drift rail-40 vs rail-44).
49. **Three-pass audit script** — automatizzare le 3 passate (health, memory count, board, prove) in un solo `npm run audit:local`.
50. **Live-ops monitor integration** — endpoint `/api/ops/snapshot` leggero per il timer 20m senza cold-start timeout.

---

## D. UI / UX plancia

51. **Stato LM Studio in header** — LED verde/giallo/rosso + modello + latenza ultimo token, sempre visibile.
52. **Skeleton loading chat** — invece di freeze durante cold load 35B.
53. **Streaming token UI** — SSE/OpenAI stream già compatibile; mostrare token in tempo reale.
54. **Rail legend always synced** — legend CSS/`?v=` allineati a rail-44; test snapshot HTML.
55. **Map Cesium progressive load** — tiles/imagery lazy; non bloccare first paint plancia.
56. **Keyboard palette** — Ctrl+K per saltare a memory / map / board / prove.
57. **Dark/light rispettoso** — evitare default purple-AI; restare sul visual system plancia esistente.
58. **Mobile first-ops** — health + chat + memory list usabili da telefono in LAN.
59. **Error toasts actionable** — “Apri LM Studio su Bionic” con link `http://bionic.local:23000` invece di stack trace.
60. **Function board filters** — filtra ok/error/unverified; click-to-retry singolo probe.
61. **Prove pack visual** — griglia 35 check con last-run timestamp e deep-link al fallimento.
62. **Conversation branching** — fork di un turno chat per confrontare locale vs OpenRouter side-by-side.
63. **Accessibilità** — focus ring, aria-live per stream, contrasto map overlays.
64. **Ridurre clutter hero/ops** — una composizione per viewport (regola design); ops secondarie sotto fold.

---

## E. Agentic / tool / integrazione

65. **Tool allowlist per sessione** — utente sceglie quali tool l’agente può chiamare (memory write, map fly, board).
66. **Dry-run tool calls** — mostrare intent tool prima di eseguire mutazioni.
67. **Parallel tool fan-out** — dove sicuro, parallelizzare letture (memory+health+board).
68. **Agent step budget** — max N tool round-trips per messaggio per evitare loop.
69. **Voice bridge** — client vocale → router 8B → cervello 35B con barge-in e endpointing.
70. **Webhook locale** — `POST /hooks/event` da script Windows (backup fatto, LM caricato) verso plancia toast.
71. **Git-aware context** — opzionale: iniettare `git status`/`diff` summary quando chat in modalità “dev”.
72. **Eval harness** — `defineEval`-style casi fissi (ciao, FAQ, memory recall, map) misurati a ogni hillclimb prompt.
73. **Sticky truth pack editor** — UI per editare truth pack con validazione schema e preview token count.
74. **Multi-user locale profiles** — profili Emilio vs ospite con memoria isolata (stesso server 8787).
75. **Offline docs pack** — bundle markdown `PROGETTO_LOCALE` cercabile in-app senza rete.

---

## F. Sicurezza e confini (locale only)

76. **No Render deploy accidentale** — script `deploy` richiede `CONFIRM_RENDER=1`; default refuse.
77. **Secrets scanner pre-commit** — blocca `.env` / API keys nei commit plancia.
78. **Path traversal audit** — memory/file APIs: allowlist directory sotto workspace.
79. **Prompt injection filters** — strip/segregate contenuti memoria quando reiniettati in system.
80. **Audit log access** — chi ha letto/scritto memoria (anche single-user, utile forensics).

---

## G. Performance percepita

81. **Warmup on login** — dopo login plancia, ping LM Studio + prefetch memory count in background.
82. **HTTP keep-alive pool** — agent `fetch` verso `bionic.local` con keep-alive per tagliare handshake.
83. **Compress memory payloads** — gzip `memory/live` quando count alto.
84. **CDN-free static cache** — Cache-Control lungo su stamp `?v=rail-44-…` assets.
85. **Prefer 127.0.0.1 su stessa macchina** — se plancia e LM Studio co-hosted, skip mDNS `.local`.

---

_Totale: 85 proposte. Priorità suggerita immediata: 2, 10–12, 35, 48–50, 51, 76 (affidabilità + chiarezza stato locale)._
