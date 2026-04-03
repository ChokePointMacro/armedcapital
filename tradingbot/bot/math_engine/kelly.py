"""
Kelly Criterion position sizing — determines optimal bet size as a fraction of bankroll.
Uses fractional Kelly (default 0.25x) for safety.
"""

from __future__ import annotations

from bot.config import config


def kelly_fraction(
    probability: float,
    odds: float,
    fraction: float | None = None,
) -> float:
    """
    Calculate the fractional Kelly bet size.

    Args:
        probability: Estimated probability of winning (0.0 to 1.0)
        odds: Net odds received (e.g., 2.0 means you win 2x your bet)
              For Polymarket: odds = 1.0 / market_price - 1 (for YES bets)
        fraction: Kelly fraction multiplier (default from config, typically 0.25)

    Returns:
        Fraction of bankroll to bet (0.0 to max_position_pct).
        Returns 0.0 if no edge (negative Kelly).
    """
    if fraction is None:
        fraction = config.kelly_fraction

    q = 1.0 - probability
    b = odds

    # Full Kelly formula: f = (bp - q) / b
    full_kelly = (b * probability - q) / b

    # No edge — don't bet
    if full_kelly <= 0:
        return 0.0

    # Apply fractional Kelly
    sized = full_kelly * fraction

    # Hard cap at max position size
    return min(sized, config.max_position_pct)


def kelly_from_prices(
    estimated_prob: float,
    market_price: float,
    fraction: float | None = None,
) -> float:
    """
    Convenience wrapper for prediction markets.
    Converts market price to odds and runs Kelly.

    Args:
        estimated_prob: Your estimated true probability of YES
        market_price: Current market price for YES (0.0 to 1.0)
        fraction: Kelly fraction multiplier

    Returns:
        Fraction of bankroll to bet.
    """
    if market_price <= 0 or market_price >= 1:
        return 0.0

    # Net odds: if you buy YES at $0.40 and it resolves to $1.00, you get 1.5x net
    odds = (1.0 / market_price) - 1.0
    return kelly_fraction(estimated_prob, odds, fraction)


def position_size_usd(
    bankroll: float,
    estimated_prob: float,
    market_price: float,
    fraction: float | None = None,
) -> float:
    """
    Calculate dollar amount to bet.

    Args:
        bankroll: Total available capital in USD
        estimated_prob: Your estimated probability
        market_price: Current market price
        fraction: Kelly fraction

    Returns:
        USD amount to bet (always >= 0).
    """
    kelly_pct = kelly_from_prices(estimated_prob, market_price, fraction)
    return bankroll * kelly_pct
