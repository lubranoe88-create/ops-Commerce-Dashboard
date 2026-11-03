# Indice cartella DEPLOY_PIANCIA

Pacchetto da copiare sul PC Windows. Nessuna esecuzione automatica.

| File / cartella | Contenuto |
|-----------------|-----------|
| `RIEPILOGO.md` | Tutta la chiamata: hardware, problema, top 5, verdetto, stack, cosa non usare |
| `CHECKLIST.md` | Passi ordinati sul PC |
| `CONFIG_LOCALE.md` | Flag esatti cervello 35B-A3B (`-ngl`, `-ncmoe`, ctx, thinking off) |
| `ROUTER_PICCOLO.md` | Router Qwen3-8B + fallback 35B, VRAM, integrazione stack |
| `COLLEGAMENTO_PLANCIA.md` | Come la plancia parla all'LLM oggi; perché Cursor non basta; come collegare llama.cpp |
| `IDEE_MIGLIORAMENTO.md` | Logging conversazioni, test mattutino, spegnimento dolce |
| `README.md` | Install llama.cpp, download GGUF, avvio |
| `INDICE.md` | Questo elenco |
| `config/llama-server.env.example` | Env cervello |
| `config/llama-server.json` | Profilo JSON cervello |
| `config/llama-router.env.example` | Env router 8B |
| `scripts/start-llama-server.ps1` / `.bat` | Avvio cervello `:8080` |
| `scripts/start-llama-router.ps1` / `.bat` | Avvio router `:8070` |
| `prompts/system-voice-plancia.txt` | System prompt cervello |
| `prompts/system-router.txt` | System prompt router |
| `host/package.json` | Dipendenze Node (ajv) |
| `host/schema_validator.js` | Validazione tool JSON Schema |
| `host/router_logic.js` | Heuristica / hybrid / llm routing |
| `host/tool_schemas/plancia_tools.json` | Allowlist tool |
| `client/example_client.mjs` | Client solo cervello |
| `client/hybrid_voice_client.mjs` | Client ibrido 8B→35B |
| `models/.gitkeep` | Placeholder (GGUF non inclusi) |
