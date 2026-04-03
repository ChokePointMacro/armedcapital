"""
Expected Value calculation — the first gate for any trade.
Only trades with EV above threshold pass through.
"""

from __future__ import annotations

from dataclasses import dataclass
from bot.config import config


@dataclass
class EVResult:
    """Expected value calculation result."""

    ev: float  # Raw expected value
    ev_percent: float  # EV as % of position
    edge: float  # Probability edge (our estimate - market)
    passes_threshold: bool  # Whether EV exceeds minimum
    potential_profit: float
    potential_loss: float

    @property
    def summary(self) -> str:
        status = "PASS" if self.passes_threshold else "FAIL"
        return (
            f"[{status}] EV: {self.ev_percent:+.1%} | "
            f"Edge: {self.edge:+.1%} | "
            f"Profit: ${self.potential_profit:.2f} / Loss: ${self.potential_loss:.2f}"
        )


def calculate_ev(
    estimated_prob: float,
    market_price: float,
    position_size: float,
    threshold: float | None = None,
) -> EVResult:
    """
    Calculate expected value for a prediction market trade.

    Args:
        estimated_prob: Our estimated probability of YES (0.0 to 1.0)
        market_price: Current market price for YES (0.0 to 1.0)
        position_size: Dollar amount we'd bet
        threshold: Minimum EV % to pass (default from config)

    Returns:
        EVResult with full breakdown.
    """
    if threshold is None:
        threshold = config.ev_threshold

    # Buying YES at market_price
    # If YES resolves: profit = (1.0 - market_price) * quantity
    # If NO resolves: loss = market_price * quantity
    quantity = position_size / market_price if market_price > 0 else 0

    potential_profit = (1.0 - market_price) * quantity
    potential_loss = position_size  # We lose what we put in

    # EV = P(win) * profit - P(loss) * loss
    ev = (estimated_prob * potential_profit) - ((1 - estimated_prob) * potential_loss)
    ev_percent = ev / position_size if position_size > 0 else 0

    edge = estimated_prob - market_price

    return EVResult(
        ev=ev,
        ev_percent=ev_percent,
        edge=edge,
        passes_threshold=ev_percent >= threshold,
        potential_profit=potential_profit,
        potential_loss=potential_loss,
    )


def calculate_crypto_ev(
    probability_up: float,
    entry_price: float,
    take_profit: float,
    stop_loss: float,
    position_size: float,
    threshold: float | None = None,
) -> EVResult:
    """
    Calculate expected value for a crypto directional trade.

    Args:
        probability_up: Probability price goes up
        entry_price: Entry price
        take_profit: Target exit price
        stop_loss: Stop loss price
        position_size: Dollar amount
        threshold: Minimum EV % to pass

    Returns:
        EVResult with full breakdown.
    """
    if threshold is None:
        threshold = config.ev_threshold

    if entry_price <= 0:
        return EVResult(0, 0, 0, False, 0, 0)

    # For a long trade
    profit_pct = (take_profit - entry_price) / entry_price
    loss_pct = (entry_price - stop_loss) / entry_price

    potential_profit = position_size * profit_pct
    potential_loss = position_size * loss_pct

    ev = (probability_up * potential_profit) - ((1 - probability_up) * potential_loss)
    ev_percent = ev / position_size if position_size > 0 else 0

    edge = probability_up - 0.5  # Edge over coin flip

    return EVResult(
        ev=ev,
        ev_percent=ev_percent,
        edge=edge,
        passes_threshold=ev_percent >= threshold,
        potential_profit=potential_profit,
        potential_loss=potential_loss,
    )
