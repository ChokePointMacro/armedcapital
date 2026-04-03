"""
Supabase client — shared database layer between the Python bot and Next.js dashboard.
Handles all CRUD for positions, trades, commands, performance, logs, and config.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from supabase import create_client, Client

from bot.config import config


class BotDatabase:
    """Async-friendly wrapper around the Supabase client for bot operations."""

    def __init__(self):
        self._client: Optional[Client] = None

    def connect(self) -> Client:
        if self._client is None:
            self._client = create_client(config.supabase_url, config.supabase_key)
        return self._client

    @property
    def client(self) -> Client:
        return self.connect()

    # ─── Positions ───────────────────────────────────────────────

    def create_position(self, data: dict[str, Any]) -> dict:
        data.setdefault("id", str(uuid.uuid4()))
        data.setdefault("user_id", "bot")
        data.setdefault("status", "open")
        data.setdefault("opened_at", datetime.now(timezone.utc).isoformat())
        result = self.client.table("bot_positions").insert(data).execute()
        return result.data[0] if result.data else {}

    def update_position(self, position_id: str, data: dict[str, Any]) -> dict:
        result = (
            self.client.table("bot_positions")
            .update(data)
            .eq("id", position_id)
            .execute()
        )
        return result.data[0] if result.data else {}

    def close_position(
        self, position_id: str, pnl: float, pnl_percent: float, reason: str
    ) -> dict:
        return self.update_position(
            position_id,
            {
                "status": "closed",
                "pnl": pnl,
                "pnl_percent": pnl_percent,
                "close_reason": reason,
                "closed_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    def get_open_positions(self) -> list[dict]:
        result = (
            self.client.table("bot_positions")
            .select("*")
            .eq("status", "open")
            .order("opened_at", desc=True)
            .execute()
        )
        return result.data or []

    def get_position(self, position_id: str) -> Optional[dict]:
        result = (
            self.client.table("bot_positions")
            .select("*")
            .eq("id", position_id)
            .single()
            .execute()
        )
        return result.data

    def get_recent_positions(self, limit: int = 50) -> list[dict]:
        result = (
            self.client.table("bot_positions")
            .select("*")
            .order("opened_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []

    # ─── Trades ──────────────────────────────────────────────────

    def record_trade(self, data: dict[str, Any]) -> dict:
        data.setdefault("id", str(uuid.uuid4()))
        data.setdefault("user_id", "bot")
        data.setdefault("is_paper", config.is_paper)
        data.setdefault("executed_at", datetime.now(timezone.utc).isoformat())
        result = self.client.table("bot_trades").insert(data).execute()
        return result.data[0] if result.data else {}

    # ─── Commands (from dashboard) ───────────────────────────────

    def get_pending_commands(self) -> list[dict]:
        result = (
            self.client.table("bot_commands")
            .select("*")
            .eq("status", "pending")
            .order("created_at")
            .execute()
        )
        return result.data or []

    def mark_command_executed(self, command_id: str) -> dict:
        result = (
            self.client.table("bot_commands")
            .update(
                {
                    "status": "executed",
                    "executed_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            .eq("id", command_id)
            .execute()
        )
        return result.data[0] if result.data else {}

    def mark_command_failed(self, command_id: str) -> dict:
        result = (
            self.client.table("bot_commands")
            .update(
                {
                    "status": "failed",
                    "executed_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            .eq("id", command_id)
            .execute()
        )
        return result.data[0] if result.data else {}

    # ─── Performance Snapshots ───────────────────────────────────

    def record_performance(self, data: dict[str, Any]) -> dict:
        data.setdefault("id", str(uuid.uuid4()))
        data.setdefault("user_id", "bot")
        data.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
        result = self.client.table("bot_performance").insert(data).execute()
        return result.data[0] if result.data else {}

    def get_performance_history(self, limit: int = 168) -> list[dict]:
        """Get recent performance snapshots (default: 1 week at hourly)."""
        result = (
            self.client.table("bot_performance")
            .select("*")
            .order("timestamp", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []

    # ─── Config ──────────────────────────────────────────────────

    def get_bot_config(self) -> Optional[dict]:
        result = (
            self.client.table("bot_config")
            .select("*")
            .eq("user_id", "bot")
            .execute()
        )
        return result.data[0] if result.data else None

    def upsert_bot_config(self, data: dict[str, Any]) -> dict:
        data["user_id"] = "bot"
        data["updated_at"] = datetime.now(timezone.utc).isoformat()
        result = self.client.table("bot_config").upsert(data).execute()
        return result.data[0] if result.data else {}

    # ─── Heartbeat ────────────────────────────────────────────────

    def write_heartbeat(self, status: str = "running") -> None:
        """Write a heartbeat to bot_config so the dashboard knows we're alive."""
        try:
            self.client.table("bot_config").update(
                {
                    "heartbeat_at": datetime.now(timezone.utc).isoformat(),
                    "bot_status": status,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            ).eq("user_id", "bot").execute()
        except Exception:
            pass  # Never let heartbeat writes crash the bot

    # ─── Logs ────────────────────────────────────────────────────

    def write_log(
        self, level: str, category: str, message: str, data: dict | None = None
    ) -> None:
        try:
            self.client.table("bot_logs").insert(
                {
                    "id": str(uuid.uuid4()),
                    "user_id": "bot",
                    "level": level,
                    "category": category,
                    "message": message,
                    "data": data or {},
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            ).execute()
        except Exception:
            # Never let log writes crash the bot
            pass


# Singleton
db = BotDatabase()
