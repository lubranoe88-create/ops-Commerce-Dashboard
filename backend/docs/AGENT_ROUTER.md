# Agent router — design

## Goal

Given a conversation context, **select only the relevant agents** from a pool (eventually 200+ from a GitHub collection), run those few locally/mechanically, then hand their dossiers to the **economical OpenRouter model as final judge**. Never call every agent. Never spend judge tokens on raw collection.

## Flow

1. **Context in** — user message, optional research-source keys, tags.
2. **Rule-based router** (`keyword_context_v1`) — score enabled agents by keyword/domain hits; keep top N (default 4).
3. **Fallback** — if nothing matches, use a tiny commerce default pair: financial analysis + failure detection.
4. **Stub runners** — each selected agent returns a structured local dossier (no LLM).
5. **Judge payload** — assemble system + prompt + dossier for OpenRouter **later**. This scaffold stops here (key not connected).

## Starter pool (curated)

| Agent | Focus |
|---|---|
| Financial analysis | Filings / revenue |
| Market research | Demand, reviews, traffic, marketplaces |
| Supply chain | Customs, freight, bottlenecks |
| Business model analysis | Patents, holdings, licenses, indie rails |
| Failure detection | Insolvency / distress |
| Hiring signals | Job-post leading indicators |

Add/remove later via `addAgent` / `removeAgent` / `setAgentEnabled` on the local catalog — path toward importing a larger GitHub agent set without changing the router contract.

## Verified OSS plugs (see `docs/OSS_INTEGRATION.md`)

| Stage | Tool | Role |
|---|---|---|
| Collection | **browser-use** | Mechanical public-web capture |
| Preliminary score | **PyOD** | Zero-token anomaly scores |
| Orchestration | **LangGraph** (primary) / **CrewAI** (alt) | Graph/crew around this router |
| Selected agents | **FinRobot**, **FinGPT** | Finance dossiers only when selected |
| Final judge | Economical OpenRouter via Node backend | Decisions only |
| Memory | Local SQLite module | Conversations, tops, neural links, consistency |
| Post-verification deepen | **OpenBusiness** | Business model / sector / ops — **only after revenues verified** |

Heavy deps are **not** installed yet — adapters in `src/integrations/` return `not_installed` stubs.

## What is explicitly out of scope here

- Holographic UI
- Live OpenRouter calls / API key usage from the integrations stubs
- Full 200+ agent import
- Installing browser-use / LangGraph / CrewAI / PyOD / FinRobot / FinGPT in this pass
- Mechanical research pipeline execution inside runners (stubs only)
