import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(req: NextRequest) {
  const { filePath, content } = await req.json();
  const fullPath = path.join(process.cwd(), filePath);
  fs.writeFileSync(fullPath, content, 'utf8');
  return NextResponse.json({ ok: true, wrote: fullPath });
}
