"""
Bayesian Updating — tracks win/loss record and adjusts probability estimates over time.
The bot learns from its own results to improve future sizing.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

# Local persistence file for Bayesian state
STATE_FILE = Path(__file__).resolve().parent.parent.parent / "bayesian_state.json"


@dataclass
class BayesianEstimator:
    """
    Beta-Binomial Bayesian estimator.

    Tracks a prior belief (alpha, beta) and updates it with trade outcomes.
    Used to calibrate the AI's probability estimates over time.

    - alpha = pseudo-count of "wins" (correct predictions)
    - beta = pseudo-count of "losses" (incorrect predictions)
    - Starts with uniform prior (alpha=1, beta=1)
    """

    name: str = "default"
    alpha: float = 1.0  # Prior wins
    beta: float = 1.0  # Prior losses
    total_updates: int = 0

    @property
    def mean(self) -> float:
        """Expected probability (mean of Beta distribution)."""
        return self.alpha / (self.alpha + self.beta)

    @property
    def sample_size(self) -> int:
        """Effective sample size."""
        return int(self.alpha + self.beta - 2)  # Subtract the prior

    @property
    def variance(self) -> float:
        """Variance of the Beta distribution."""
        a, b = self.alpha, self.beta
        return (a * b) / ((a + b) ** 2 * (a + b + 1))

    @property
    def confidence_interval(self) -> tuple[float, float]:
        """Approximate 95% CI using normal approximation."""
        from math import sqrt

        std = sqrt(self.variance)
        return (max(0, self.mean - 1.96 * std), min(1, self.mean + 1.96 * std))

    def update(self, outcome: bool, weight: float = 1.0) -> None:
        """
        Update beliefs based on a trade outcome.

        Args:
            outcome: True if prediction was correct, False otherwise
            weight: Strength of update (default 1.0, use 0.5 for weak signals)
        """
        if outcome:
            self.alpha += weight
        else:
            self.beta += weight
        self.total_updates += 1
        logger.debug(
            f"Bayesian update [{self.name}]: "
            f"{'win' if outcome else 'loss'} | "
            f"Mean: {self.mean:.3f} | "
            f"Sample: {self.sample_size}"
        )

    def adjusted_probability(self, ai_estimate: float) -> float:
        """
        Blend the AI's raw estimate with our Bayesian calibration.

        If the AI has been overconfident historically, this pulls
        estimates toward 50%. If well-calibrated, minimal adjustment.

        Args:
            ai_estimate: Raw probability from Claude (0.0 to 1.0)

        Returns:
            Calibration-adjusted probability.
        """
        # Weight of calibration depends on sample size
        # With few samples, trust AI more; with many, trust calibration more
        calibration_weight = min(0.3, self.sample_size / 100)
        ai_weight = 1.0 - calibration_weight

        # Shrink toward calibrated mean
        return ai_weight * ai_estimate + calibration_weight * self.mean

    def kelly_adjustment(self) -> float:
        """
        Suggest a Kelly fraction multiplier based on calibration.

        If we're poorly calibrated (high variance), reduce bet sizes.
        If well calibrated with enough data, allow larger bets.
        """
        if self.sample_size < 10:
            return 0.5  # Conservative until we have data
        if self.sample_size < 30:
            return 0.75
        if self.variance < 0.01:
            return 1.0  # Well calibrated
        return 0.8  # Default moderate


@dataclass
class BayesianTracker:
    """
    Manages multiple Bayesian estimators — one per asset class / strategy.
    Persists state to disk for survival across restarts.
    """

    estimators: dict[str, BayesianEstimator] = field(default_factory=dict)

    def get(self, name: str) -> BayesianEstimator:
        """Get or create an estimator by name."""
        if name not in self.estimators:
            self.estimators[name] = BayesianEstimator(name=name)
        return self.estimators[name]

    def update(self, name: str, outcome: bool, weight: float = 1.0) -> None:
        """Update a specific estimator."""
        self.get(name).update(outcome, weight)

    def save(self) -> None:
        """Persist state to disk."""
        data = {}
        for name, est in self.estimators.items():
            data[name] = {
                "alpha": est.alpha,
                "beta": est.beta,
                "total_updates": est.total_updates,
            }
        STATE_FILE.write_text(json.dumps(data, indent=2))
        logger.debug(f"Bayesian state saved ({len(data)} estimators)")

    def load(self) -> None:
        """Load state from disk."""
        if not STATE_FILE.exists():
            return
        try:
            data = json.loads(STATE_FILE.read_text())
            for name, vals in data.items():
                est = BayesianEstimator(
                    name=name,
                    alpha=vals["alpha"],
                    beta=vals["beta"],
                    total_updates=vals["total_updates"],
                )
                self.estimators[name] = est
            logger.info(f"Bayesian state loaded ({len(data)} estimators)")
        except Exception as e:
            logger.warning(f"Failed to load Bayesian state: {e}")

    def summary(self) -> dict[str, dict]:
        """Return a summary of all estimators."""
        return {
            name: {
                "mean": est.mean,
                "sample_size": est.sample_size,
                "ci_95": est.confidence_interval,
                "kelly_adj": est.kelly_adjustment(),
            }
            for name, est in self.estimators.items()
        }


# Singleton
bayesian_tracker = BayesianTracker()
