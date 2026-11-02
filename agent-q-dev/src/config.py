"""
Caricamento configurazione da `.env`, allineato a agent-q ufficiale.

Riferimento: https://github.com/sentient-engineering/agent-q
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Directory progetto (agent-q-dev/)
PROJECT_ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    """Impostazioni runtime lette dall'ambiente."""

    model_name: str
    openai_api_key: str
    litellm_log: str
    langfuse_secret_key: str
    langfuse_public_key: str
    langfuse_host: str
    objective: str
    mode: str  # orchestrator | mcts
    cdp_endpoint: str | None


def load_settings(
    env_file: str | Path | None = None,
    *,
    require_openai: bool = True,
) -> Settings:
    """
    Carica le variabili da `.env` (o dal path indicato) e valida i minimi necessari.

    Args:
        require_openai: se False (es. mode search-only) la chiave può mancare.

    Raises:
        RuntimeError: se manca OPENAI_API_KEY (quando richiesta) o MODEL_NAME.
    """
    path = Path(env_file) if env_file else PROJECT_ROOT / ".env"
    # Carica anche .env.example come fallback solo per chiavi non sensibili (non sovrascrive)
    example = PROJECT_ROOT / ".env.example"
    if example.exists():
        load_dotenv(example, override=False)
    if path.exists():
        load_dotenv(path, override=True)
    else:
        load_dotenv(override=False)

    model_name = os.getenv("MODEL_NAME", "gpt-4o-2024-08-06").strip()
    openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if require_openai and not openai_api_key:
        raise RuntimeError(
            "OPENAI_API_KEY assente. Copia .env.example in .env e inserisci la chiave OpenAI."
        )
    if not model_name:
        raise RuntimeError("MODEL_NAME assente nel file .env.")

    # Espone la chiave al client OpenAI / LiteLLM usati dal pacchetto ufficiale
    if openai_api_key:
        os.environ["OPENAI_API_KEY"] = openai_api_key
    os.environ["MODEL_NAME"] = model_name
    os.environ.setdefault("LITELLM_LOG", os.getenv("LITELLM_LOG", "ERROR"))

    return Settings(
        model_name=model_name,
        openai_api_key=openai_api_key,
        litellm_log=os.getenv("LITELLM_LOG", "ERROR"),
        langfuse_secret_key=os.getenv("LANGFUSE_SECRET_KEY", ""),
        langfuse_public_key=os.getenv("LANGFUSE_PUBLIC_KEY", ""),
        langfuse_host=os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com"),
        objective=os.getenv(
            "AGENTQ_OBJECTIVE",
            "Apri https://example.com e leggi il titolo della pagina",
        ),
        mode=os.getenv("AGENTQ_MODE", "orchestrator").strip().lower(),
        cdp_endpoint=os.getenv("CDP_ENDPOINT") or None,
    )
