"""
Paper Trading Engine — simulates order execution with realistic fills.
Identical interface to live trading so flipping to live is a config change.
"""

from __future__ import annotations

import logging
import random
from datetime import datetime, timezone
from typing import Any

from bot.config import config
from bot.db.supabase import db

logger = logging.getLogger(__name__)


class PaperTrader:
    """
    Simulates trading without real money.
    Uses live market data but executes orders locally.
    Tracks everything in Supabase (same tables as live).
    """

    def __init__(self):
        self._bankroll: float | None = None

    @property
    def bankroll(self) -> float:
        """Get current paper bankroll from DB or config default."""
        if self._bankroll is None:
            perf = db.get_performance_history(limit=1)
            if perf and perf[0].get("total_equity"):
                self._bankroll = float(perf[0]["total_equity"])
            else:
                self._bankroll = config.paper_bankroll
        return self._bankroll

    @bankroll.setter
    def bankroll(self, value: float):
        self._bankroll = value

    def _simulate_fill(
        self, price: float, side: str, order_type: str
    ) -> tuple[float, float]:
        """
        Simulate a realistic fill price with slippage and fees.

        Returns:
            (fill_price, fee_usd)
        """
        # Simulate 0.01-0.05% slippage on market orders
        if order_type == "market":
            slippage_pct = random.uniform(0.0001, 0.0005)
            if side in ("buy", "yes"):
                fill_price = price * (1 + slippage_pct)
            else:
                fill_price = price * (1 - slippage_pct)
        else:
            # Limit orders fill at specified price
            fill_price = price

        # Simulate 0.1% trading fee (typical for Coinbase maker)
        fee_pct = 0.001

        return fill_price, fee_pct

    async def open_position(
        self,
        asset_class: str,
        exchange: str,
        symbol: str,
        side: str,
        price: float,
        position_size_usd: float,
        kelly_fraction: float,
        ev_at_entry: float,
        ai_probability: float,
        ai_reasoning: str,
        ai_model: str,
        market_id: str | None = None,
        order_type: str = "market",
    ) -> dict[str, Any]:
        """
        Open a paper position.
        Records the position and trade in Supabase.
        """
        fill_price, fee_pct = self._simulate_fill(price, side, order_type)
        fee = position_size_usd * fee_pct
        quantity = (position_size_usd - fee) / fill_price

        # Create position record
        position = db.create_position(
            {
                "asset_class": asset_class,
                "exchange": exchange,
                "symbol": symbol,
                "market_id": market_id,
                "side": side,
                "entry_price": fill_price,
                "current_price": fill_price,
                "quantity": quantity,
                "position_size_usd": position_size_usd,
                "kelly_fraction": kelly_fraction,
                "ev_at_entry": ev_at_entry,
                "ai_probability": ai_probability,
                "ai_reasoning": ai_reasoning,
                "ai_model": ai_model,
                "status": "open",
                "metadata": {"is_paper": True, "order_type": order_type},
            }
        )

        # Record the trade
        db.record_trade(
            {
                "position_id": position.get("id"),
                "exchange": exchange,
                "symbol": symbol,
                "side": side,
                "order_type": order_type,
                "price": fill_price,
                "quantity": quantity,
                "fee": fee,
                "slippage": abs(fill_price - price) / price if price > 0 else 0,
                "is_paper": True,
            }
        )

        # Update bankroll
        self.bankroll -= position_size_usd

        logger.info(
            f"📄 PAPER OPEN: {side.upper()} {symbol} | "
            f"${position_size_usd:.2f} @ ${fill_price:.4f} | "
            f"Qty: {quantity:.6f} | Fee: ${fee:.2f}"
        )

        return position

    async def close_position(
        self,
        position_id: str,
        current_price: float,
        reason: str = "signal",
    ) -> dict[str, Any]:
        """
        Close a paper position at current price.
        Calculates P&L and updates records.
        """
        position = db.get_position(position_id)
        if not position:
            logger.error(f"Position {position_id} not found")
            return {}

        entry_price = float(position["entry_price"])
        quantity = float(position["quantity"])
        side = position["side"]
        position_size = float(position["position_size_usd"])

        # Simulate fill
        close_side = "sell" if side in ("buy", "yes") else "buy"
        fill_price, fee_pct = self._simulate_fill(current_price, close_side, "market")
        fee = quantity * fill_price * fee_pct

        # Calculate P&L
        if side in ("buy", "yes"):
            raw_pnl = (fill_price - entry_price) * quantity
        else:
            raw_pnl = (entry_price - fill_price) * quantity

        pnl = raw_pnl - fee
        pnl_percent = pnl / position_size if position_size > 0 else 0

        # Update position
        result = db.close_position(position_id, pnl, pnl_percent, reason)

        # Record closing trade
        db.record_trade(
            {
                "position_id": position_id,
                "exchange": position["exchange"],
                "symbol": position["symbol"],
                "side": close_side,
                "order_type": "market",
                "price": fill_price,
                "quantity": quantity,
                "fee": fee,
                "is_paper": True,
            }
        )

        # Update bankroll
        self.bankroll += position_size + pnl

        emoji = "🟢" if pnl >= 0 else "🔴"
        logger.info(
            f"📄 PAPER CLOSE: {emoji} {position['symbol']} | "
            f"PnL: ${pnl:+.2f} ({pnl_percent:+.1%}) | "
            f"Reason: {reason} | "
            f"Bankroll: ${self.bankroll:,.2f}"
        )

        return result

    async def update_positions(self, prices: dict[str, float]) -> None:
        """
        Update current_price on all open positions.
        Called on each scan cycle to keep dashboard current.
        """
        open_positions = db.get_open_positions()
        for pos in open_positions:
            symbol = pos["symbol"]
            if symbol in prices:
                db.update_position(
                    pos["id"], {"current_price": prices[symbol]}
                )

    def get_portfolio_value(self) -> float:
        """Calculate total portfolio value (cash + open positions)."""
        open_positions = db.get_open_positions()
        positions_value = sum(
            float(p.get("current_price", 0)) * float(p.get("quantity", 0))
            for p in open_positions
        )
        return self.bankroll + positions_value

    def get_stats(self) -> dict[str, Any]:
        """Get paper trading statistics."""
        recent = db.get_recent_positions(limit=1000)
        closed = [p for p in recent if p["status"] == "closed"]

        if not closed:
            return {
                "total_trades": 0,
                "win_rate": 0,
                "total_pnl": 0,
                "avg_pnl": 0,
                "bankroll": self.bankroll,
                "portfolio_value": self.get_portfolio_value(),
            }

        wins = [p for p in closed if float(p.get("pnl", 0)) > 0]
        total_pnl = sum(float(p.get("pnl", 0)) for p in closed)

        return {
            "total_trades": len(closed),
            "wins": len(wins),
            "losses": len(closed) - len(wins),
            "win_rate": len(wins) / len(closed) if closed else 0,
            "total_pnl": total_pnl,
            "avg_pnl": total_pnl / len(closed) if closed else 0,
            "best_trade": max(float(p.get("pnl", 0)) for p in closed),
            "worst_trade": min(float(p.get("pnl", 0)) for p in closed),
            "bankroll": self.bankroll,
            "portfolio_value": self.get_portfolio_value(),
        }


# Singleton
paper_trader = PaperTrader()
