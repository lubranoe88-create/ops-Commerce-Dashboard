# Agent Q — ambiente di sviluppo locale

Basato sul repository ufficiale
[sentient-engineering/agent-q](https://github.com/sentient-engineering/agent-q)
(paper [Agent Q](https://arxiv.org/abs/2408.07199)).

## Struttura

```
agent-q-dev/
├── main.py                 # entrypoint (LLM + search + MCTS + browser)
├── requirements.txt        # dipendenze ufficiali + agentq da GitHub
├── .env.example            # placeholder chiavi (ufficiale + estensioni)
└── src/
    ├── config.py           # load .env
    ├── llm.py              # client OpenAI / MODEL_NAME
    ├── search.py           # ricerca multi-fonte (Jarvis)
    ├── web_use.py          # computer use Playwright
    ├── mcts_loop.py        # MCTS ufficiale o scheletro locale
    └── orchestrator_runner.py
```

## Modulo ricerca (`src/search.py`)

| Fonte | Descrizione |
|-------|-------------|
| `memory` | Indice in-process (note / preferenze caricate a runtime) |
| `filesystem` | Grep leggero su file locali (md/txt/json/csv/py/…) |
| `sqlite` | Query LIKE su DB SQLite locali (`data/*.sqlite`) |
| `api` | HTTP GET a endpoint configurabili (default: Wikipedia Opensearch) |
| `web_hint` | Suggerisce URL da aprire poi con Playwright (non naviga da solo) |

Il browser resta in `web_use.py`; la ricerca arricchisce il contesto del planner/MCTS.

## Avvio

```bash
cd agent-q-dev
cp .env.example .env   # inserisci OPENAI_API_KEY
pip install -r requirements.txt
playwright install chromium
python main.py --mode search-only --objective "capacità ricerca Jarvis"
python main.py --mode mcts --local-fallback --objective "trova note su budget"
python main.py --mode orchestrator   # richiede pacchetto agentq + chiave
```
