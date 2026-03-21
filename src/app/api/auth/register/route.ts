import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: 'Registration is handled through Clerk. Use the Sign Up button.' }, { status: 400 });
}
