"""
Runner dell'orchestratore Agent Q ufficiale + pre-ricerca multi-fonte.

Flusso ufficiale (`python -m agentq`):
  Orchestrator + mappa di stati (PLAN / BROWSE / AGENTQ_*)
  → PlaywrightManager → execute_command

Qui arricchiamo il comando con un contesto SearchHub (filesystem, sqlite,
API, memoria, web hint) prima di passare al browser.
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional

from .search import SearchHub, SearchReport, default_hub
from .web_use import close_browser, open_url, snapshot_text, start_browser


def enrich_objective(objective: str, report: SearchReport) -> str:
    """Concatena l'obiettivo utente con il contesto ricerca per il planner."""
    return (
        f"{objective.strip()}\n\n"
        f"--- Contesto ricerca multi-fonte (Jarvis) ---\n"
        f"{report.as_context()}\n"
        f"--- Fine contesto ---"
    )


async def run_official_orchestrator(
    objective: str,
    *,
    search_hub: Optional[SearchHub] = None,
    use_search: bool = True,
) -> Any:
    """
    Avvia l'Orchestrator ufficiale Agent Q con obiettivo arricchito dalla ricerca.
    """
    hub = search_hub or default_hub()
    report = hub.search(objective) if use_search else SearchReport(query=objective)
    command = enrich_objective(objective, report) if use_search else objective

    try:
        from agentq.core.agent.agentq import AgentQ
        from agentq.core.agent.agentq_actor import AgentQActor
        from agentq.core.agent.agentq_critic import AgentQCritic
        from agentq.core.agent.browser_nav_agent import BrowserNavAgent
        from agentq.core.agent.planner_agent import PlannerAgent
        from agentq.core.models.models import State
        from agentq.core.orchestrator.orchestrator import Orchestrator
    except ImportError as exc:
        raise RuntimeError(
            "Pacchetto agentq non installato. Usa la modalità locale (fallback) "
            "oppure: pip install -r requirements.txt"
        ) from exc

    state_to_agent_map = {
        State.PLAN: PlannerAgent(),
        State.BROWSE: BrowserNavAgent(),
        State.AGENTQ_BASE: AgentQ(),
        State.AGENTQ_ACTOR: AgentQActor(),
        State.AGENTQ_CRITIC: AgentQCritic(),
    }
    orchestrator = Orchestrator(state_to_agent_map=state_to_agent_map)
    await orchestrator.start()
    result = await orchestrator.execute_command(command)
    return {
        "result": result,
        "search": report.as_context(),
        "engine": "official-orchestrator",
    }


async def run_local_jarvis_smoke(
    objective: str,
    *,
    search_hub: Optional[SearchHub] = None,
    headless: bool = True,
    start_url: str = "https://example.com",
) -> dict[str, Any]:
    """
    Fallback locale senza pacchetto agentq:
    1) ricerca multi-fonte
    2) apre un URL (hint web o example.com)
    3) restituisce titolo + snapshot + report ricerca
    """
    hub = search_hub or default_hub()
    report = hub.search(objective)

    url = start_url
    for hit in report.hits:
        if hit.source.value == "web_hint" and hit.uri:
            url = hit.uri
            break
        if hit.source.value == "api" and hit.uri.startswith("http"):
            url = hit.uri
            break

    session = await start_browser(headless=headless)
    try:
        title = await open_url(session, url)
        body = await snapshot_text(session)
        return {
            "engine": "local-jarvis-smoke",
            "objective": objective,
            "opened_url": url,
            "title": title,
            "snapshot": body[:500],
            "search": report.as_context(),
            "hits": [h.to_dict() for h in report.hits[:10]],
        }
    finally:
        await close_browser(session)


def run_async(coro):
    """Esegue una coroutine da contesto sync."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)
