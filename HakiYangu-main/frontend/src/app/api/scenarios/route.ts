import { NextResponse } from 'next/server';
import { scenarios } from '@/lib/server/scenarios';

export function GET() {
  return NextResponse.json({ scenarios });
}
