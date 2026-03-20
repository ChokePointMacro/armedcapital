import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getAllPlatformTokens } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const accounts = await getAllPlatformTokens(userId);

    const formattedAccounts = accounts.map((account: any) => ({
      id: account.id,
      platform: account.platform,
      handle: account.handle || null,
      personUrn: account.person_urn || null,
      connectedAt: account.updated_at,
    }));

    return NextResponse.json(formattedAccounts);
  } catch (error) {
    console.error('[API] Error in GET /api/social/accounts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch social accounts' },
      { status: 500 }
    );
  }
}
