import { NextRequest, NextResponse } from 'next/server';

async function getPublicToken(): Promise<string> {
  const token = process.env.PUBLIC_API_TOKEN;
  if (!token) throw new Error('PUBLIC_API_TOKEN not configured');
  return token;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const raw = (searchParams.get('symbol') || '').trim().toUpperCase();
  const type = (searchParams.get('type') || 'EQUITY').toUpperCase();
  if (!raw) return NextResponse.json({ error: 'symbol required' }, { status: 400 });

  try {
    const token = await getPublicToken();
    const accountId = process.env.PUBLIC_ACCOUNT_ID || '';
    const tryTypes = type === 'CRYPTO' ? ['CRYPTO', 'EQUITY', 'INDEX'] : type === 'INDEX' ? ['INDEX', 'EQUITY', 'CRYPTO'] : ['EQUITY', 'CRYPTO', 'INDEX'];

    let quoteData: any = null;
    let resolvedType = type;

    for (const t of tryTypes) {
      const qRes = await fetch(`https://api.public.com/userapigateway/marketdata/${accountId}/quotes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruments: [{ symbol: raw, type: t }] }),
      });
      if (!qRes.ok) continue;
      const qData = await qRes.json();
      const q = (qData.quotes || [])[0];
      if (q && (q.last != null || q.bid != null || q.ask != null)) {
        quoteData = q;
        resolvedType = t;
        break;
      }
    }

    if (!quoteData) return NextResponse.json({ error: `No quote found for ${raw}` }, { status: 404 });

    const price = quoteData.last != null ? parseFloat(quoteData.last) : null;
    const bid = quoteData.bid != null ? parseFloat(quoteData.bid) : null;
    const ask = quoteData.ask != null ? parseFloat(quoteData.ask) : null;
    const spread = bid != null && ask != null ? ask - bid : null;

    return NextResponse.json({
      symbol: raw,
      name: quoteData.instrument?.description || raw,
      type: resolvedType,
      price, bid, ask, spread,
      change: quoteData.change != null ? parseFloat(quoteData.change) : null,
      changePct: quoteData.changePercent != null ? parseFloat(quoteData.changePercent) : null,
    });
  } catch (error) {
    console.error('[API] Markets lookup error:', error);
    return NextResponse.json({ error: 'Failed to lookup symbol' }, { status: 500 });
  }
}
