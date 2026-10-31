#!/usr/bin/env python3
"""
Headless Chrome browser-use worker for OPS dashboard.
- Auth cookie injection
- Allow-listed origin only
- Blocks payment / external navigation
- Screenshot audit trail
- JSON in on stdin, JSON out on stdout
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import traceback
from pathlib import Path
from urllib.parse import urlparse

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None  # type: ignore


PAYMENT_RE = re.compile(
    r"(checkout|payment|pay\.|stripe\.com|paypal\.com|billing|cart/checkout)",
    re.I,
)
BLOCKED_SCHEMES = {"javascript", "data", "file"}


def die(code: str, message: str, **extra):
    print(json.dumps({"ok": False, "code": code, "error": message, **extra}))
    sys.exit(0)


def same_origin(url: str, allow_origin: str) -> bool:
    try:
        a = urlparse(allow_origin)
        b = urlparse(url)
        if b.scheme in BLOCKED_SCHEMES:
            return False
        return (a.scheme, a.hostname, a.port or default_port(a.scheme)) == (
            b.scheme,
            b.hostname,
            b.port or default_port(b.scheme),
        )
    except Exception:
        return False


def default_port(scheme: str) -> int | None:
    if scheme == "https":
        return 443
    if scheme == "http":
        return 80
    return None


def main():
    raw = sys.stdin.read()
    try:
        req = json.loads(raw or "{}")
    except json.JSONDecodeError:
        die("BAD_JSON", "stdin must be JSON")

    if sync_playwright is None:
        die(
            "PLAYWRIGHT_MISSING",
            "playwright not installed; pip install -r workers/requirements.txt",
        )

    allow_origin = (req.get("allowOrigin") or os.environ.get("BROWSER_USE_ALLOW_ORIGIN") or "http://127.0.0.1:8787").rstrip("/")
    goal = str(req.get("goal") or "").strip()[:500]
    selector = (req.get("selector") or "").strip()[:200]
    path = str(req.get("path") or "/").strip() or "/"
    cookie = str(req.get("cookie") or "")
    chrome = (
        req.get("chromePath")
        or os.environ.get("CHROME_PATH")
        or "/usr/local/bin/google-chrome"
    )
    audit_dir = Path(req.get("auditDir") or os.environ.get("BROWSER_USE_AUDIT_DIR") or "/tmp/browser-use-audit")
    audit_dir.mkdir(parents=True, exist_ok=True)

    if not goal and not selector:
        die("NO_GOAL", "goal or selector required")

    target = allow_origin + (path if path.startswith("/") else "/" + path)
    if not same_origin(target, allow_origin):
        die("ORIGIN_BLOCKED", "target outside allow-list", target=target)

    if PAYMENT_RE.search(target) or PAYMENT_RE.search(goal):
        die("PAYMENT_BLOCKED", "payment / checkout navigation blocked")

    started = time.time()
    shot_path = str(audit_dir / f"audit-{int(started * 1000)}.png")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                executable_path=chrome if os.path.exists(chrome) else None,
                args=["--no-sandbox", "--disable-gpu"],
            )
            context = browser.new_context(viewport={"width": 1280, "height": 800})
            if cookie:
                # cookie header "a=b; c=d" → playwright cookies for allow origin
                host = urlparse(allow_origin).hostname or "127.0.0.1"
                secure = urlparse(allow_origin).scheme == "https"
                for part in cookie.split(";"):
                    part = part.strip()
                    if "=" not in part:
                        continue
                    name, value = part.split("=", 1)
                    context.add_cookies(
                        [
                            {
                                "name": name.strip(),
                                "value": value.strip(),
                                "domain": host,
                                "path": "/",
                                "secure": secure,
                                "httpOnly": True,
                            }
                        ]
                    )

            page = context.new_page()

            def guard(route):
                url = route.request.url
                if PAYMENT_RE.search(url):
                    return route.abort()
                if urlparse(url).scheme in ("http", "https") and not same_origin(url, allow_origin):
                    # allow only same-origin navigations/documents; abort cross-origin docs
                    if route.request.resource_type in ("document", "xhr", "fetch"):
                        return route.abort()
                return route.continue_()

            page.route("**/*", guard)
            page.goto(target, wait_until="domcontentloaded", timeout=45000)

            clicked = False
            text = ""
            if selector:
                loc = page.locator(selector).first
                if loc.count() > 0:
                    loc.click(timeout=8000)
                    clicked = True
                    text = f"clicked {selector}"
                else:
                    text = f"selector not found: {selector}"
            else:
                # Goal heuristics: map keywords to plancia dock buttons
                mapping = [
                    (r"\bmap+a?\b|globe", '[data-holo-action="map"]'),
                    (r"pipeline", '[data-holo-action="pipeline"]'),
                    (r"memory", '[data-holo-action="memory"]'),
                    (r"\bchat\b", '[data-holo-action="chat"]'),
                    (r"orbit", '[data-holo-action="orbit"]'),
                    (r"nord|north", '[data-holo-action="nord"]'),
                    (r"zoom", '[data-holo-action="zoom-citta"]'),
                    (r"mic", '[data-holo-action="mic"]'),
                    (r"analizza", '[data-holo-action="analizza"]'),
                ]
                for pat, sel in mapping:
                    if re.search(pat, goal, re.I):
                        loc = page.locator(sel).first
                        if loc.count() > 0:
                            loc.click(timeout=8000)
                            clicked = True
                            text = f"goal matched → {sel}"
                            break
                if not clicked:
                    text = "no matching plancia control for goal; screenshot only"

            page.screenshot(path=shot_path, full_page=False)
            title = page.title()
            url_now = page.url
            browser.close()

        print(
            json.dumps(
                {
                    "ok": True,
                    "clicked": clicked,
                    "text": text,
                    "title": title,
                    "url": url_now,
                    "screenshot": shot_path,
                    "elapsedMs": int((time.time() - started) * 1000),
                    "allowOrigin": allow_origin,
                }
            )
        )
    except Exception as exc:
        die(
            "WORKER_ERROR",
            str(exc),
            trace=traceback.format_exc()[-800:],
            screenshot=shot_path if os.path.exists(shot_path) else None,
        )


if __name__ == "__main__":
    main()
