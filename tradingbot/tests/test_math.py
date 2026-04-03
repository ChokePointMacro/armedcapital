"""
Tests for the math engine — EV, Kelly, and Bayesian modules.
Run: pytest tests/test_math.py -v
"""

import pytest


class TestKelly:
    """Test Kelly Criterion position sizing."""

    def test_no_edge_returns_zero(self):
        from bot.math_engine.kelly import kelly_fraction

        # If probability equals what odds imply, no edge
        result = kelly_fraction(probability=0.5, odds=1.0, fraction=0.25)
        assert result == 0.0

    def test_positive_edge(self):
        from bot.math_engine.kelly import kelly_fraction

        # 60% chance with even money = clear edge
        result = kelly_fraction(probability=0.6, odds=1.0, fraction=0.25)
        assert result > 0
        assert result <= 0.02  # Capped at max_position_pct

    def test_negative_edge_returns_zero(self):
        from bot.math_engine.kelly import kelly_fraction

        result = kelly_fraction(probability=0.3, odds=1.0, fraction=0.25)
        assert result == 0.0

    def test_fraction_scales_down(self):
        from bot.math_engine.kelly import kelly_fraction

        full = kelly_fraction(probability=0.7, odds=1.0, fraction=1.0)
        quarter = kelly_fraction(probability=0.7, odds=1.0, fraction=0.25)
        assert quarter <= full  # Quarter Kelly never exceeds full Kelly
        assert quarter > 0  # Should still produce a bet

    def test_from_prices(self):
        from bot.math_engine.kelly import kelly_from_prices

        # Market says 40% (price=0.40), we think 60%
        result = kelly_from_prices(estimated_prob=0.6, market_price=0.4)
        assert result > 0

    def test_from_prices_no_edge(self):
        from bot.math_engine.kelly import kelly_from_prices

        # Our estimate matches market
        result = kelly_from_prices(estimated_prob=0.5, market_price=0.5)
        assert result == 0.0

    def test_position_size_usd(self):
        from bot.math_engine.kelly import position_size_usd

        size = position_size_usd(
            bankroll=1000, estimated_prob=0.7, market_price=0.4
        )
        assert size > 0
        assert size <= 1000 * 0.02  # Max 2% of bankroll


class TestExpectedValue:
    """Test Expected Value calculation."""

    def test_positive_ev(self):
        from bot.math_engine.expected_value import calculate_ev

        ev = calculate_ev(
            estimated_prob=0.7,
            market_price=0.5,
            position_size=100,
        )
        assert ev.ev > 0
        assert ev.edge > 0

    def test_negative_ev(self):
        from bot.math_engine.expected_value import calculate_ev

        ev = calculate_ev(
            estimated_prob=0.3,
            market_price=0.5,
            position_size=100,
        )
        assert ev.ev < 0
        assert ev.passes_threshold is False

    def test_threshold_check(self):
        from bot.math_engine.expected_value import calculate_ev

        ev = calculate_ev(
            estimated_prob=0.52,
            market_price=0.5,
            position_size=100,
            threshold=0.10,  # Need 10% EV
        )
        assert ev.passes_threshold is False  # Small edge won't pass high threshold


class TestBayesian:
    """Test Bayesian updating."""

    def test_uniform_prior(self):
        from bot.math_engine.bayesian import BayesianEstimator

        est = BayesianEstimator()
        assert est.mean == 0.5  # Uniform prior

    def test_update_win(self):
        from bot.math_engine.bayesian import BayesianEstimator

        est = BayesianEstimator()
        est.update(True)
        assert est.mean > 0.5  # Should shift up

    def test_update_loss(self):
        from bot.math_engine.bayesian import BayesianEstimator

        est = BayesianEstimator()
        est.update(False)
        assert est.mean < 0.5  # Should shift down

    def test_many_wins(self):
        from bot.math_engine.bayesian import BayesianEstimator

        est = BayesianEstimator()
        for _ in range(10):
            est.update(True)
        assert est.mean > 0.8

    def test_adjusted_probability(self):
        from bot.math_engine.bayesian import BayesianEstimator

        est = BayesianEstimator()
        # With no data, should mostly trust AI
        adjusted = est.adjusted_probability(0.7)
        assert 0.5 < adjusted <= 0.7

    def test_kelly_adjustment_conservative_with_few_samples(self):
        from bot.math_engine.bayesian import BayesianEstimator

        est = BayesianEstimator()
        assert est.kelly_adjustment() == 0.5  # Conservative

    def test_tracker(self):
        from bot.math_engine.bayesian import BayesianTracker

        tracker = BayesianTracker()
        tracker.update("crypto", True)
        tracker.update("crypto", True)
        tracker.update("polymarket", False)

        assert tracker.get("crypto").mean > 0.5
        assert tracker.get("polymarket").mean < 0.5
        assert "crypto" in tracker.summary()
