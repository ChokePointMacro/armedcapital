"""
Pre-trade safety checks — every trade must pass all guards before execution.
These protect against catastrophic losses and correlated risk.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta

from bot.config import config
from bot.db.supabase import db

logger = logging.getLogger(__name__)


@dataclass
class GuardResult:
    """Result of running all pre-trade checks."""

    passed: bool
    failures: list[str]
    warnings: list[str]

    @property
    def summary(self) -> str:
        status = "PASS" if self.passed else "BLOCKED"
        parts = [f"[{status}]"]
        if self.failures:
            parts.append(f"Failures: {', '.join(self.failures)}")
        if self.warnings:
            parts.append(f"Warnings: {', '.join(self.warnings)}")
        return " | ".join(parts)


async def check_balance(
    required_usd: float, available_usd: float
) -> tuple[bool, str]:
    """Verify sufficient balance for the trade."""
    if available_usd < required_usd:
        return False, (
            f"Insufficient balance: need ${required_usd:.2f}, "
            f"have ${available_usd:.2f}"
        )
    return True, ""


def check_position_limit() -> tuple[bool, str]:
    """Check we haven't exceeded max concurrent positions."""
    open_positions = db.get_open_positions()
    count = len(open_positions)
    limit = config.max_concurrent_positions

    if count >= limit:
        return False, (
            f"Position limit reached: {count}/{limit} open positions"
        )
    return True, ""


def check_slippage(estimated_slippage: float) -> tuple[bool, str]:
    """Check slippage is within acceptable range."""
    if estimated_slippage > config.slippage_limit_pct:
        return False, (
            f"Slippage too high: {estimated_slippage:.1%} "
            f"(limit: {config.slippage_limit_pct:.1%})"
        )
    return True, ""


def check_correlation(
    asset_class: str, side: str, symbol: str
) -> tuple[bool, str]:
    """
    Check for excessive correlation in open positions.
    Reject if >3 positions in the same direction for the same asset class.
    """
    open_positions = db.get_open_positions()
    same_direction = [
        p
        for p in open_positions
        if p.get("asset_class") == asset_class and p.get("side") == side
    ]

    if len(same_direction) >= 3:
        return False, (
            f"Correlation limit: already {len(same_direction)} "
            f"{side} positions in {asset_class}"
        )

    # Also check for duplicate symbol
    same_symbol = [p for p in open_positions if p.get("symbol") == symbol]
    if same_symbol:
        return False, f"Already have an open position on {symbol}"

    return True, ""


def check_daily_loss_limit() -> tuple[bool, str]:
    """
    Check if daily losses exceed the limit.
    If daily drawdown > configured %, halt all trading.
    """
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    # Get today's closed positions
    recent = db.get_recent_positions(limit=200)
    today_closed = [
        p
        for p in recent
        if p.get("status") == "closed"
        and p.get("closed_at")
        and p["closed_at"] >= today_start.isoformat()
    ]

    daily_pnl = sum(float(p.get("pnl", 0)) for p in today_closed)

    # Get current bankroll from performance or config
    perf = db.get_performance_history(limit=1)
    bankroll = (
        float(perf[0]["total_equity"])
        if perf
        else config.paper_bankroll
    )

    if bankroll <= 0:
        return False, "Bankroll is zero or negative"

    daily_loss_pct = abs(min(0, daily_pnl)) / bankroll

    if daily_loss_pct >= config.daily_loss_limit_pct:
        return False, (
            f"Daily loss limit hit: -{daily_loss_pct:.1%} "
            f"(limit: {config.daily_loss_limit_pct:.1%}, "
            f"PnL: ${daily_pnl:,.2f})"
        )

    return True, ""


def check_ev_threshold(ev_percent: float) -> tuple[bool, str]:
    """Check that expected value meets minimum threshold."""
    if ev_percent < config.ev_threshold:
        return False, (
            f"EV too low: {ev_percent:.1%} "
            f"(threshold: {config.ev_threshold:.1%})"
        )
    return True, ""


async def run_all_guards(
    required_usd: float,
    available_usd: float,
    estimated_slippage: float,
    asset_class: str,
    side: str,
    symbol: str,
    ev_percent: float,
) -> GuardResult:
    """
    Run ALL pre-trade checks and return a combined result.
    ALL checks run regardless of failures (no short-circuit) so you see everything.
    """
    failures = []
    warnings = []

    # 1. Balance check
    ok, msg = await check_balance(required_usd, available_usd)
    if not ok:
        failures.append(msg)

    # 2. Position limit
    ok, msg = check_position_limit()
    if not ok:
        failures.append(msg)

    # 3. Slippage check
    ok, msg = check_slippage(estimated_slippage)
    if not ok:
        failures.append(msg)

    # 4. Correlation check
    ok, msg = check_correlation(asset_class, side, symbol)
    if not ok:
        failures.append(msg)

    # 5. Daily loss limit
    ok, msg = check_daily_loss_limit()
    if not ok:
        failures.append(msg)

    # 6. EV threshold
    ok, msg = check_ev_threshold(ev_percent)
    if not ok:
        failures.append(msg)

    result = GuardResult(
        passed=len(failures) == 0,
        failures=failures,
        warnings=warnings,
    )

    if result.passed:
        logger.info(f"Guards PASSED for {symbol}")
    else:
        logger.warning(f"Guards BLOCKED {symbol}: {result.summary}")

    return result
