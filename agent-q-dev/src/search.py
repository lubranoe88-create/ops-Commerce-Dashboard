"""
Modulo ricerca multi-fonte (stile Jarvis) per Agent Q.

Oltre al computer-use via browser (Playwright), questo modulo interroga
fonti *fuori dal web* e aggrega i risultati in un unico report per il
loop di pianificazione / MCTS.

Fonti supportate:
  - filesystem  → ricerca testuale in file locali (glob + grep leggero)
  - sqlite      → query su database SQLite locali
  - api         → chiamate HTTP GET a API configurate (es. Wikipedia, custom)
  - memory      → indice in-process (dizionario/documenti caricati a runtime)
  - web_hint    → suggerimento URL da aprire poi con Playwright (non naviga da solo)

Il browser resta in `web_use.py`; qui si produce contesto strutturato
che l'orchestratore può usare prima o durante le azioni browser.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Iterable, Optional
from urllib.parse import quote_plus
from urllib.request import Request, urlopen


class SearchSource(str, Enum):
    """Identificatori delle fonti di ricerca supportate."""

    FILESYSTEM = "filesystem"
    SQLITE = "sqlite"
    API = "api"
    MEMORY = "memory"
    WEB_HINT = "web_hint"


@dataclass
class SearchHit:
    """Singolo risultato di ricerca normalizzato."""

    source: SearchSource
    title: str
    snippet: str
    uri: str = ""
    score: float = 0.0
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source.value,
            "title": self.title,
            "snippet": self.snippet,
            "uri": self.uri,
            "score": self.score,
            "meta": self.meta,
        }


@dataclass
class SearchReport:
    """Report aggregato multi-fonte per il planner / MCTS."""

    query: str
    hits: list[SearchHit] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return bool(self.hits)

    def as_context(self, limit: int = 12) -> str:
        """Testo contestuale da iniettare nel prompt dell'agente."""
        if not self.hits:
            err = "; ".join(self.errors) if self.errors else "nessun risultato"
            return f"[search] query={self.query!r} → {err}"
        lines = [f"[search] query={self.query!r} · {len(self.hits)} hit"]
        for i, h in enumerate(self.hits[:limit], 1):
            lines.append(
                f"{i}. ({h.source.value}) {h.title} — {h.snippet[:220]}"
                + (f" [{h.uri}]" if h.uri else "")
            )
        return "\n".join(lines)


class MemoryIndex:
    """Indice documentale in-process (note, preferenze, snippet caricati a runtime)."""

    def __init__(self) -> None:
        self._docs: list[dict[str, str]] = []

    def add(self, doc_id: str, text: str, title: str = "") -> None:
        self._docs.append({"id": doc_id, "title": title or doc_id, "text": text})

    def extend(self, docs: Iterable[dict[str, str]]) -> None:
        for d in docs:
            self.add(d.get("id", f"doc-{len(self._docs)}"), d.get("text", ""), d.get("title", ""))

    def search(self, query: str, limit: int = 5) -> list[SearchHit]:
        tokens = _tokens(query)
        hits: list[SearchHit] = []
        for doc in self._docs:
            text = doc["text"]
            score = _score_text(text, tokens)
            if score <= 0:
                continue
            hits.append(
                SearchHit(
                    source=SearchSource.MEMORY,
                    title=doc["title"],
                    snippet=_snippet(text, tokens),
                    uri=f"memory://{doc['id']}",
                    score=score,
                )
            )
        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:limit]


class SearchHub:
    """
    Hub di ricerca Jarvis-like.

    Esempio:
        hub = SearchHub(roots=[Path.cwd()], sqlite_paths=[Path('data/app.db')])
        hub.memory.add('pref', 'Preferisco risposte in italiano.')
        report = hub.search('preferenze lingua', sources=[SearchSource.MEMORY, SearchSource.FILESYSTEM])
    """

    def __init__(
        self,
        *,
        roots: Optional[list[Path]] = None,
        sqlite_paths: Optional[list[Path]] = None,
        api_endpoints: Optional[dict[str, str]] = None,
        memory: Optional[MemoryIndex] = None,
        max_file_bytes: int = 512_000,
    ) -> None:
        self.roots = roots or [Path.cwd()]
        self.sqlite_paths = sqlite_paths or []
        self.api_endpoints = api_endpoints or {
            # Endpoint pubblico di esempio (Wikipedia Opensearch)
            "wikipedia": "https://en.wikipedia.org/w/api.php?action=opensearch&limit=5&format=json&search={query}",
        }
        self.memory = memory or MemoryIndex()
        self.max_file_bytes = max_file_bytes

    def search(
        self,
        query: str,
        *,
        sources: Optional[list[SearchSource]] = None,
        limit_per_source: int = 5,
    ) -> SearchReport:
        """Esegue la ricerca sulle fonti richieste e aggrega i hit."""
        q = (query or "").strip()
        report = SearchReport(query=q)
        if not q:
            report.errors.append("query vuota")
            return report

        selected = sources or [
            SearchSource.MEMORY,
            SearchSource.FILESYSTEM,
            SearchSource.SQLITE,
            SearchSource.API,
            SearchSource.WEB_HINT,
        ]

        dispatch = {
            SearchSource.MEMORY: lambda: self.memory.search(q, limit=limit_per_source),
            SearchSource.FILESYSTEM: lambda: self._search_filesystem(q, limit_per_source),
            SearchSource.SQLITE: lambda: self._search_sqlite(q, limit_per_source),
            SearchSource.API: lambda: self._search_api(q, limit_per_source),
            SearchSource.WEB_HINT: lambda: self._web_hints(q),
        }

        for src in selected:
            try:
                report.hits.extend(dispatch[src]())
            except Exception as exc:  # noqa: BLE001 — aggreghiamo errori per fonte
                report.errors.append(f"{src.value}: {exc}")

        report.hits.sort(key=lambda h: h.score, reverse=True)
        return report

    # —— implementazioni per fonte ————————————————————————————————

    def _search_filesystem(self, query: str, limit: int) -> list[SearchHit]:
        tokens = _tokens(query)
        patterns = ("*.txt", "*.md", "*.json", "*.csv", "*.py", "*.log", "*.env.example")
        hits: list[SearchHit] = []
        for root in self.roots:
            if not root.exists():
                continue
            for pattern in patterns:
                for path in root.rglob(pattern):
                    if not path.is_file():
                        continue
                    if any(part.startswith(".") and part not in {".env.example"} for part in path.parts):
                        # salta directory nascoste tipo .git / .venv
                        if ".git" in path.parts or ".venv" in path.parts or "node_modules" in path.parts:
                            continue
                    try:
                        if path.stat().st_size > self.max_file_bytes:
                            continue
                        text = path.read_text(encoding="utf-8", errors="ignore")
                    except OSError:
                        continue
                    score = _score_text(text, tokens) + (_score_text(path.name, tokens) * 2)
                    if score <= 0:
                        continue
                    hits.append(
                        SearchHit(
                            source=SearchSource.FILESYSTEM,
                            title=path.name,
                            snippet=_snippet(text, tokens),
                            uri=str(path.resolve()),
                            score=score,
                            meta={"path": str(path)},
                        )
                    )
        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:limit]

    def _search_sqlite(self, query: str, limit: int) -> list[SearchHit]:
        tokens = _tokens(query)
        hits: list[SearchHit] = []
        for db_path in self.sqlite_paths:
            if not db_path.exists():
                continue
            try:
                conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            except sqlite3.Error as exc:
                raise RuntimeError(f"apertura {db_path}: {exc}") from exc
            try:
                tables = [
                    r[0]
                    for r in conn.execute(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                    )
                ]
                for table in tables:
                    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]
                    text_cols = cols[:6] or cols
                    if not text_cols:
                        continue
                    # LIKE su prime colonne testuali (safe-ish: nomi da PRAGMA)
                    where = " OR ".join([f"CAST({c} AS TEXT) LIKE ?" for c in text_cols])
                    params = [f"%{query}%"] * len(text_cols)
                    sql = f"SELECT * FROM {table} WHERE {where} LIMIT ?"
                    try:
                        rows = conn.execute(sql, [*params, limit]).fetchall()
                    except sqlite3.Error:
                        continue
                    for row in rows:
                        blob = " | ".join("" if v is None else str(v) for v in row)
                        hits.append(
                            SearchHit(
                                source=SearchSource.SQLITE,
                                title=f"{db_path.name}:{table}",
                                snippet=blob[:240],
                                uri=f"sqlite://{db_path}#{table}",
                                score=_score_text(blob, tokens) + 1.0,
                                meta={"db": str(db_path), "table": table},
                            )
                        )
            finally:
                conn.close()
        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:limit]

    def _search_api(self, query: str, limit: int) -> list[SearchHit]:
        hits: list[SearchHit] = []
        for name, template in self.api_endpoints.items():
            url = template.format(query=quote_plus(query))
            req = Request(url, headers={"User-Agent": "AgentQ-SearchHub/1.0"})
            with urlopen(req, timeout=12) as resp:  # noqa: S310 — URL da config fidata
                raw = resp.read().decode("utf-8", errors="ignore")
            hits.extend(_parse_api_payload(name, raw, query)[:limit])
        return hits[:limit]

    def _web_hints(self, query: str) -> list[SearchHit]:
        """Suggerisce URL da far aprire al modulo browser (non naviga)."""
        q = quote_plus(query)
        hints = [
            ("DuckDuckGo", f"https://duckduckgo.com/?q={q}"),
            ("Wikipedia", f"https://en.wikipedia.org/wiki/Special:Search?search={q}"),
            ("GitHub", f"https://github.com/search?q={q}"),
        ]
        return [
            SearchHit(
                source=SearchSource.WEB_HINT,
                title=title,
                snippet=f"Apri nel browser Agent Q: {url}",
                uri=url,
                score=0.5,
                meta={"action": "open_url"},
            )
            for title, url in hints
        ]


# —— utilità testo ————————————————————————————————————————————————


def _tokens(query: str) -> list[str]:
    return [t for t in re.split(r"\W+", query.lower()) if len(t) > 1]


def _score_text(text: str, tokens: list[str]) -> float:
    if not text or not tokens:
        return 0.0
    low = text.lower()
    return float(sum(low.count(tok) for tok in tokens))


def _snippet(text: str, tokens: list[str], radius: int = 90) -> str:
    low = text.lower()
    for tok in tokens:
        i = low.find(tok)
        if i >= 0:
            start = max(0, i - radius)
            end = min(len(text), i + len(tok) + radius)
            return text[start:end].replace("\n", " ").strip()
    return text[:180].replace("\n", " ").strip()


def _parse_api_payload(name: str, raw: str, query: str) -> list[SearchHit]:
    """Parser generico: Wikipedia opensearch oppure JSON lista/dict."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return [
            SearchHit(
                source=SearchSource.API,
                title=name,
                snippet=raw[:240],
                uri="",
                score=0.2,
            )
        ]

    # Formato Opensearch Wikipedia: [query, titles[], descs[], urls[]]
    if (
        isinstance(data, list)
        and len(data) >= 4
        and isinstance(data[1], list)
        and isinstance(data[3], list)
    ):
        titles, urls = data[1], data[3]
        descs = data[2] if isinstance(data[2], list) else [""] * len(titles)
        out: list[SearchHit] = []
        for title, desc, url in zip(titles, descs, urls):
            out.append(
                SearchHit(
                    source=SearchSource.API,
                    title=str(title),
                    snippet=str(desc or title),
                    uri=str(url),
                    score=_score_text(f"{title} {desc}", _tokens(query)) + 1.0,
                    meta={"provider": name},
                )
            )
        return out

    return [
        SearchHit(
            source=SearchSource.API,
            title=name,
            snippet=json.dumps(data, ensure_ascii=False)[:240],
            uri="",
            score=0.3,
            meta={"provider": name},
        )
    ]


def default_hub(project_root: Optional[Path] = None) -> SearchHub:
    """Factory con radici sensate per il progetto agent-q-dev."""
    root = project_root or Path(__file__).resolve().parent.parent
    sqlite_paths = []
    for candidate in (
        root / "data" / "agentq.sqlite",
        root / "data" / "memory.sqlite",
        Path(os.getenv("AGENTQ_SQLITE", "")),
    ):
        if candidate and str(candidate) not in ("", ".") and candidate.exists():
            sqlite_paths.append(candidate)
    hub = SearchHub(roots=[root, root / "data"], sqlite_paths=sqlite_paths)
    hub.memory.add(
        "jarvis-intro",
        "Agent Q con ricerca multi-fonte: filesystem, sqlite, API, memoria e hint web per il browser.",
        title="Capacità ricerca Jarvis",
    )
    return hub
