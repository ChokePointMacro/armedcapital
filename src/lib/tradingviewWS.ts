/**
 * TradingView WebSocket Client — Real-time quote data
 *
 * Connects to TradingView's internal WebSocket (the same one their frontend uses)
 * to stream real-time market data without the 10-minute free-tier delay.
 *
 * Requires TV_SESSION_ID env var — extracted from your logged-in TradingView
 * browser session cookie ("sessionid" cookie from tradingview.com).
 *
 * Protocol: TradingView uses a custom frame format over WebSocket:
 *   ~m~<length>~m~<json_payload>
 */

import WebSocket from 'ws';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TVQuote {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  prevClose: number | null;
  bid: number | null;
  ask: number | null;
  timestamp: number | null;
  updatedAt: string;
}

export interface TVTechnicalRating {
  symbol: string;
  rating: number | null;       // -1 to 1 (strong sell to strong buy)
  ratingLabel: string;         // "Strong Buy", "Buy", "Neutral", "Sell", "Strong Sell"
  ratingMA: number | null;     // Moving average rating
  ratingOsc: number | null;    // Oscillator rating
}

// ── WebSocket Protocol ───────────────────────────────────────────────────────

const WS_URL = 'wss://data.tradingview.com/socket.io/websocket';
const WS_ORIGIN = 'https://www.tradingview.com';

/** Encode a message in TradingView's frame format */
function tvEncode(msg: string): string {
  return `~m~${msg.length}~m~${msg}`;
}

/** Decode TradingView frame(s) from a raw WebSocket message */
function tvDecode(raw: string): string[] {
  const messages: string[] = [];
  let i = 0;
  while (i < raw.length) {
    const start = raw.indexOf('~m~', i);
    if (start === -1) break;
    const lenStart = start + 3;
    const lenEnd = raw.indexOf('~m~', lenStart);
    if (lenEnd === -1) break;
    const len = parseInt(raw.substring(lenStart, lenEnd));
    if (isNaN(len)) break;
    const msgStart = lenEnd + 3;
    const msg = raw.substring(msgStart, msgStart + len);
    messages.push(msg);
    i = msgStart + len;
  }
  return messages;
}

/** Generate a session ID string */
function genSession(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 14)}`;
}

// ── Runtime Session Store ────────────────────────────────────────────────────
// Allows updating TV_SESSION_ID at runtime without redeploying

let runtimeSessionId: string | null = null;
let sessionValid = true;
let sessionLastChecked = 0;

/** Get the active session ID (runtime override > env var) */
export function getSessionId(): string | null {
  return runtimeSessionId || process.env.TV_SESSION_ID || null;
}

/** Update session ID at runtime (e.g. from re-auth endpoint) */
export function setSessionId(newId: string): void {
  runtimeSessionId = newId;
  sessionValid = true;
  sessionLastChecked = Date.now();
  // Force reconnect with new session
  disconnect();
}

/** Mark current session as invalid (auth failure detected) */
export function markSessionInvalid(): void {
  sessionValid = false;
  sessionLastChecked = Date.now();
}

/** Check if the current session is believed to be valid */
export function isSessionValid(): boolean {
  return sessionValid && !!getSessionId();
}

// ── Quote Cache ──────────────────────────────────────────────────────────────

const quoteCache = new Map<string, TVQuote>();
const QUOTE_CACHE_TTL = 60_000; // 1 minute
let wsConnection: WebSocket | null = null;
let wsReady = false;
let quoteSession = '';
let subscribedSymbols = new Set<string>();

// ── Field Mapping ────────────────────────────────────────────────────────────

const QUOTE_FIELDS = [
  'ch', 'chp', 'current_session', 'description',
  'exchange', 'high_price', 'is_tradable', 'low_price',
  'lp', 'lp_time', 'minmov', 'minmove2', 'open_price',
  'original_name', 'prev_close_price', 'pricescale',
  'pro_name', 'short_name', 'type', 'update_mode',
  'volume', 'ask', 'bid', 'fundamentals', 'logoid',
  'rch', 'rchp', 'rtc', 'rtc_time', 'status',
  'basic_eps_net_income', 'beta_1_year', 'earnings_per_share_basic_ttm',
  'industry', 'market_cap_basic', 'sector', 'typespecs',
];

// ── Connection Management ────────────────────────────────────────────────────

function sendMessage(ws: WebSocket, func: string, args: any[]): void {
  const msg = JSON.stringify({ m: func, p: args });
  ws.send(tvEncode(msg));
}

function handleQuoteData(data: any): void {
  if (!data?.n || !data?.v) return;

  const symbol = data.n;
  const v = data.v;
  const existing = quoteCache.get(symbol) || {
    symbol,
    price: null, change: null, changePercent: null,
    volume: null, high: null, low: null, open: null,
    prevClose: null, bid: null, ask: null,
    timestamp: null, updatedAt: new Date().toISOString(),
  };

  const updated: TVQuote = {
    symbol,
    price: v.lp ?? existing.price,
    change: v.ch ?? existing.change,
    changePercent: v.chp ?? existing.changePercent,
    volume: v.volume ?? existing.volume,
    high: v.high_price ?? existing.high,
    low: v.low_price ?? existing.low,
    open: v.open_price ?? existing.open,
    prevClose: v.prev_close_price ?? existing.prevClose,
    bid: v.bid ?? existing.bid,
    ask: v.ask ?? existing.ask,
    timestamp: v.lp_time ?? existing.timestamp,
    updatedAt: new Date().toISOString(),
  };

  quoteCache.set(symbol, updated);
}

function connectWebSocket(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (wsConnection && wsReady) {
      resolve();
      return;
    }

    const sessionId = getSessionId();
    const headers: Record<string, string> = {
      'Origin': WS_ORIGIN,
    };

    const ws = new WebSocket(WS_URL, { headers });
    quoteSession = genSession('qs');
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        reject(new Error('WebSocket connection timeout'));
      }
    }, 10000);

    ws.on('open', () => {
      // Authenticate if session ID available (Plus/Premium — no delay)
      if (sessionId) {
        sendMessage(ws, 'set_auth_token', [sessionId]);
      } else {
        sendMessage(ws, 'set_auth_token', ['unauthorized_user_token']);
      }

      // Create quote session
      sendMessage(ws, 'quote_create_session', [quoteSession]);
      sendMessage(ws, 'quote_set_fields', [quoteSession, ...QUOTE_FIELDS]);

      wsConnection = ws;
      wsReady = true;
      subscribedSymbols.clear();

      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve();
      }
    });

    ws.on('message', (raw: Buffer) => {
      const messages = tvDecode(raw.toString());
      for (const msg of messages) {
        // Heartbeat
        if (msg.startsWith('~h~')) {
          ws.send(tvEncode(msg));
          continue;
        }

        try {
          const parsed = JSON.parse(msg);
          // Detect auth failures
          if (parsed.m === 'critical_error' || parsed.m === 'protocol_error') {
            const errMsg = String(parsed.p?.[1] || parsed.p?.[0] || '');
            if (errMsg.includes('auth') || errMsg.includes('session') || errMsg.includes('unauthorized')) {
              console.warn('[TV WS] Auth failure detected — session may be expired');
              markSessionInvalid();
            }
          }
          if (parsed.m === 'qsd') {
            // Quote session data update — session is working
            if (!sessionValid) { sessionValid = true; sessionLastChecked = Date.now(); }
            handleQuoteData(parsed.p?.[1]);
          }
        } catch {
          // Not JSON — ignore
        }
      }
    });

    ws.on('close', () => {
      wsConnection = null;
      wsReady = false;
      subscribedSymbols.clear();
      console.log('[TV WS] Connection closed');
    });

    ws.on('error', (err) => {
      console.error('[TV WS] Error:', err.message);
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Subscribe to real-time quotes for given symbols.
 * Symbols should be in TradingView format: "BITSTAMP:BTCUSD", "NASDAQ:AAPL", etc.
 */
export async function subscribeQuotes(symbols: string[]): Promise<void> {
  await connectWebSocket();
  if (!wsConnection || !wsReady) return;

  for (const sym of symbols) {
    if (!subscribedSymbols.has(sym)) {
      sendMessage(wsConnection, 'quote_add_symbols', [quoteSession, sym]);
      subscribedSymbols.add(sym);
    }
  }
}

/**
 * Get cached quote for a symbol. Returns null if not yet received.
 */
export function getQuote(symbol: string): TVQuote | null {
  const quote = quoteCache.get(symbol);
  if (!quote) return null;
  // Check staleness
  const age = Date.now() - new Date(quote.updatedAt).getTime();
  if (age > 5 * 60_000) return null; // Stale after 5 min
  return quote;
}

/**
 * Get all cached quotes.
 */
export function getAllQuotes(): TVQuote[] {
  return Array.from(quoteCache.values());
}

/**
 * Fetch quotes for symbols — subscribes, waits for data, returns results.
 * This is the main entry point for one-shot quote fetching.
 */
export async function fetchQuotes(symbols: string[], waitMs = 3000): Promise<TVQuote[]> {
  // Check cache first
  const cached = symbols.map(s => quoteCache.get(s)).filter(Boolean) as TVQuote[];
  const allFresh = cached.length === symbols.length &&
    cached.every(q => Date.now() - new Date(q.updatedAt).getTime() < QUOTE_CACHE_TTL);
  if (allFresh) return cached;

  // Subscribe and wait for data
  await subscribeQuotes(symbols);

  // Wait for WebSocket to deliver data
  await new Promise(resolve => setTimeout(resolve, waitMs));

  return symbols
    .map(s => quoteCache.get(s))
    .filter(Boolean) as TVQuote[];
}

/**
 * Disconnect the WebSocket.
 */
export function disconnect(): void {
  if (wsConnection) {
    wsConnection.close();
    wsConnection = null;
    wsReady = false;
  }
}

/**
 * Check if authenticated (Plus/Premium session).
 */
export function isAuthenticated(): boolean {
  return !!getSessionId() && sessionValid;
}

/**
 * Get connection status.
 */
export function getConnectionStatus(): { connected: boolean; authenticated: boolean; sessionValid: boolean; hasSession: boolean; symbols: number; cached: number } {
  return {
    connected: wsReady,
    authenticated: isAuthenticated(),
    sessionValid,
    hasSession: !!getSessionId(),
    symbols: subscribedSymbols.size,
    cached: quoteCache.size,
  };
}

// ── Default symbols for Armed Capital ────────────────────────────────────────

export const DEFAULT_SYMBOLS = [
  'BITSTAMP:BTCUSD',
  'BITSTAMP:ETHUSD',
  'COINBASE:SOLUSD',
  'SP:SPX',
  'NASDAQ:QQQ',
  'TVC:DXY',
  'TVC:US10Y',
  'TVC:GOLD',
  'CBOE:VIX',
];
