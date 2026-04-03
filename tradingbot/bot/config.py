"""
Configuration module — loads all settings from environment variables.
Uses python-dotenv to read .env file, with sensible defaults for paper trading.
"""

import os
from dataclasses import dataclass, field
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)


def _env(key: str, default: str = "") -> str:
    return os.getenv(key, default)


def _env_float(key: str, default: float = 0.0) -> float:
    return float(os.getenv(key, str(default)))


def _env_int(key: str, default: int = 0) -> int:
    return int(os.getenv(key, str(default)))


def _env_bool(key: str, default: bool = False) -> bool:
    return os.getenv(key, str(default)).lower() in ("true", "1", "yes")


@dataclass(frozen=True)
class TradingConfig:
    """All bot configuration in one place."""

    # --- Mode ---
    trading_mode: str = field(default_factory=lambda: _env("TRADING_MODE", "paper"))

    # --- Supabase ---
    supabase_url: str = field(default_factory=lambda: _env("SUPABASE_URL"))
    supabase_key: str = field(default_factory=lambda: _env("SUPABASE_SERVICE_ROLE_KEY"))

    # --- Claude AI ---
    anthropic_api_key: str = field(default_factory=lambda: _env("ANTHROPIC_API_KEY"))
    claude_model: str = field(
        default_factory=lambda: _env("CLAUDE_MODEL", "claude-sonnet-4-20250514")
    )

    # --- Coinbase ---
    coinbase_api_key: str = field(default_factory=lambda: _env("COINBASE_API_KEY"))
    coinbase_api_secret: str = field(
        default_factory=lambda: _env("COINBASE_API_SECRET")
    )

    # --- Polygon / Polymarket ---
    polygon_private_key: str = field(
        default_factory=lambda: _env("POLYGON_PRIVATE_KEY")
    )
    polygon_public_key: str = field(
        default_factory=lambda: _env("POLYGON_PUBLIC_KEY")
    )
    alchemy_rpc_url: str = field(default_factory=lambda: _env("ALCHEMY_RPC_URL"))

    # --- Telegram ---
    telegram_bot_token: str = field(
        default_factory=lambda: _env("TELEGRAM_BOT_TOKEN")
    )
    telegram_chat_id: str = field(default_factory=lambda: _env("TELEGRAM_CHAT_ID"))

    # --- Sentry ---
    sentry_dsn: str = field(default_factory=lambda: _env("SENTRY_DSN"))

    # --- Risk Parameters ---
    kelly_fraction: float = field(
        default_factory=lambda: _env_float("KELLY_FRACTION", 0.25)
    )
    max_position_pct: float = field(
        default_factory=lambda: _env_float("MAX_POSITION_PCT", 0.02)
    )
    max_concurrent_positions: int = field(
        default_factory=lambda: _env_int("MAX_CONCURRENT_POSITIONS", 10)
    )
    daily_loss_limit_pct: float = field(
        default_factory=lambda: _env_float("DAILY_LOSS_LIMIT_PCT", 0.05)
    )
    slippage_limit_pct: float = field(
        default_factory=lambda: _env_float("SLIPPAGE_LIMIT_PCT", 0.02)
    )
    ev_threshold: float = field(
        default_factory=lambda: _env_float("EV_THRESHOLD", 0.05)
    )

    # --- Paper Trading ---
    paper_bankroll: float = field(
        default_factory=lambda: _env_float("PAPER_BANKROLL", 1000.0)
    )

    @property
    def is_paper(self) -> bool:
        return self.trading_mode == "paper"

    @property
    def is_live(self) -> bool:
        return self.trading_mode == "live"

    def validate(self) -> list[str]:
        """Return a list of configuration errors (empty = valid)."""
        errors = []

        if not self.supabase_url:
            errors.append("SUPABASE_URL is required")
        if not self.supabase_key:
            errors.append("SUPABASE_SERVICE_ROLE_KEY is required")
        if not self.anthropic_api_key:
            errors.append("ANTHROPIC_API_KEY is required")

        if self.is_live:
            if not self.coinbase_api_key:
                errors.append("COINBASE_API_KEY required for live trading")
            if not self.coinbase_api_secret:
                errors.append("COINBASE_API_SECRET required for live trading")

        if self.kelly_fraction <= 0 or self.kelly_fraction > 1:
            errors.append(
                f"KELLY_FRACTION must be between 0 and 1, got {self.kelly_fraction}"
            )

        return errors


# Singleton
config = TradingConfig()
