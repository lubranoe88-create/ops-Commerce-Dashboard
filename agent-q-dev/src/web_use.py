"""
Modulo Web / Computer Use via Playwright.

Nell'upstream ufficiale il browser è gestito da
`agentq.core.web_driver.playwright.PlaywrightManager` e dalle skill in
`agentq.core.skills.*` (open_url, click, enter_text, screenshot, DOM, …).

Questo wrapper:
1. preferisce il PlaywrightManager ufficiale se `agentq` è installato;
2. altrimenti espone un mini-driver Playwright async per smoke-test locali.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from playwright.async_api import Browser, Page, async_playwright


@dataclass
class BrowserSession:
    """Sessione browser minimale per computer-use."""

    page: Page
    browser: Browser
    _playwright: Any


async def start_browser(
    *,
    headless: bool = False,
    cdp_endpoint: Optional[str] = None,
    user_agent: str = "AgentQ-Bot",
) -> BrowserSession:
    """
    Avvia Chromium (o si collega a Chrome in remote-debugging, come da README).

    README ufficiale:
      google-chrome --remote-debugging-port=9222
    """
    pw = await async_playwright().start()
    if cdp_endpoint:
        browser = await pw.chromium.connect_over_cdp(cdp_endpoint)
        context = browser.contexts[0] if browser.contexts else await browser.new_context()
        page = context.pages[0] if context.pages else await context.new_page()
    else:
        browser = await pw.chromium.launch(headless=headless)
        context = await browser.new_context(user_agent=user_agent)
        page = await context.new_page()
    await page.set_extra_http_headers({"User-Agent": user_agent})
    return BrowserSession(page=page, browser=browser, _playwright=pw)


async def open_url(session: BrowserSession, url: str, timeout_ms: int = 30000) -> str:
    """Naviga a un URL e restituisce il titolo pagina."""
    await session.page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
    return await session.page.title()


async def snapshot_text(session: BrowserSession, limit: int = 2000) -> str:
    """Estrae testo visibile (approssimazione del DOM content usato dall'agente)."""
    text = await session.page.inner_text("body")
    return (text or "").strip()[:limit]


async def close_browser(session: BrowserSession) -> None:
    """Chiude browser e Playwright."""
    try:
        await session.browser.close()
    finally:
        await session._playwright.stop()


async def try_official_playwright_manager():
    """
    Tenta di usare il manager ufficiale Agent Q.

    Returns:
        Istanza PlaywrightManager già avviata, oppure None se il pacchetto manca.
    """
    try:
        from agentq.core.web_driver.playwright import PlaywrightManager
    except ImportError:
        return None
    manager = PlaywrightManager()
    await manager.async_initialize()
    return manager
