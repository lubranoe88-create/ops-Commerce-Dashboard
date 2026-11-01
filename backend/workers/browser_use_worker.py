#!/usr/bin/env python3
"""
Headless Chrome browser-use worker for OPS dashboard.
- Auth cookie injection for the dashboard origin
- Dashboard origin plus a single-step https://example.com probe
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
# Liveness probe only. Arbitrary URLs stay blocked (no open SSRF proxy).
PROBE_HOSTS = {"example.com", "www.example.com"}


def die(code: str, message: str, **extra):
    print(json.dumps({"ok": False, "code": code, "error": message, **extra}), flush=True)
    sys.exit(0)


def default_port(scheme: str) -> int | None:
    if scheme == "https":
        return 443
    if scheme == "http":
        return 80
    return None


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


def is_probe_url(url: str) -> bool:
    try:
        u = urlparse(url)
    except Exception:
        return False
    host = (u.hostname or "").lower()
    return u.scheme == "https" and host in PROBE_HOSTS and not u.username and not u.password


def origin_key(url: str) -> str:
    u = urlparse(url)
    if not u.scheme or not u.hostname:
        return ""
    return f"{u.scheme}://{u.hostname}"


def main():
    sys.stderr.write("browser-use worker start\n")
    sys.stderr.flush()
    raw = sys.stdin.read()
    try:
        req = json.loads(raw or "{}")
    except json.JSONDecodeError:
        die("BAD_JSON", "stdin must be JSON")

    allow_origin = (
        req.get("allowOrigin")
        or os.environ.get("BROWSER_USE_ALLOW_ORIGIN")
        or "http://127.0.0.1:8787"
    ).rstrip("/")
    goal = str(req.get("goal") or "").strip()[:500]
    selector = (req.get("selector") or "").strip()[:200]
    path = str(req.get("path") or "/").strip() or "/"
    explicit_url = str(req.get("url") or "").strip()[:500]
    try:
        max_steps = int(req.get("maxSteps") or 1)
    except (TypeError, ValueError):
        max_steps = 1
    max_steps = max(1, min(max_steps, 3))
    cookie = str(req.get("cookie") or "")
    chrome = str(req.get("chromePath") or os.environ.get("CHROME_PATH") or "")
    audit_dir = Path(
        req.get("auditDir") or os.environ.get("BROWSER_USE_AUDIT_DIR") or "/tmp/browser-use-audit"
    )
    audit_dir.mkdir(parents=True, exist_ok=True)

    if not goal and not selector and not explicit_url:
        die("NO_GOAL", "goal or selector required")

    probe = is_probe_url(explicit_url) if explicit_url else False
    if explicit_url:
        parsed = urlparse(explicit_url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            die("BAD_URL", "url must be http(s)", target=explicit_url)
        if parsed.username or parsed.password:
            die("BAD_URL", "credentials in url are not allowed", target=explicit_url)
        if not probe and not same_origin(explicit_url, allow_origin):
            die("ORIGIN_BLOCKED", "url outside allow-list", target=explicit_url)
        target = explicit_url
    else:
        target = allow_origin + (path if path.startswith("/") else "/" + path)
        if not same_origin(target, allow_origin):
            die("ORIGIN_BLOCKED", "target outside allow-list", target=target)

    if PAYMENT_RE.search(target) or PAYMENT_RE.search(goal):
        die("PAYMENT_BLOCKED", "payment / checkout navigation blocked")

    if sync_playwright is None:
        die(
            "PLAYWRIGHT_MISSING",
            "playwright not installed; pip install -r workers/requirements.txt",
        )

    started = time.time()
    shot_path = str(audit_dir / f"audit-{int(started * 1000)}.png")
    allowed_origins = {allow_origin}
    extra_origin = origin_key(target)
    if extra_origin:
        allowed_origins.add(extra_origin)

    def allowed_request(url: str) -> bool:
        return any(same_origin(url, origin) for origin in allowed_origins)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                executable_path=chrome if chrome and os.path.exists(chrome) else None,
                timeout=20000,
                args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
            )
            context = browser.new_context(viewport={"width": 1280, "height": 800})
            if cookie and not probe:
                # cookie header "a=b; c=d" → playwright cookies for the dashboard origin
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
                if urlparse(url).scheme in ("http", "https") and not allowed_request(url):
                    # allow only same-origin navigations/documents; abort cross-origin docs
                    if route.request.resource_type in ("document", "xhr", "fetch"):
                        return route.abort()
                return route.continue_()

            page.route("**/*", guard)
            page.goto(
                target,
                wait_until="domcontentloaded",
                timeout=20000 if probe else 40000,
            )

            clicked = False
            text = ""
            if probe:
                text = f"probe step 1/{max_steps}"
            elif selector:
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
                    "probe": probe,
                    "maxSteps": max_steps,
                    "steps": 1,
                }
            ),
            flush=True,
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
