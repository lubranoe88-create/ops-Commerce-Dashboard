#!/usr/bin/env python3
"""
main.py — scheletro eseguibile Agent Q (sentient-engineering/agent-q)

Repo ufficiale: https://github.com/sentient-engineering/agent-q
Paper: https://arxiv.org/abs/2408.07199

Questo entrypoint:
  1. carica MODEL_NAME / OPENAI_API_KEY da `.env`
  2. inizializza il client LLM
  3. esegue ricerca multi-fonte (filesystem, SQLite, API, memoria, web-hint)
  4. pianifica con MCTS (ufficiale se disponibile, altrimenti scheletro locale)
  5. interagisce con il browser (computer use / Playwright)

Uso:
  cp .env.example .env   # poi inserisci OPENAI_API_KEY
  pip install -r requirements.txt
  playwright install chromium
  python main.py
  python main.py --mode mcts --objective "trova note su budget nel filesystem"
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Assicura import dei moduli locali `src.*`
sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.config import load_settings
from src.llm import init_llm
from src.mcts_loop import SimpleMCTS, run_official_browser_mcts
from src.orchestrator_runner import run_local_jarvis_smoke, run_official_orchestrator, run_async
from src.search import SearchSource, default_hub


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Agent Q — orchestrator / MCTS + ricerca Jarvis")
    p.add_argument(
        "--mode",
        choices=("orchestrator", "mcts", "search-only"),
        default=None,
        help="Override di AGENTQ_MODE nel .env",
    )
    p.add_argument("--objective", default=None, help="Obiettivo testuale della missione")
    p.add_argument(
        "--sources",
        default="memory,filesystem,sqlite,api,web_hint",
        help="Fonti ricerca separate da virgola",
    )
    p.add_argument(
        "--local-fallback",
        action="store_true",
        help="Forza il percorso locale (senza pacchetto agentq)",
    )
    p.add_argument("--headless", action="store_true", default=True)
    return p.parse_args()


def build_search_sources(csv: str) -> list[SearchSource]:
    mapping = {s.value: s for s in SearchSource}
    out: list[SearchSource] = []
    for part in csv.split(","):
        key = part.strip().lower()
        if not key:
            continue
        if key not in mapping:
            raise SystemExit(f"Fonte sconosciuta: {key}. Valide: {', '.join(mapping)}")
        out.append(mapping[key])
    return out


def main() -> int:
    args = parse_args()

    # 1) Config da .env — la chiave OpenAI è obbligatoria salvo search-only
    settings = load_settings(require_openai=False)
    mode = (args.mode or settings.mode or "orchestrator").lower()
    objective = (args.objective or settings.objective).strip()
    if mode != "search-only" and not settings.openai_api_key:
        raise SystemExit(
            "OPENAI_API_KEY assente. Copia .env.example in .env oppure usa --mode search-only."
        )

    # 2) Modello LLM (saltato in search-only senza chiave)
    if settings.openai_api_key:
        llm = init_llm(settings)
        print(f"[llm] modello={llm.model_name}")
    else:
        print("[llm] saltato (search-only senza OPENAI_API_KEY)")

    # 3) Hub ricerca multi-fonte (oltre il solo browser)
    hub = default_hub()
    sources = build_search_sources(args.sources)
    report = hub.search(objective, sources=sources)
    print("=== Ricerca multi-fonte ===")
    print(report.as_context())
    if report.errors:
        print("[search:warnings]", "; ".join(report.errors))

    if mode == "search-only":
        print(json.dumps({"hits": [h.to_dict() for h in report.hits]}, ensure_ascii=False, indent=2))
        return 0

    # 4) Pianificazione MCTS (percorsi d'azione)
    if mode == "mcts":
        if args.local_fallback:
            plan = SimpleMCTS(objective, hub).plan()
            print("=== Piano MCTS locale ===")
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            # Computer use: apre il miglior hint web se presente
            smoke = run_async(run_local_jarvis_smoke(objective, search_hub=hub, headless=args.headless))
            print("=== Computer use (fallback) ===")
            print(json.dumps(smoke, ensure_ascii=False, indent=2)[:2000])
            return 0
        try:
            print("[mcts] avvio browser_mcts ufficiale…")
            result = run_async(run_official_browser_mcts(objective, eval_mode=True))
            print("=== Risultato MCTS ufficiale ===")
            print(result)
            return 0
        except RuntimeError as exc:
            print(f"[mcts] fallback locale: {exc}")
            plan = SimpleMCTS(objective, hub).plan()
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            return 0

    # 5) Orchestrator ufficiale (planner/navigator/actor/critic) + search context
    if args.local_fallback:
        smoke = run_async(run_local_jarvis_smoke(objective, search_hub=hub, headless=args.headless))
        print("=== Orchestrator locale (Jarvis smoke) ===")
        print(json.dumps(smoke, ensure_ascii=False, indent=2)[:3000])
        return 0

    try:
        print("[orchestrator] avvio Agent Q ufficiale con contesto ricerca…")
        result = run_async(run_official_orchestrator(objective, search_hub=hub, use_search=True))
        print("=== Risultato orchestrator ===")
        print(json.dumps(result, ensure_ascii=False, indent=2)[:4000])
    except RuntimeError as exc:
        print(f"[orchestrator] {exc}")
        print("[orchestrator] eseguo fallback locale…")
        smoke = run_async(run_local_jarvis_smoke(objective, search_hub=hub, headless=args.headless))
        print(json.dumps(smoke, ensure_ascii=False, indent=2)[:3000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
