import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: 'Authentication is handled through Clerk. Use the Sign In button.' }, { status: 400 });
}
