"""
Multi-exchange client via CCXT — currently configured for Coinbase Advanced Trade.
Provides unified market data, orderbook, and order execution interface.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

import ccxt.async_support as ccxt

from bot.config import config

logger = logging.getLogger(__name__)


class ExchangeClient:
    """Unified exchange interface via CCXT (async)."""

    def __init__(self):
        self._exchange: Optional[ccxt.Exchange] = None
        self._exchange_id = "coinbase"

    async def connect(self) -> ccxt.Exchange:
        if self._exchange is None:
            exchange_class = getattr(ccxt, self._exchange_id)
            self._exchange = exchange_class(
                {
                    "apiKey": config.coinbase_api_key,
                    "secret": config.coinbase_api_secret,
                    "enableRateLimit": True,
                    "options": {"defaultType": "spot"},
                }
            )
            # Load markets on first connect
            await self._exchange.load_markets()
            logger.info(
                f"Connected to {self._exchange_id} — "
                f"{len(self._exchange.markets)} markets loaded"
            )
        return self._exchange

    async def close(self):
        if self._exchange:
            await self._exchange.close()
            self._exchange = None

    # ─── Market Data ─────────────────────────────────────────────

    async def get_ticker(self, symbol: str) -> dict[str, Any]:
        """Get current price data for a symbol (e.g., 'BTC/USD')."""
        exchange = await self.connect()
        return await exchange.fetch_ticker(symbol)

    async def get_tickers(self, symbols: list[str]) -> dict[str, Any]:
        """Get price data for multiple symbols at once."""
        exchange = await self.connect()
        return await exchange.fetch_tickers(symbols)

    async def get_orderbook(self, symbol: str, limit: int = 20) -> dict[str, Any]:
        """Get orderbook depth for slippage estimation."""
        exchange = await self.connect()
        return await exchange.fetch_order_book(symbol, limit)

    async def get_ohlcv(
        self, symbol: str, timeframe: str = "1h", limit: int = 100
    ) -> list:
        """Get candlestick data for technical analysis."""
        exchange = await self.connect()
        return await exchange.fetch_ohlcv(symbol, timeframe, limit=limit)

    # ─── Account ─────────────────────────────────────────────────

    async def get_balance(self) -> dict[str, Any]:
        """Get account balances across all currencies."""
        exchange = await self.connect()
        return await exchange.fetch_balance()

    async def get_usd_balance(self) -> float:
        """Get available USD balance."""
        balance = await self.get_balance()
        usd = balance.get("USD", {})
        return float(usd.get("free", 0))

    # ─── Orders ──────────────────────────────────────────────────

    async def create_limit_order(
        self, symbol: str, side: str, amount: float, price: float
    ) -> dict[str, Any]:
        """Place a limit order. Side: 'buy' or 'sell'."""
        exchange = await self.connect()
        logger.info(
            f"Placing {side} limit order: {amount} {symbol} @ ${price}"
        )
        return await exchange.create_limit_order(symbol, side, amount, price)

    async def create_market_order(
        self, symbol: str, side: str, amount: float
    ) -> dict[str, Any]:
        """Place a market order. Side: 'buy' or 'sell'."""
        exchange = await self.connect()
        logger.info(f"Placing {side} market order: {amount} {symbol}")
        return await exchange.create_market_order(symbol, side, amount)

    async def cancel_order(self, order_id: str, symbol: str) -> dict[str, Any]:
        """Cancel an open order."""
        exchange = await self.connect()
        return await exchange.cancel_order(order_id, symbol)

    async def get_open_orders(self, symbol: str | None = None) -> list[dict]:
        """Get all open orders, optionally filtered by symbol."""
        exchange = await self.connect()
        return await exchange.fetch_open_orders(symbol)

    # ─── Utility ─────────────────────────────────────────────────

    async def estimate_slippage(
        self, symbol: str, side: str, amount_usd: float
    ) -> float:
        """
        Estimate slippage for a given order size by walking the orderbook.
        Returns slippage as a decimal (e.g., 0.01 = 1%).
        """
        orderbook = await self.get_orderbook(symbol, limit=50)
        book_side = orderbook["asks"] if side == "buy" else orderbook["bids"]

        if not book_side:
            return 1.0  # No liquidity — max slippage

        mid_price = (orderbook["asks"][0][0] + orderbook["bids"][0][0]) / 2
        remaining_usd = amount_usd
        weighted_price = 0.0
        total_filled = 0.0

        for price, qty in book_side:
            level_usd = price * qty
            fill_usd = min(remaining_usd, level_usd)
            fill_qty = fill_usd / price
            weighted_price += price * fill_qty
            total_filled += fill_qty
            remaining_usd -= fill_usd
            if remaining_usd <= 0:
                break

        if total_filled == 0:
            return 1.0

        avg_fill_price = weighted_price / total_filled
        slippage = abs(avg_fill_price - mid_price) / mid_price
        return slippage

    def get_available_symbols(self) -> list[str]:
        """Return list of tradeable symbols (requires prior connect)."""
        if self._exchange and self._exchange.markets:
            return list(self._exchange.markets.keys())
        return []


# Singleton
exchange_client = ExchangeClient()
