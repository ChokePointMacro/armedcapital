"""
AI Probability Estimator — uses Claude to estimate true probabilities
for prediction markets and generate directional signals for crypto.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Optional

import httpx

from bot.config import config
from bot.brain.prompts.v1_polymarket import (
    SYSTEM_PROMPT,
    ESTIMATE_PROMPT,
    CRYPTO_SYSTEM_PROMPT,
    CRYPTO_SIGNAL_PROMPT,
)

logger = logging.getLogger(__name__)

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"


@dataclass
class ProbabilityEstimate:
    """Result from the AI probability estimator."""

    probability: float  # 0.0 to 1.0
    confidence: float  # 0.0 to 1.0
    reasoning: str
    edge: str  # Why market might be mispriced
    risk_factors: list[str]
    raw_response: dict  # Full parsed JSON from Claude

    @property
    def has_edge(self) -> bool:
        return self.edge.lower() != "none"


@dataclass
class CryptoSignal:
    """Result from the AI crypto signal generator."""

    signal: str  # 'long', 'short', 'neutral'
    probability_up: float
    confidence: float
    entry_price: float
    stop_loss: float
    take_profit: float
    reasoning: str
    risk_factors: list[str]
    raw_response: dict


class AIEstimator:
    """
    Claude-powered probability estimator.
    Makes structured API calls and parses JSON responses.
    """

    def __init__(self):
        self._http: Optional[httpx.AsyncClient] = None

    async def connect(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                timeout=60.0,
                headers={
                    "x-api-key": config.anthropic_api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
            )
        return self._http

    async def close(self):
        if self._http:
            await self._http.aclose()
            self._http = None

    async def _call_claude(
        self, system: str, user_message: str, max_tokens: int = 1024
    ) -> str:
        """Make a raw Claude API call and return the text response."""
        http = await self.connect()
        payload = {
            "model": config.claude_model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user_message}],
        }

        resp = await http.post(ANTHROPIC_API_URL, json=payload)
        resp.raise_for_status()

        data = resp.json()
        text = data["content"][0]["text"]
        return text.strip()

    def _parse_json(self, text: str) -> dict:
        """Parse JSON from Claude's response, handling common formatting issues."""
        # Strip markdown code fences if present
        cleaned = text
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            # Remove first and last line (code fences)
            lines = [l for l in lines if not l.strip().startswith("```")]
            cleaned = "\n".join(lines)

        return json.loads(cleaned)

    # ─── Polymarket Estimation ───────────────────────────────────

    async def estimate_polymarket(
        self,
        question: str,
        description: str,
        yes_price: float,
        volume: float,
        end_date: str,
        additional_context: str = "",
    ) -> ProbabilityEstimate:
        """
        Estimate the true probability of a Polymarket outcome.
        Compares AI estimate vs market price to find edge.
        """
        market_implied_prob = yes_price * 100

        prompt = ESTIMATE_PROMPT.format(
            question=question,
            description=description,
            yes_price=yes_price,
            market_implied_prob=market_implied_prob,
            volume=volume,
            end_date=end_date,
            additional_context=additional_context or "No additional context available.",
        )

        logger.info(f"Estimating probability for: {question[:80]}...")

        try:
            response_text = await self._call_claude(SYSTEM_PROMPT, prompt)
            parsed = self._parse_json(response_text)

            estimate = ProbabilityEstimate(
                probability=float(parsed["probability"]),
                confidence=float(parsed["confidence"]),
                reasoning=parsed["reasoning"],
                edge=parsed.get("edge", "none"),
                risk_factors=parsed.get("risk_factors", []),
                raw_response=parsed,
            )

            logger.info(
                f"Estimate: {estimate.probability:.1%} "
                f"(market: {yes_price:.1%}, "
                f"edge: {estimate.probability - yes_price:+.1%})"
            )
            return estimate

        except Exception as e:
            logger.error(f"Failed to estimate probability: {e}")
            raise

    # ─── Crypto Signal Generation ────────────────────────────────

    async def estimate_crypto(
        self,
        symbol: str,
        current_price: float,
        change_24h: float,
        volume_24h: float,
        price_history: str,
        additional_context: str = "",
    ) -> CryptoSignal:
        """
        Generate a directional signal for a crypto asset.
        Returns signal (long/short/neutral) with probabilities.
        """
        prompt = CRYPTO_SIGNAL_PROMPT.format(
            symbol=symbol,
            current_price=current_price,
            change_24h=change_24h,
            volume_24h=volume_24h,
            price_history=price_history,
            additional_context=additional_context or "No additional context.",
        )

        logger.info(f"Generating signal for: {symbol}")

        try:
            response_text = await self._call_claude(
                CRYPTO_SYSTEM_PROMPT, prompt
            )
            parsed = self._parse_json(response_text)

            signal = CryptoSignal(
                signal=parsed["signal"],
                probability_up=float(parsed["probability_up"]),
                confidence=float(parsed["confidence"]),
                entry_price=float(parsed["entry_price"]),
                stop_loss=float(parsed["stop_loss"]),
                take_profit=float(parsed["take_profit"]),
                reasoning=parsed["reasoning"],
                risk_factors=parsed.get("risk_factors", []),
                raw_response=parsed,
            )

            logger.info(
                f"Signal: {signal.signal} | P(up): {signal.probability_up:.1%} | "
                f"Confidence: {signal.confidence:.1%}"
            )
            return signal

        except Exception as e:
            logger.error(f"Failed to generate crypto signal: {e}")
            raise


# Singleton
ai_estimator = AIEstimator()
