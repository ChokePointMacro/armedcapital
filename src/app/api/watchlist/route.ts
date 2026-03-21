import { NextRequest, NextResponse } from 'next/server';
import { safeAuth } from '@/lib/authHelper';
import { getWatchlist, addToWatchlist, removeFromWatchlist } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const userId = await safeAuth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const watchlist = await getWatchlist(userId);
    return NextResponse.json(watchlist);
  } catch (error) {
    console.error('[API] Error in GET /api/watchlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch watchlist' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await safeAuth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const { symbol, name, type } = await request.json();

    if (!symbol) {
      return NextResponse.json(
        { error: 'symbol is required' },
        { status: 400 }
      );
    }

    await addToWatchlist({
      user_id: userId,
      symbol,
      name: name || undefined,
      type: type || undefined,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error in POST /api/watchlist:', error);
    return NextResponse.json(
      { error: 'Failed to add to watchlist' },
      { status: 500 }
    );
  }
}
