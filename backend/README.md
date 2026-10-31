# Holographic dashboard — backend

Small Node.js server that keeps secrets **server-side** and exposes a local endpoint for AI **decision** calls (final judge). No holographic UI and no research pipeline implementation yet.

## Architecture (research + AI)

| Layer | Role |
|---|---|
| **Mechanical pipeline** (not built yet) | Free/low-cost collection of raw data from all **17** research leads |
| **Preliminary score** | On live ingest / first load: score within a couple of minutes — no AI required |
| **Nightly cycle** | Confirmation buffer: cross-verification promotes or discards candidates |
| **AI (OpenRouter, economical model)** | **Final judge only** — top-ranking decisions or “why did this anomaly happen?” |
| **Token policy** | Pay for **decisions**, never for raw collection or noise filtering at scale |

Secrets stay server-side: `OPENROUTER_API_KEY` + single `SITE_PASSWORD` (no username, no idle session timeout).

## What this server does today

- Holds `OPENROUTER_API_KEY` in `.env` (never in the browser)
- **Single-password gate** via `SITE_PASSWORD`
- `POST /api/chat` — for judge/decision prompts only (`{ prompt, system? }`)
- Default model: `deepseek/deepseek-v4.1-flash` (override via `OPENROUTER_MODEL`)
- Helmet, localhost CORS, JSON size limit, allow-list validation, per-IP rate limiting

## Setup

```bash
cd backend
cp .env.example .env
# edit .env → OPENROUTER_API_KEY + SITE_PASSWORD
npm install
npm start
```

Dev: `npm run dev` → `http://127.0.0.1:8787`

Open URL → password-only form → cookie `dash_auth` (HttpOnly, no Max-Age / no server idle timeout).

## Auth

| Item | Behavior |
|---|---|
| Password | `SITE_PASSWORD` env only — never in code |
| Username | None |
| Prompt | Middleware serves `/login` before any other page/API |
| Session | Signed cookie, no expiry / no idle timeout |
| Logout | `POST /logout` |

```bash
curl -c /tmp/dash.jar -b /tmp/dash.jar -X POST http://127.0.0.1:8787/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'password=YOUR_SITE_PASSWORD' -o /dev/null -w '%{http_code}\n'

curl -b /tmp/dash.jar -s http://127.0.0.1:8787/health
```

## Endpoints

### `GET /health` (auth required)

```json
{ "ok": true, "model": "deepseek/deepseek-v4.1-flash", "purpose": "synthesis_ranking_only" }
```

### `POST /api/chat` (auth required) — judge calls only

```json
{
  "prompt": "Questo candidato merita il top ranking? Motiva. …",
  "system": "Sei il giudice finale. Non raccogliere dati; valuta solo il dossier fornito."
}
```

Frontend later: `fetch(..., { credentials: "include" })`. Never put OpenRouter key or site password in page code.

## Verified OSS stack (documented, not installed)

Priority plugs for the pipeline — details in [`docs/OSS_INTEGRATION.md`](docs/OSS_INTEGRATION.md):

1. **browser-use** → mechanical collection  
2. **LangGraph** (primary) / **CrewAI** (alt) → orchestration around the rule router  
3. **PyOD** → zero-token anomaly scores  
4. **FinRobot** + **FinGPT** → selected finance agents only  
5. **OpenBusiness** → second-level company understanding (**only after revenues verified**)  

Manifest + stub adapters: `src/integrations/`. No heavy Python/Node deps added yet.

## Visualization modules (design only)

1. **Module 1 — 3D globe:** [`../docs/map-module-design.md`](../docs/map-module-design.md)  
2. **Module 2 — 3D pipeline network graph** (17 leads, zoom/rotate, health, error registry): [`../docs/pipeline-graph-module-design.md`](../docs/pipeline-graph-module-design.md)  
3. **Module 3 — 5D rotatable memory graph** (concepts, neural links, anti-error rules, consistency; SQLite-only learning): [`../docs/memory-graph-module-design.md`](../docs/memory-graph-module-design.md)  
4. **Module 4 — Chat** (saved history, dark ops theme, voice in/out; economical OpenRouter as conversational face): [`../docs/chat-module-design.md`](../docs/chat-module-design.md)  

**Product corrections (design):** user Correct/Incorrect → instant mechanical rules; tiered verification thresholds; coverage transparency — [`../docs/corrections-and-coverage-design.md`](../docs/corrections-and-coverage-design.md).

UI not built.

## Out of scope (not built yet)

- Holographic UI / map rendering
- Installing the OSS sidecars above
- Mechanical collector over the 17 leads
- Nightly confirmation-buffer job
