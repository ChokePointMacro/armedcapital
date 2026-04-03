# Trading Patterns Skill

Domain knowledge for ArmedCapital's trading systems.

## TradingBot Architecture
- **Location**: `tradingbot/bot/`
- **Exchanges**: Polymarket (prediction markets), Coinbase (crypto)
- **AI**: Claude-only for trading decisions
- **Mode**: Paper-first — always implement paper mode before live

## Key Patterns

### Order Management
- Always implement idempotent order placement (use client order IDs)
- Track order state: pending → placed → filled/cancelled/expired
- Log every state transition with timestamp and context
- Implement circuit breakers: max loss per hour, max position size, max orders per minute

### Signal Processing
- TradingView signals arrive via webhook at `src/app/api/tradingview/`
- Parse with `src/lib/tradingviewSignals.ts`
- Validate signal format before acting
- Deduplicate signals (same alert can fire multiple times)
- Signal → agentBus → taskQueue → TradingBot decision pipeline

### Risk Management
- Position sizing: never risk more than X% per trade (configurable)
- Portfolio-level exposure limits
- Correlation-aware sizing (don't overload same sector)
- Drawdown limits: reduce size after consecutive losses
- Always have a stop-loss or maximum loss threshold

### Market Data
- Cache market data with appropriate TTL (`src/lib/cache.ts`)
- Handle stale data gracefully (show warning, don't trade on stale)
- Websocket for real-time, REST for historical
- Anomaly detection (`src/lib/anomalyDetector.ts`) for unusual moves

### Paper Trading
- Mirror all live trading logic exactly
- Track paper P&L separately
- Paper fills should simulate slippage and fees
- Paper mode is the DEFAULT — live requires explicit env var

## Anti-Patterns to Avoid
- Never hardcode trading parameters — use config/env vars
- Never ignore API errors during trading
- Never trade without position limits
- Never skip paper testing for new strategies
- Never log full API keys (redact in logs)
