"""
Polymarket client — interfaces with the CLOB API and Gamma API for prediction markets.
Handles market discovery, price data, and order execution on Polymarket.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from bot.config import config

logger = logging.getLogger(__name__)

# Polymarket API endpoints
CLOB_BASE = "https://clob.polymarket.com"
GAMMA_BASE = "https://gamma-api.polymarket.com"


class PolymarketClient:
    """
    Client for Polymarket prediction markets.

    Uses the Gamma API for market discovery/metadata and the CLOB API
    for orderbook data and order execution.

    Note: Full order execution requires py-clob-client with wallet auth.
    This client handles read-only operations and will be extended for
    trading once Polymarket US access is available.
    """

    def __init__(self):
        self._http: Optional[httpx.AsyncClient] = None

    async def connect(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                timeout=30.0,
                headers={"Accept": "application/json"},
            )
            logger.info("Polymarket HTTP client initialized")
        return self._http

    async def close(self):
        if self._http:
            await self._http.aclose()
            self._http = None

    # ─── Market Discovery (Gamma API) ────────────────────────────

    async def get_active_markets(
        self, limit: int = 50, offset: int = 0
    ) -> list[dict[str, Any]]:
        """Fetch active prediction markets from the Gamma API."""
        http = await self.connect()
        resp = await http.get(
            f"{GAMMA_BASE}/markets",
            params={
                "limit": limit,
                "offset": offset,
                "active": True,
                "closed": False,
            },
        )
        resp.raise_for_status()
        return resp.json()

    async def get_market(self, condition_id: str) -> dict[str, Any]:
        """Get detailed info for a specific market."""
        http = await self.connect()
        resp = await http.get(f"{GAMMA_BASE}/markets/{condition_id}")
        resp.raise_for_status()
        return resp.json()

    async def search_markets(self, query: str, limit: int = 20) -> list[dict]:
        """Search markets by keyword."""
        http = await self.connect()
        resp = await http.get(
            f"{GAMMA_BASE}/markets",
            params={"tag": query, "limit": limit, "active": True},
        )
        resp.raise_for_status()
        return resp.json()

    async def get_events(self, limit: int = 20) -> list[dict]:
        """Get active events (groups of related markets)."""
        http = await self.connect()
        resp = await http.get(
            f"{GAMMA_BASE}/events",
            params={"limit": limit, "active": True, "closed": False},
        )
        resp.raise_for_status()
        return resp.json()

    # ─── Price Data (CLOB API) ───────────────────────────────────

    async def get_orderbook(self, token_id: str) -> dict[str, Any]:
        """Get CLOB orderbook for a specific token."""
        http = await self.connect()
        resp = await http.get(
            f"{CLOB_BASE}/book", params={"token_id": token_id}
        )
        resp.raise_for_status()
        return resp.json()

    async def get_midpoint(self, token_id: str) -> Optional[float]:
        """Get the midpoint price for a token (0.0 to 1.0)."""
        http = await self.connect()
        resp = await http.get(
            f"{CLOB_BASE}/midpoint", params={"token_id": token_id}
        )
        resp.raise_for_status()
        data = resp.json()
        mid = data.get("mid")
        return float(mid) if mid else None

    async def get_price(self, token_id: str) -> Optional[float]:
        """Get the last traded price for a token."""
        http = await self.connect()
        resp = await http.get(
            f"{CLOB_BASE}/price", params={"token_id": token_id, "side": "buy"}
        )
        resp.raise_for_status()
        data = resp.json()
        price = data.get("price")
        return float(price) if price else None

    async def get_prices(self, token_ids: list[str]) -> dict[str, float]:
        """Get prices for multiple tokens at once."""
        http = await self.connect()
        results = {}
        # CLOB doesn't have a batch endpoint, so we fetch in parallel
        for token_id in token_ids:
            try:
                price = await self.get_price(token_id)
                if price is not None:
                    results[token_id] = price
            except Exception as e:
                logger.warning(f"Failed to get price for {token_id}: {e}")
        return results

    # ─── Market Analysis Helpers ─────────────────────────────────

    async def get_market_with_prices(self, condition_id: str) -> dict[str, Any]:
        """
        Get market info enriched with current prices.
        Returns market data + yes_price + no_price.
        """
        market = await self.get_market(condition_id)

        tokens = market.get("tokens", [])
        for token in tokens:
            token_id = token.get("token_id")
            if token_id:
                price = await self.get_midpoint(token_id)
                token["current_price"] = price

        return market

    async def find_opportunities(
        self, min_volume: float = 1000, limit: int = 50
    ) -> list[dict]:
        """
        Scan active markets and return those with sufficient volume.
        This is the entry point for the AI brain to evaluate.
        """
        markets = await self.get_active_markets(limit=limit)
        opportunities = []

        for market in markets:
            volume = float(market.get("volume", 0) or 0)
            if volume >= min_volume:
                # Enrich with current price data
                tokens = market.get("tokens", [])
                if tokens:
                    try:
                        token_id = tokens[0].get("token_id")
                        if token_id:
                            price = await self.get_midpoint(token_id)
                            market["yes_price"] = price
                            market["no_price"] = 1.0 - price if price else None
                    except Exception:
                        pass
                opportunities.append(market)

        return opportunities

    # ─── Order Execution (requires py-clob-client auth) ──────────

    async def place_order(self, *args, **kwargs) -> dict:
        """
        Placeholder for order execution.
        Will be implemented with py-clob-client once Polymarket US access
        is available and wallet auth is configured.
        """
        raise NotImplementedError(
            "Polymarket order execution requires py-clob-client with wallet auth. "
            "Configure POLYGON_PRIVATE_KEY and ensure Polymarket US access."
        )


# Singleton
polymarket_client = PolymarketClient()
