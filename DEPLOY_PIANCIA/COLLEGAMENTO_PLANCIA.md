# Collegare la plancia a llama.cpp locale

Risposta alla domanda: **basta aprire Cursor?**  
**No.** Cursor IDE e la plancia non condividono automaticamente il modello locale.

---

## Come è cablata oggi la plancia (nel codice)

Punto unico delle chat completions:

- File: `backend/src/services/openrouter.js`
- URL **hardcoded**: `https://openrouter.ai/api/v1/chat/completions`
- Chiave: env **`OPENROUTER_API_KEY`** (`backend/src/config.js`)
- Modello default: env **`OPENROUTER_MODEL`** (default tipico `deepseek/deepseek-v4.1-flash`)
- Router agent economico: **`AI_ROUTER_MODEL`**
- Escalate power: **`AI_GROK_MODEL`**

Il selettore modelli in dashboard (`ops_chat_model` in `localStorage`, catalogo `backend/src/services/chatModels.js`) sceglie solo **slug OpenRouter allow-listed**.  
**Non** c’è un campo UI “URL localhost” per puntare a llama.cpp.

Se manca la chiave OpenRouter: fallback **mechanical** (risposte fisse dai dati plancia), **non** un LLM locale.

Agent Q / voice passano da `completeChat` → stesso OpenRouter.

---

## Cosa serve per il modello locale

1. Avviare `llama-server` sul PC (`DEPLOY_PIANCIA` script → `http://127.0.0.1:8080/v1`)
2. **Modificare o estendere il backend plancia** (o mettere un proxy) perché `completeChat` chiami  
   `http://127.0.0.1:8080/v1/chat/completions`  
   invece di OpenRouter
3. Non basta: aprire Cursor, cambiare solo il modello nel pannello chat, o avviare solo il GGUF

### Opzioni di integrazione (future)

| Opzione | Cosa fare |
|---------|-----------|
| **A — Patch plancia** | Env tipo `LLM_BASE_URL=http://127.0.0.1:8080/v1` + chiave dummy; in `openrouter.js` usare quell’URL se impostato |
| **B — Proxy OpenAI-compat** | LiteLLM/gateway locale che espone un endpoint; plancia continua a parlare “come OpenRouter” verso il proxy (serve comunque cambiare host/key) |
| **C — Solo test** | Usare `DEPLOY_PIANCIA/client/*.mjs` contro llama.cpp **senza** passare dalla dashboard finché non c’è la patch |

Stack ibrido 8B→35B: oggi è nel pacchetto `host/router_logic.js` + `client/hybrid_voice_client.mjs`.  
Per usarlo in plancia va innestato **prima** di `completeChat` (o sostituito quel percorso).

---

## Variabili utili oggi (remoto)

```text
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=deepseek/deepseek-v4.1-flash
AI_ROUTER_MODEL=meta-llama/llama-3.2-3b-instruct
AI_GROK_MODEL=x-ai/grok-4.20
OPENROUTER_HTTP_REFERER=http://localhost:8787
```

Queste **non** puntano a `localhost:8080`. Servono a OpenRouter cloud.

---

## Checklist collegamento (quando si farà la patch)

- [ ] llama-server su `:8080` (e opz. router `:8070`) ok
- [ ] Backend plancia in esecuzione **sullo stesso PC** (o rete che raggiunge 127.0.0.1 del host modello)
- [ ] `LLM_BASE_URL` / equivalente implementato e letto da `completeChat`
- [ ] Model id accettato (anche stringa libera tipo `Qwen3.5-35B-A3B`)
- [ ] Tool validation host-side attiva sui turni brain
- [ ] Test voce: STT → risposta locale → TTS

Finché lo step patch non esiste, la plancia live/remota resta su **OpenRouter**.
