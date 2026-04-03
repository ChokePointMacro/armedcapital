"""
ArmedCapital TradingBot — Main Entry Point

This is the asyncio orchestrator that runs the full trading loop:
1. Scan markets (Polymarket + Coinbase)
2. Get AI probability estimates
3. Calculate EV and Kelly sizing
4. Run pre-trade guards
5. Execute trades (paper or live)
6. Monitor positions and process commands
7. Send alerts and log everything

Run: python -m bot.main
"""

from __future__ import annotations

import asyncio
import logging
import signal
import sys
from datetime import datetime, timezone

from bot.config import config
from bot.monitoring.logger import setup_logging
from bot.monitoring import telegram
from bot.db.supabase import db
from bot.data.exchanges import exchange_client
from bot.data.polymarket import polymarket_client
from bot.brain.estimator import ai_estimator
from bot.math_engine.expected_value import calculate_ev, calculate_crypto_ev
from bot.math_engine.kelly import kelly_from_prices, position_size_usd
from bot.math_engine.bayesian import bayesian_tracker
from bot.execution.guards import run_all_guards
from bot.execution.paper_trader import paper_trader

logger = logging.getLogger(__name__)

# ─── Scan Intervals ──────────────────────────────────────────────
CRYPTO_SCAN_INTERVAL = 300  # 5 minutes
POLYMARKET_SCAN_INTERVAL = 600  # 10 minutes
COMMAND_POLL_INTERVAL = 2  # 2 seconds
PERFORMANCE_SNAPSHOT_INTERVAL = 3600  # 1 hour
POSITION_UPDATE_INTERVAL = 60  # 1 minute

# ─── State ───────────────────────────────────────────────────────
_running = True
_paused = False

# Crypto symbols to scan
CRYPTO_WATCHLIST = [
    "BTC/USD",
    "ETH/USD",
    "SOL/USD",
]


def handle_shutdown(signum, frame):
    """Graceful shutdown on SIGINT/SIGTERM."""
    global _running
    logger.info("Shutdown signal received, cleaning up...")
    _running = False


async def scan_crypto():
    """
    Scan crypto markets for trading opportunities.
    Fetches live data, gets AI signals, and executes if criteria met.
    """
    global _paused
    if _paused:
        return

    logger.info("─── Crypto Scan ───")

    try:
        tickers = await exchange_client.get_tickers(CRYPTO_WATCHLIST)
    except Exception as e:
        logger.error(f"Failed to fetch crypto tickers: {e}")
        return

    for symbol in CRYPTO_WATCHLIST:
        try:
            ticker = tickers.get(symbol)
            if not ticker:
                continue

            current_price = ticker.get("last", 0)
            change_24h = ticker.get("percentage", 0) or 0
            volume_24h = ticker.get("quoteVolume", 0) or 0

            # Get recent candles for context
            try:
                candles = await exchange_client.get_ohlcv(symbol, "1h", limit=24)
                price_history = ", ".join(
                    [f"${c[4]:.0f}" for c in candles[-7:]]  # Last 7 closes
                )
            except Exception:
                price_history = "unavailable"

            # Get AI signal
            signal = await ai_estimator.estimate_crypto(
                symbol=symbol,
                current_price=current_price,
                change_24h=change_24h,
                volume_24h=volume_24h,
                price_history=price_history,
            )

            # Skip neutral signals
            if signal.signal == "neutral":
                logger.info(f"  {symbol}: NEUTRAL (skip)")
                continue

            # Calculate EV
            ev = calculate_crypto_ev(
                probability_up=signal.probability_up,
                entry_price=signal.entry_price,
                take_profit=signal.take_profit,
                stop_loss=signal.stop_loss,
                position_size=100,  # Placeholder for EV calc
            )

            logger.info(f"  {symbol}: {signal.signal.upper()} | {ev.summary}")

            if not ev.passes_threshold:
                continue

            # Calculate position size
            bankroll = paper_trader.bankroll if config.is_paper else await exchange_client.get_usd_balance()
            size = position_size_usd(
                bankroll=bankroll,
                estimated_prob=signal.probability_up,
                market_price=0.5,  # Use 50% as base for crypto directional
            )

            if size < 5:
                logger.info(f"  {symbol}: Size too small (${size:.2f})")
                continue

            # Estimate slippage
            slippage = await exchange_client.estimate_slippage(symbol, "buy", size)

            # Run guards
            available = bankroll
            guards = await run_all_guards(
                required_usd=size,
                available_usd=available,
                estimated_slippage=slippage,
                asset_class="crypto",
                side=signal.signal,
                symbol=symbol,
                ev_percent=ev.ev_percent,
            )

            if not guards.passed:
                continue

            # Execute trade
            if config.is_paper:
                position = await paper_trader.open_position(
                    asset_class="crypto",
                    exchange="coinbase",
                    symbol=symbol,
                    side="buy" if signal.signal == "long" else "sell",
                    price=current_price,
                    position_size_usd=size,
                    kelly_fraction=config.kelly_fraction,
                    ev_at_entry=ev.ev_percent,
                    ai_probability=signal.probability_up,
                    ai_reasoning=signal.reasoning,
                    ai_model=config.claude_model,
                )

                await telegram.alert_trade_opened(
                    symbol=symbol,
                    side=signal.signal,
                    price=current_price,
                    size_usd=size,
                    ev_percent=ev.ev_percent,
                    ai_probability=signal.probability_up,
                    is_paper=True,
                )

        except Exception as e:
            logger.error(f"Error scanning {symbol}: {e}")
            await telegram.alert_error(str(e), context=f"Crypto scan: {symbol}")


async def scan_polymarket():
    """
    Scan Polymarket for prediction market opportunities.
    """
    global _paused
    if _paused:
        return

    logger.info("─── Polymarket Scan ───")

    try:
        opportunities = await polymarket_client.find_opportunities(
            min_volume=1000, limit=30
        )
        logger.info(f"Found {len(opportunities)} markets with sufficient volume")
    except Exception as e:
        logger.error(f"Failed to scan Polymarket: {e}")
        return

    for market in opportunities:
        try:
            question = market.get("question", "Unknown")
            yes_price = market.get("yes_price")
            if yes_price is None:
                continue

            volume = float(market.get("volume", 0) or 0)
            end_date = market.get("end_date_iso", "unknown")
            description = market.get("description", "")

            # Get AI estimate
            estimate = await ai_estimator.estimate_polymarket(
                question=question,
                description=description[:500],
                yes_price=yes_price,
                volume=volume,
                end_date=end_date,
            )

            # Calculate EV
            bankroll = paper_trader.bankroll if config.is_paper else 1000
            size = position_size_usd(bankroll, estimate.probability, yes_price)

            ev = calculate_ev(
                estimated_prob=estimate.probability,
                market_price=yes_price,
                position_size=size if size > 0 else 100,
            )

            logger.info(f"  {question[:60]}... | {ev.summary}")

            if not ev.passes_threshold or size < 5:
                continue

            # Run guards
            guards = await run_all_guards(
                required_usd=size,
                available_usd=bankroll,
                estimated_slippage=0.01,  # Polymarket has thin books
                asset_class="polymarket",
                side="yes" if estimate.probability > yes_price else "no",
                symbol=question[:50],
                ev_percent=ev.ev_percent,
            )

            if not guards.passed:
                continue

            # Execute (paper only for now — Polymarket needs wallet auth)
            if config.is_paper:
                side = "yes" if estimate.probability > yes_price else "no"
                price = yes_price if side == "yes" else (1 - yes_price)

                position = await paper_trader.open_position(
                    asset_class="polymarket",
                    exchange="polymarket",
                    symbol=question[:100],
                    side=side,
                    price=price,
                    position_size_usd=size,
                    kelly_fraction=config.kelly_fraction,
                    ev_at_entry=ev.ev_percent,
                    ai_probability=estimate.probability,
                    ai_reasoning=estimate.reasoning,
                    ai_model=config.claude_model,
                    market_id=market.get("condition_id"),
                )

                await telegram.alert_trade_opened(
                    symbol=question[:50],
                    side=side,
                    price=price,
                    size_usd=size,
                    ev_percent=ev.ev_percent,
                    ai_probability=estimate.probability,
                    is_paper=True,
                )

        except Exception as e:
            logger.error(f"Error evaluating market: {e}")


async def process_commands():
    """Poll for commands from the dashboard (via Supabase)."""
    global _paused, _running

    try:
        commands = db.get_pending_commands()
        for cmd in commands:
            command = cmd["command"]
            payload = cmd.get("payload", {})
            logger.info(f"Processing command: {command}")

            try:
                if command == "pause":
                    _paused = True
                    await telegram.send_message("⏸ Bot paused by dashboard")
                elif command == "resume":
                    _paused = False
                    await telegram.send_message("▶️ Bot resumed by dashboard")
                elif command == "kill":
                    _running = False
                    await telegram.alert_bot_halted("Kill command from dashboard")
                elif command == "close_position":
                    pos_id = payload.get("position_id")
                    if pos_id:
                        # Get current price for the position
                        pos = db.get_position(pos_id)
                        if pos and pos["status"] == "open":
                            price = float(pos.get("current_price", pos["entry_price"]))
                            await paper_trader.close_position(
                                pos_id, price, reason="manual_close"
                            )
                elif command == "update_config":
                    # Update config in DB
                    db.upsert_bot_config(payload)

                db.mark_command_executed(cmd["id"])
            except Exception as e:
                logger.error(f"Command failed: {command} — {e}")
                db.mark_command_failed(cmd["id"])

    except Exception as e:
        logger.error(f"Command poll failed: {e}")


async def snapshot_performance():
    """Record a performance snapshot to Supabase."""
    try:
        stats = paper_trader.get_stats()
        open_positions = db.get_open_positions()

        db.record_performance(
            {
                "total_equity": stats["portfolio_value"],
                "daily_pnl": stats.get("total_pnl", 0),
                "total_pnl": stats.get("total_pnl", 0),
                "win_rate": stats.get("win_rate", 0),
                "open_positions": len(open_positions),
                "total_trades": stats.get("total_trades", 0),
            }
        )
        logger.info(
            f"Performance snapshot: "
            f"Equity=${stats['portfolio_value']:,.2f} | "
            f"PnL=${stats.get('total_pnl', 0):+.2f} | "
            f"WR={stats.get('win_rate', 0):.0%}"
        )
    except Exception as e:
        logger.error(f"Performance snapshot failed: {e}")


async def main():
    """Main bot loop — runs forever until stopped."""
    global _running

    # Setup
    setup_logging("INFO")
    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    # Validate config
    errors = config.validate()
    if errors:
        for err in errors:
            logger.error(f"Config error: {err}")
        logger.error("Fix configuration errors and restart.")
        sys.exit(1)

    # Load Bayesian state
    bayesian_tracker.load()

    # Initialize
    mode = "PAPER" if config.is_paper else "LIVE"
    logger.info("=" * 60)
    logger.info(f"  ArmedCapital TradingBot v0.1.0")
    logger.info(f"  Mode: {mode}")
    logger.info(f"  Bankroll: ${config.paper_bankroll:,.2f}")
    logger.info(f"  Kelly: {config.kelly_fraction:.0%} | "
                f"Max Position: {config.max_position_pct:.0%} | "
                f"EV Threshold: {config.ev_threshold:.0%}")
    logger.info("=" * 60)

    await telegram.alert_bot_started(mode)

    # Write initial heartbeat
    db.write_heartbeat("running")
    db.write_log("INFO", "system", f"Bot started in {mode} mode")

    # Initialize exchange connection
    try:
        await exchange_client.connect()
    except Exception as e:
        logger.warning(f"Exchange connection deferred: {e}")

    # Sync initial config to Supabase
    db.upsert_bot_config(
        {
            "trading_mode": config.trading_mode,
            "kelly_fraction": config.kelly_fraction,
            "max_position_pct": config.max_position_pct,
            "max_concurrent_positions": config.max_concurrent_positions,
            "daily_loss_limit_pct": config.daily_loss_limit_pct,
            "ev_threshold": config.ev_threshold,
        }
    )

    # Timing trackers
    last_crypto_scan = 0.0
    last_poly_scan = 0.0
    last_perf_snapshot = 0.0
    last_position_update = 0.0

    # ─── Main Loop ───────────────────────────────────────────────
    logger.info("Entering main loop...")

    while _running:
        now = asyncio.get_event_loop().time()

        try:
            # Always process commands (fast)
            await process_commands()

            # Write heartbeat every cycle
            db.write_heartbeat("paused" if _paused else "running")

            if not _paused:
                # Crypto scan
                if now - last_crypto_scan >= CRYPTO_SCAN_INTERVAL:
                    await scan_crypto()
                    last_crypto_scan = now

                # Polymarket scan
                if now - last_poly_scan >= POLYMARKET_SCAN_INTERVAL:
                    await scan_polymarket()
                    last_poly_scan = now

                # Performance snapshot
                if now - last_perf_snapshot >= PERFORMANCE_SNAPSHOT_INTERVAL:
                    await snapshot_performance()
                    last_perf_snapshot = now

        except Exception as e:
            logger.error(f"Main loop error: {e}", exc_info=True)
            await telegram.alert_error(str(e), context="Main loop")

        # Sleep before next cycle
        await asyncio.sleep(COMMAND_POLL_INTERVAL)

    # ─── Cleanup ─────────────────────────────────────────────────
    logger.info("Shutting down...")
    db.write_heartbeat("stopped")
    db.write_log("INFO", "system", "Bot stopped")
    bayesian_tracker.save()
    await exchange_client.close()
    await polymarket_client.close()
    await ai_estimator.close()
    await telegram.send_message("🛑 Bot stopped")
    logger.info("Goodbye.")


if __name__ == "__main__":
    asyncio.run(main())
