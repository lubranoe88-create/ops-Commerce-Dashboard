"""
Loop di pianificazione / ragionamento basato su MCTS (Monte Carlo Tree Search).

Nell'upstream ufficiale la logica completa è in:
  - agentq.core.mcts.browser_mcts (BrowserWorldModel + Actor/Critic + Vision)
  - agentq.core.mcts.core.mcts (implementazione MCTS)

Qui forniamo:
  1. un runner che delega al pacchetto ufficiale se installato;
  2. uno scheletro MCTS locale che integra il SearchHub come prior di espansione.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Any, Optional

from .search import SearchHub, SearchReport


@dataclass
class MCTSNode:
    """Nodo dell'albero di ricerca azioni."""

    state: str
    action: str = ""
    prior: float = 1.0
    visits: int = 0
    value: float = 0.0
    children: list["MCTSNode"] = field(default_factory=list)
    parent: Optional["MCTSNode"] = None

    @property
    def q(self) -> float:
        return self.value / self.visits if self.visits else 0.0


def ucb1(node: MCTSNode, parent_visits: int, c: float = 1.4) -> float:
    """Punteggio UCB1 classico per bilanciare exploitation / exploration."""
    if node.visits == 0:
        return float("inf")
    return node.q + c * math.sqrt(math.log(parent_visits + 1) / node.visits)


class SimpleMCTS:
    """
    Scheletro MCTS didattico: espande azioni candidate (da search + azioni browser)
    e stima il percorso migliore rispetto a un obiettivo testuale.
    """

    def __init__(
        self,
        objective: str,
        search_hub: SearchHub,
        *,
        n_iterations: int = 32,
        exploration: float = 1.4,
    ) -> None:
        self.objective = objective
        self.search_hub = search_hub
        self.n_iterations = n_iterations
        self.exploration = exploration

    def plan(self) -> dict[str, Any]:
        """Esegue MCTS e restituisce il miglior percorso di azioni."""
        report: SearchReport = self.search_hub.search(self.objective)
        candidates = self._actions_from_search(report)
        root = MCTSNode(state="root")
        for action, prior in candidates:
            child = MCTSNode(state=action, action=action, prior=prior, parent=root)
            root.children.append(child)

        if not root.children:
            root.children.append(
                MCTSNode(state="noop", action="noop: nessuna azione", prior=0.1, parent=root)
            )

        for _ in range(self.n_iterations):
            node = self._select(root)
            reward = self._simulate(node.action, report)
            self._backprop(node, reward)

        best = max(root.children, key=lambda n: (n.visits, n.q))
        ranked = sorted(root.children, key=lambda n: (n.visits, n.q), reverse=True)
        return {
            "objective": self.objective,
            "best_action": best.action,
            "best_q": best.q,
            "best_visits": best.visits,
            "ranking": [
                {"action": n.action, "q": round(n.q, 4), "visits": n.visits} for n in ranked[:8]
            ],
            "search_context": report.as_context(),
            "engine": "local-simple-mcts",
        }

    def _actions_from_search(self, report: SearchReport) -> list[tuple[str, float]]:
        actions: list[tuple[str, float]] = [
            ("search:refresh_context", 1.2),
            ("browser:open_homepage", 0.8),
        ]
        for hit in report.hits[:8]:
            if hit.source.value == "web_hint" and hit.uri:
                actions.append((f"browser:open_url:{hit.uri}", 1.0 + hit.score * 0.1))
            elif hit.source.value == "filesystem":
                actions.append((f"fs:read:{hit.uri}", 0.9 + hit.score * 0.05))
            elif hit.source.value == "sqlite":
                actions.append((f"db:inspect:{hit.uri}", 0.9 + hit.score * 0.05))
            elif hit.source.value == "api":
                actions.append((f"api:follow:{hit.uri or hit.title}", 0.85 + hit.score * 0.05))
            elif hit.source.value == "memory":
                actions.append((f"memory:use:{hit.title}", 1.0 + hit.score * 0.1))
        return actions

    def _select(self, root: MCTSNode) -> MCTSNode:
        return max(root.children, key=lambda n: ucb1(n, root.visits or 1, self.exploration))

    def _simulate(self, action: str, report: SearchReport) -> float:
        # Reward euristica: allinea azione a hit di search + rumore leggero
        base = 0.1
        for hit in report.hits:
            if hit.uri and hit.uri in action:
                base = max(base, 0.6 + min(hit.score, 5) * 0.05)
            if hit.title.lower() in action.lower():
                base = max(base, 0.5)
        if action.startswith("memory:"):
            base = max(base, 0.55)
        if action.startswith("browser:open_url"):
            base = max(base, 0.45)
        return max(0.0, min(1.0, base + random.uniform(-0.05, 0.05)))

    def _backprop(self, node: MCTSNode, reward: float) -> None:
        cur: Optional[MCTSNode] = node
        while cur is not None:
            cur.visits += 1
            cur.value += reward
            cur = cur.parent


async def run_official_browser_mcts(objective: str, *, eval_mode: bool = True) -> Any:
    """
    Delega al MCTS browser ufficiale se `agentq` è installato.
    """
    try:
        from agentq.core.mcts.browser_mcts import main as browser_mcts_main
    except ImportError as exc:
        raise RuntimeError(
            "Pacchetto agentq non installato. Esegui: pip install -r requirements.txt"
        ) from exc
    return await browser_mcts_main(objective=objective, eval_mode=eval_mode)
