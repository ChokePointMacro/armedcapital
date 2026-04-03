"""
Dual LLM provider — supports both Ollama (local/free) and Claude (API).
Toggle via LLM_PROVIDER env var: "ollama" or "claude"
"""

import logging
from typing import Optional

from studio.config import (
    LLM_PROVIDER,
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    ANTHROPIC_API_KEY,
    CLAUDE_MODEL,
)

logger = logging.getLogger(__name__)

_selected_model: Optional[str] = None


def select_model(model: str) -> None:
    """Sets the model for subsequent generate_text calls."""
    global _selected_model
    _selected_model = model


def get_active_model() -> Optional[str]:
    return _selected_model


def list_ollama_models() -> list[str]:
    """Lists models available on the local Ollama server."""
    try:
        import ollama
        client = ollama.Client(host=OLLAMA_BASE_URL)
        response = client.list()
        return sorted(m.model for m in response.models)
    except Exception as e:
        logger.error(f"Failed to list Ollama models: {e}")
        return []


def generate_text(prompt: str, model_name: Optional[str] = None, provider: Optional[str] = None) -> str:
    """
    Generate text using the configured LLM provider.

    Args:
        prompt: The user prompt
        model_name: Override model name (optional)
        provider: Override provider — "ollama" or "claude" (optional)

    Returns:
        Generated text string
    """
    active_provider = (provider or LLM_PROVIDER).lower()

    if active_provider == "claude":
        return _generate_claude(prompt, model_name)
    else:
        return _generate_ollama(prompt, model_name)


def _generate_ollama(prompt: str, model_name: Optional[str] = None) -> str:
    """Generate text via local Ollama server."""
    import ollama

    model = model_name or _selected_model or OLLAMA_MODEL
    if not model:
        raise RuntimeError(
            "No Ollama model selected. Set OLLAMA_MODEL env var, call select_model(), or pass model_name."
        )

    client = ollama.Client(host=OLLAMA_BASE_URL)
    response = client.chat(
        model=model,
        messages=[{"role": "user", "content": prompt}],
    )
    return response["message"]["content"].strip()


def _generate_claude(prompt: str, model_name: Optional[str] = None) -> str:
    """Generate text via Anthropic Claude API."""
    if not ANTHROPIC_API_KEY:
        raise RuntimeError(
            "Claude selected as LLM provider but ANTHROPIC_API_KEY is not set."
        )

    import anthropic

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    model = model_name or CLAUDE_MODEL

    message = client.messages.create(
        model=model,
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )
    # Extract text from content blocks
    return "".join(block.text for block in message.content if hasattr(block, "text")).strip()
