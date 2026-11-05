# Far parlare la plancia con LM Studio (desktop Bionic)

## Cosa serve
1. **LM Studio** avviato sul desktop **Bionic** (Ubuntu), con il modello Qwen caricato e **Server** acceso in rete locale (non solo “This PC” se la plancia gira su un’altra macchina).
2. La **plancia** in esecuzione (stesso PC o altro host sulla LAN) con `LOCAL_LLM_ENABLED=true`.
3. Risoluzione hostname: **`bionic.local`** (mDNS) oppure **`bionic`** (DNS LAN). **Non** serve l’IP se il nome risolve.

## Config plancia (`.env`)
```env
LOCAL_LLM_ENABLED=true
LOCAL_LLM_HOSTS=bionic.local,bionic
LOCAL_LLM_PORT=23000
LOCAL_LLM_BASE_URL=http://bionic.local:23000/v1
LOCAL_LLM_MODEL=local-model
LOCAL_LLM_API_KEY=lm-studio
```

Copia da `PROGETTO_LOCALE/env.plancia-locale.example` se parti da zero.  
Sul desktop Bionic il browser apre `http://localhost:23000`; dalla plancia in LAN si usa **`http://bionic.local:23000`**.

## Verifica
1. Sul PC della plancia: `curl http://bionic.local:23000/v1/models` (fallback: `http://bionic:23000/v1/models`).
2. Avvia la plancia → `GET /health` deve mostrare `localLlm.ok: true` e l’elenco modelli.
3. Messaggio «Ciao» in chat → risposta Atlas via Qwen locale.

## Se non va
1. LM Studio: server in ascolto su **0.0.0.0** / rete, firewall Ubuntu aperto su **23000**.
2. Controlla che `bionic.local` risolva sulla macchina della plancia (`ping bionic.local`).
3. Se l’API non è sotto `/v1` sulla 23000, prova senza path o la porta Developer API mostrata in LM Studio.
4. Il **server Cursor/cloud non è in LAN**: da lì `bionic` non risolve — il test vale solo dalla rete di casa.
