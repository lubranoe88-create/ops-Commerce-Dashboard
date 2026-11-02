"""
Inizializzazione del modello LLM come nel core ufficiale Agent Q.

Il pacchetto upstream usa OpenAI + Instructor/LiteLLM
(`agentq.core.agent.base.BaseAgent`) con MODEL_NAME tipicamente
`gpt-4o-2024-08-06` per structured output.
"""

from __future__ import annotations

from dataclasses import dataclass

from openai import OpenAI

from .config import Settings


@dataclass
class LlmBundle:
    """Client e metadati modello pronti per gli agenti."""

    client: OpenAI
    model_name: str


def init_llm(settings: Settings) -> LlmBundle:
    """
    Crea il client OpenAI con la chiave caricata da `.env`.

    Returns:
        LlmBundle con client autenticato e nome modello ufficiale.
    """
    client = OpenAI(api_key=settings.openai_api_key)
    # Smoke check leggero: elenca modelli solo se serve debug; qui evitiamo costi.
    return LlmBundle(client=client, model_name=settings.model_name)


def smoke_chat(bundle: LlmBundle, prompt: str = "Rispondi solo: ok") -> str:
    """Chiamata minima di verifica chiave/modello (opzionale in debug)."""
    resp = bundle.client.chat.completions.create(
        model=bundle.model_name,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=16,
        temperature=0,
    )
    return (resp.choices[0].message.content or "").strip()
