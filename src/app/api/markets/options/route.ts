import { NextRequest, NextResponse } from 'next/server';

let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getPublicToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  try {
    const res = await fetch('https://api.public.com/userapiauthservice/personal/access-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ validityInMinutes: 60, secret: process.env.PUBLIC_SECRET_KEY }),
    });
    if (!res.ok) throw new Error(`Public.com token exchange failed ${res.status}`);
    const data = await res.json() as any;
    cachedToken = data.accessToken;
    tokenExpiry = Date.now() + 55 * 60 * 1000;
    return cachedToken!;
  } catch (error) {
    console.error('Error getting Public token:', error);
    return '';
  }
}

function nextMonthlyExpiry(): string {
  const now = new Date();
  for (let mo = 0; mo <= 3; mo++) {
    const d = new Date(now.getFullYear(), now.getMonth() + mo, 1);
    let fri = 0;
    while (fri < 3) {
      if (d.getDay() === 5) fri++;
      if (fri < 3) d.setDate(d.getDate() + 1);
    }
    if (d.getTime() - now.getTime() > 7 * 864e5) {
      return d.toISOString().split('T')[0];
    }
  }
  return '';
}

const EQUITY_SYMS = ['MSTR', 'TSLA', 'MSFT', 'META', 'AAPL', 'AMZN', 'NVDA', 'AMD'];
let optionsCache: any = null;
let optionsCacheTime = 0;

export async function GET(request: NextRequest) {
  try {
    if (optionsCache && Date.now() - optionsCacheTime < 5 * 60 * 1000) {
      return NextResponse.json(optionsCache);
    }

    const token = await getPublicToken();
    const acctId = process.env.PUBLIC_ACCOUNT_ID!;
    const expiry = nextMonthlyExpiry();

    if (!token || !acctId || !expiry) {
      return NextResponse.json(
        { error: 'Public.com credentials not configured' },
        { status: 503 }
      );
    }

    const results = await Promise.all(
      EQUITY_SYMS.map(async sym => {
        try {
          const r = await fetch(
            `https://api.public.com/userapigateway/marketdata/${acctId}/option-chain`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                instrument: { symbol: sym, type: 'EQUITY' },
                expirationDate: expiry,
              }),
            }
          );
          if (!r.ok) return { symbol: sym, expiry, contracts: [] };
          const data = await r.json() as any;
          const calls = (data.calls || []).map((o: any) => ({ ...o, side: 'CALL' }));
          const puts = (data.puts || []).map((o: any) => ({ ...o, side: 'PUT' }));
          const top = [...calls, ...puts]
            .filter((o: any) => (o.volume || 0) > 0)
            .sort((a: any, b: any) => (b.volume || 0) - (a.volume || 0))
            .slice(0, 8)
            .map((o: any) => {
              const osiSym: string = o.instrument?.symbol || '';
              const strike = osiSym.length >= 8 ? parseInt(osiSym.slice(-8)) / 1000 : null;
              return {
                symbol: osiSym,
                side: o.side,
                strike,
                last: o.last != null ? parseFloat(o.last) : null,
                bid: o.bid != null ? parseFloat(o.bid) : null,
                ask: o.ask != null ? parseFloat(o.ask) : null,
                volume: o.volume || 0,
                openInterest: o.openInterest || 0,
              };
            });
          return { symbol: sym, expiry, contracts: top };
        } catch {
          return { symbol: sym, expiry, contracts: [] };
        }
      })
    );

    optionsCache = results;
    optionsCacheTime = Date.now();
    return NextResponse.json(results);
  } catch (err) {
    console.error('[Markets/Options] Error:', err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
