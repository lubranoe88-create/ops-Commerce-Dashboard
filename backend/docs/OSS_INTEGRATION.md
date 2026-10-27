# Open-source integrations — verified for dashboard purpose

Verified against: **daily top-revenue (all sectors, incl. low-capital)**, **invisible failure detection**, **supply-chain bottleneck discovery**.

Pipeline target:

```
mechanical collection → preliminary score → agent router → selected agents
  → economical OpenRouter judge → memory
  → [post-verification only] OpenBusiness company understanding
```

**Policy:** no heavy dependency install in this pass. Adapters are stubs + contracts only. Python tools run later as optional sidecars; the Node backend remains the password gate + judge proxy + memory host.

---

## Priority stack (accepted)

### 1. browser-use — collection

| | |
|---|---|
| **Repo** | [browser-use/browser-use](https://github.com/browser-use/browser-use) (~119k★, MIT, Python) |
| **Fit** | **Verified — collection.** Automates public web pages (marketplaces, reviews, forums, registries UI) to feed the 17 research leads. |
| **Not for** | Final judge; bulk LLM summarization of every page. |
| **Constraints** | Python + browser runtime; fragile sites/ToS; rate limits; must write raw artifacts to disk/DB, not call OpenRouter per page. |
| **Plug point** | `mechanical collection` → emits structured snapshots consumed by preliminary scoring and nightly confirmation buffer. |

### 2. LangGraph *(primary)* / CrewAI *(alternative)* — orchestration

| | LangGraph | CrewAI |
|---|---|---|
| **Repo** | [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) (~44k★, MIT) | [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI) (~60k★, MIT) |
| **Fit** | **Verified — orchestration.** Maps cleanly to router → selected agents → judge → memory write. | **Verified — orchestration (alt).** Strong for role crews matching our curated agent ids. |
| **Choice** | **Prefer LangGraph** for explicit stateful graph + checkpoints aligned with nightly confirmation buffer. | Keep as optional crew runner if we want role-play style specialists. |
| **Constraints** | Python ecosystem; do **not** put OpenRouter key in every node — only the final judge node may call the economical model (or call back into our Node `/api/chat`). | Same: crews must not fan out LLM calls for collection/noise filtering. |
| **Plug point** | Wraps existing `selectAgents` + stub/real runners; judge node builds payload then (later) hits OpenRouter via backend. |

### 3. PyOD — mechanical anomaly detection (zero-token)

| | |
|---|---|
| **Repo** | [yzhao062/pyod](https://github.com/yzhao062/pyod) (~10k★, BSD-2-Clause, Python) |
| **Fit** | **Verified — pre-judge scoring.** Detects outliers on tabular/time features (revenue proxies, hiring deltas, freight indices, review velocity). |
| **Not for** | Semantic “why” explanations (that is the OpenRouter judge). |
| **Constraints** | Needs feature matrices from collection; offline/batch friendly; no LLM dependency. |
| **Plug point** | After collection / before router: attach `anomaly_score` to candidates → preliminary score (minutes) and nightly promote/discard. |

### 4. FinRobot — finance open agent platform

| | |
|---|---|
| **Repo** | [AI4Finance-Foundation/FinRobot](https://github.com/AI4Finance-Foundation/FinRobot) (~8.3k★, Apache-2.0, Python) |
| **Fit** | **Verified — selected agent only.** Equity/filing/risk workflows enrich **formal** revenue and distress signals. |
| **Gap** | Weak alone on **low-capital / invisible** commerce; must stay behind the router, never run on every datapoint. |
| **Constraints** | Heavy Python stack; data/API keys of its own; outputs must be normalized into our dossier schema. |
| **Plug point** | Runner behind catalog agent `financial-analysis` (and optionally `failure-detection`) when keywords match. |

### 5. FinGPT — finance NLP open models/tools

| | |
|---|---|
| **Repo** | [AI4Finance-Foundation/FinGPT](https://github.com/AI4Finance-Foundation/FinGPT) (~21k★, MIT, Python) |
| **Fit** | **Verified — selected agent assist.** Sentiment/news/filing NLP for market and failure early warnings. |
| **Gap** | Not a global low-cap revenue ranker; local/model weights may be large. |
| **Constraints** | Optional local inference cost (GPU/CPU) — still **not** OpenRouter judge tokens if run locally; if routed through OpenRouter, violates “judge-only” policy — prefer local or non-judge path. |
| **Plug point** | Assist `market-research` / `failure-detection` runners; features also feed PyOD. |

### 6. OpenBusiness — post-verification company understanding *(second-level)*

| | |
|---|---|
| **Repo** | [wanikua/OpenBusiness](https://github.com/wanikua/OpenBusiness) (~12★, MIT, Python, LangGraph CLI on PyPI) |
| **Fit** | **Verified — second-level only.** Business-model canvas, activity/sector narrative, competitive position from public evidence (web + EDGAR), with claims labeled verified / inferred / missing. |
| **Trigger** | **ONLY after revenues are already verified** and the business is in (or promoted toward) the daily top. Never on the full raw stream. |
| **Constraints** | Low star count / early project; needs external search/scrape keys for evidence collection; uses LLMs for analysts — gate tightly so it does not become mass token spend; deepen confirmed names only. |
| **Plug point** | After judge/memory promote → `business-model` deepen job → store canvas + sector labels into memory concepts/links. |

**Search shortlist (company-understanding):** 1) **OpenBusiness** (best purpose fit) · 2) **gpt-researcher** (~30k★, Apache-2.0) — generic deep research, usable as fallback deepen · 3) **BEACON** (Census NAICS) — strong sector codes but license `NOASSERTION` on GitHub → not adopted as core.

---

## Explicitly not promoted as core (from shortlist)

| Item | Why |
|---|---|
| TradingAgents / daily_stock_analysis / ai-hedge-fund / qlib | Trading/quant-first; poor match for all-sector low-cap commerce tops |
| serenity-skill / InvAgent | Supply-chain flavored but niche or equity-tilted; revisit later as optional skills |

---

## End-to-end plug map

| Stage | OSS piece | Token policy |
|---|---|---|
| Mechanical collection | **browser-use** (+ existing free APIs/leads) | No OpenRouter |
| Preliminary score | **PyOD** (+ rules) | No OpenRouter |
| Agent selection | Existing Node `selectAgents` *(later optionally mirrored in LangGraph)* | No OpenRouter |
| Selected agents | FinRobot / FinGPT / stubs | Prefer local/mechanical; no judge model |
| Final judge | Economical OpenRouter via Node backend | **Only here** |
| Memory | Existing SQLite memory (conversations, daily tops, neural links, consistency) | No OpenRouter |
| **Post-verification deepen** | **OpenBusiness** (optional gpt-researcher fallback) | LLM allowed only on confirmed top set |

---

## Sidecar plan (when installing later)

1. Add `workers/` Python env (separate from Node) — **not done now**.
2. Expose local HTTP or CLI: `collect`, `score_anomalies`, `run_finrobot`, `run_fingpt`, `run_openbusiness` (post-verify only).
3. Node `integrations` adapters call those endpoints.
4. LangGraph graph definition lives in `workers/orchestrator` and/or Node keeps rule router as source of truth for selection.
5. OpenBusiness runs on a queue of verified `business_key`s from daily tops / consistency winners — never on unverified candidates.

Manifest of contracts: `src/integrations/manifest.json`.
