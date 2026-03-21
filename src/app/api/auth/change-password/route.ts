import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: 'Password management is handled through Clerk. Use the account settings to change your password.' }, { status: 400 });
}
