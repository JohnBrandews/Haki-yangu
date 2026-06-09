import { NextRequest, NextResponse } from 'next/server';
import {
  applyRateLimitMetadata,
  evaluateRateLimit,
  generateLetterResponse,
  validateLetterBody,
} from '@/lib/server/legal-assistant';

export const runtime = 'nodejs';

function jsonWithRateLimit(
  state: ReturnType<typeof evaluateRateLimit>,
  body: unknown,
  status: number,
): NextResponse {
  return applyRateLimitMetadata(NextResponse.json(body, { status }), state);
}

export async function POST(request: NextRequest) {
  const rateLimit = evaluateRateLimit(request);

  if (!rateLimit.allowed) {
    return jsonWithRateLimit(
      rateLimit,
      { message: 'Pole! You have reached your message limit. Please wait a minute before trying again.' },
      429,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonWithRateLimit(rateLimit, { message: 'Invalid JSON body.' }, 400);
  }

  const validation = validateLetterBody(body);
  if (!validation.ok) {
    return jsonWithRateLimit(rateLimit, { message: validation.message }, 400);
  }

  try {
    const response = await generateLetterResponse(validation.data);
    return jsonWithRateLimit(rateLimit, response, 200);
  } catch (error) {
    console.error('Letter route failed:', error);
    return jsonWithRateLimit(
      rateLimit,
      { message: error instanceof Error ? error.message : 'Letter request failed.' },
      500,
    );
  }
}
