/**
 * POST /api/tradingbot/commands — Send a command to the bot
 *
 * Accepted commands: pause, resume, close_position, update_config, kill
 * The Python bot polls this table and executes pending commands.
 *
 * Requires Clerk authentication.
 * Data stored in Supabase `bot_commands` table.
 *
 * DROP INTO: src/app/api/tradingbot/commands/route.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const VALID_COMMANDS = ['pause', 'resume', 'close_position', 'update_config', 'kill'];

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { command, payload = {} } = body;

    if (!command || !VALID_COMMANDS.includes(command)) {
      return NextResponse.json(
        { error: `Invalid command. Must be one of: ${VALID_COMMANDS.join(', ')}` },
        { status: 400 }
      );
    }

    const supabase = createServerSupabase();

    const { data, error } = await supabase
      .from('bot_commands')
      .insert({
        user_id: userId,
        command,
        payload,
        status: 'pending',
      })
      .select('id')
      .single();

    if (error) {
      console.error('[tradingbot/commands] POST error:', error);
      return NextResponse.json({ error: 'Failed to send command' }, { status: 500 });
    }

    return NextResponse.json({ success: true, command_id: data?.id });
  } catch (err: any) {
    console.error('[POST /api/tradingbot/commands]', err);
    return NextResponse.json({ error: 'Failed to send command' }, { status: 500 });
  }
}
