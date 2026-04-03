"""
Telegram bot alerts — sends real-time trade notifications and daily summaries.
Uses aiogram for async Telegram API access.
"""

from __future__ import annotations

import logging
from typing import Any

from bot.config import config

logger = logging.getLogger(__name__)

# Lazy import aiogram to allow bot to run without Telegram configured
_bot = None


async def _get_bot():
    global _bot
    if _bot is None and config.telegram_bot_token:
        try:
            from aiogram import Bot

            _bot = Bot(token=config.telegram_bot_token)
            logger.info("Telegram bot initialized")
        except Exception as e:
            logger.warning(f"Telegram not available: {e}")
    return _bot


async def send_message(text: str) -> bool:
    """Send a message to the configured Telegram chat."""
    if not config.telegram_bot_token or not config.telegram_chat_id:
        logger.debug(f"Telegram disabled, would send: {text[:80]}...")
        return False

    try:
        bot = await _get_bot()
        if bot:
            await bot.send_message(
                chat_id=config.telegram_chat_id,
                text=text,
                parse_mode="HTML",
            )
            return True
    except Exception as e:
        logger.warning(f"Telegram send failed: {e}")
    return False


# ─── Pre-built Alert Templates ───────────────────────────────────


async def alert_trade_opened(
    symbol: str,
    side: str,
    price: float,
    size_usd: float,
    ev_percent: float,
    ai_probability: float,
    is_paper: bool = True,
) -> None:
    mode = "PAPER" if is_paper else "LIVE"
    await send_message(
        f"{'📄' if is_paper else '💰'} <b>{mode} OPEN</b>\n"
        f"{'🟢' if side in ('buy', 'yes') else '🔴'} "
        f"{side.upper()} <b>{symbol}</b>\n"
        f"Price: ${price:.4f}\n"
        f"Size: ${size_usd:.2f}\n"
        f"EV: {ev_percent:+.1%}\n"
        f"AI Prob: {ai_probability:.1%}"
    )


async def alert_trade_closed(
    symbol: str,
    pnl: float,
    pnl_percent: float,
    reason: str,
    is_paper: bool = True,
) -> None:
    mode = "PAPER" if is_paper else "LIVE"
    emoji = "🟢" if pnl >= 0 else "🔴"
    await send_message(
        f"{'📄' if is_paper else '💰'} <b>{mode} CLOSE</b>\n"
        f"{emoji} <b>{symbol}</b>\n"
        f"PnL: ${pnl:+.2f} ({pnl_percent:+.1%})\n"
        f"Reason: {reason}"
    )


async def alert_daily_summary(stats: dict[str, Any]) -> None:
    await send_message(
        f"📊 <b>Daily Summary</b>\n"
        f"Trades: {stats.get('total_trades', 0)}\n"
        f"Win Rate: {stats.get('win_rate', 0):.0%}\n"
        f"PnL: ${stats.get('total_pnl', 0):+.2f}\n"
        f"Bankroll: ${stats.get('bankroll', 0):,.2f}\n"
        f"Portfolio: ${stats.get('portfolio_value', 0):,.2f}"
    )


async def alert_error(error: str, context: str = "") -> None:
    await send_message(
        f"⚠️ <b>BOT ERROR</b>\n"
        f"{error}\n"
        f"{f'Context: {context}' if context else ''}"
    )


async def alert_bot_started(mode: str) -> None:
    await send_message(
        f"🚀 <b>Bot Started</b>\n"
        f"Mode: {mode.upper()}\n"
        f"Ready to scan markets"
    )


async def alert_bot_halted(reason: str) -> None:
    await send_message(
        f"🛑 <b>BOT HALTED</b>\n"
        f"Reason: {reason}"
    )
