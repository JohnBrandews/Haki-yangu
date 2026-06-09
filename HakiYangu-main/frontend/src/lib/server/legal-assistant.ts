import { NextRequest, NextResponse } from 'next/server';

export type AssistantLanguage = 'en' | 'sw';
export type AssistantRole = 'user' | 'assistant';
export type LetterType = 'demand' | 'complaint';

export interface AssistantMessage {
  role: AssistantRole;
  content: string;
}

export interface ChatRequestBody {
  message: string;
  history?: AssistantMessage[];
  language: AssistantLanguage;
  sessionId: string;
}

export interface LetterRequestBody {
  situation: string;
  chatHistory?: AssistantMessage[];
  language: AssistantLanguage;
  letterType: LetterType;
}

export interface RateLimitState {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter: number;
  timestamps: number[];
}

export interface ValidationSuccess<T> {
  ok: true;
  data: T;
}

export interface ValidationFailure {
  ok: false;
  message: string;
}

const RATE_LIMIT_COOKIE = 'hakiyangu_rl';
const RATE_LIMIT_LIMIT = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_MODEL = 'claude-sonnet-4-5';

export const CHAT_SYSTEM_PROMPT = `You are HakiYangu, a legal rights assistant specializing in Kenyan law. You help everyday Kenyans understand their legal rights in plain, accessible language.

CORE PRINCIPLES:
- Always cite the specific Kenyan law (Act name + section if possible)
- Give practical, actionable next steps
- Be empathetic because users are often stressed or scared
- Tell them clearly when they need a lawyer versus when they can handle it themselves
- Never give advice that could harm their legal position
- Always add a disclaimer that this is information, not legal advice

RESPONSE STRUCTURE:
1. Your Rights - What the law says about their situation
2. What You Can Do - 3 to 5 concrete next steps, numbered
3. Important Warnings - What not to do
4. Do You Need a Lawyer? - Honest assessment
5. Relevant Laws - List the specific Kenyan acts that apply

KEY KENYAN LAWS TO REFERENCE:
- Employment Act 2007
- Landlord and Tenant (Shops, Hotels and Catering Establishments) Act Cap 301
- Rent Restriction Act Cap 296
- Consumer Protection Act 2012
- Traffic Act Cap 403
- Penal Code Cap 63
- Constitution of Kenya 2010
- Business Registration Service Act 2015
- Micro and Small Enterprises Act 2012
- Children Act 2022
- National Land Commission Act

Respond in the same language the user writes in. If they write in Swahili, respond fully in Swahili using correct legal Swahili terminology. If English, respond in English. If mixed, prefer Swahili.

If the situation is clearly outside Kenyan law or too complex, say so honestly and recommend consulting the Kenya Law website (kenyalaw.org) or a registered advocate.

On the very last line output exactly: SUGGEST_LETTER:true if the situation involves a clear dispute where a formal letter would help, otherwise SUGGEST_LETTER:false. Also output AREA:<detected legal area> on the second to last line (for example AREA:Employment, AREA:Landlord/Tenant, AREA:Consumer Protection, AREA:Traffic, AREA:Family Law, AREA:Business, AREA:General).`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseTimestamps(value: string | undefined): number[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((timestamp) => Number(timestamp))
      .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
  } catch {
    return [];
  }
}

function validateMessageList(value: unknown): ValidationFailure | ValidationSuccess<AssistantMessage[]> {
  if (value === undefined) {
    return { ok: true, data: [] };
  }

  if (!Array.isArray(value)) {
    return { ok: false, message: 'history must be an array of messages.' };
  }

  const messages: AssistantMessage[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) {
      return { ok: false, message: 'Each message must be an object.' };
    }

    const role = entry.role;
    const content = entry.content;

    if (role !== 'user' && role !== 'assistant') {
      return { ok: false, message: 'Message role must be user or assistant.' };
    }

    if (!isNonEmptyString(content)) {
      return { ok: false, message: 'Message content must be a non-empty string.' };
    }

    messages.push({
      role,
      content: content.trim(),
    });
  }

  return { ok: true, data: messages };
}

export function validateChatBody(value: unknown): ValidationFailure | ValidationSuccess<ChatRequestBody> {
  if (!isRecord(value)) {
    return { ok: false, message: 'Request body must be an object.' };
  }

  if (!isNonEmptyString(value.message)) {
    return { ok: false, message: 'message is required.' };
  }

  if (value.language !== 'en' && value.language !== 'sw') {
    return { ok: false, message: 'language must be en or sw.' };
  }

  if (!isNonEmptyString(value.sessionId)) {
    return { ok: false, message: 'sessionId is required.' };
  }

  const historyValidation = validateMessageList(value.history);
  if (!historyValidation.ok) {
    return historyValidation;
  }

  return {
    ok: true,
    data: {
      message: value.message.trim(),
      history: historyValidation.data,
      language: value.language,
      sessionId: value.sessionId.trim(),
    },
  };
}

export function validateLetterBody(value: unknown): ValidationFailure | ValidationSuccess<LetterRequestBody> {
  if (!isRecord(value)) {
    return { ok: false, message: 'Request body must be an object.' };
  }

  if (!isNonEmptyString(value.situation)) {
    return { ok: false, message: 'situation is required.' };
  }

  if (value.language !== 'en' && value.language !== 'sw') {
    return { ok: false, message: 'language must be en or sw.' };
  }

  if (value.letterType !== 'demand' && value.letterType !== 'complaint') {
    return { ok: false, message: 'letterType must be demand or complaint.' };
  }

  const historyValidation = validateMessageList(value.chatHistory);
  if (!historyValidation.ok) {
    return historyValidation;
  }

  return {
    ok: true,
    data: {
      situation: value.situation.trim(),
      chatHistory: historyValidation.data,
      language: value.language,
      letterType: value.letterType,
    },
  };
}

export function evaluateRateLimit(request: NextRequest): RateLimitState {
  const now = Date.now();
  const timestamps = parseTimestamps(request.cookies.get(RATE_LIMIT_COOKIE)?.value).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );

  const allowed = timestamps.length < RATE_LIMIT_LIMIT;
  const nextTimestamps = allowed ? [...timestamps, now] : timestamps;
  const oldestTimestamp = nextTimestamps[0] ?? now;
  const reset = oldestTimestamp + RATE_LIMIT_WINDOW_MS;
  const retryAfter = allowed ? 0 : Math.max(1, Math.ceil((reset - now) / 1000));

  return {
    allowed,
    limit: RATE_LIMIT_LIMIT,
    remaining: Math.max(0, RATE_LIMIT_LIMIT - nextTimestamps.length),
    reset,
    retryAfter,
    timestamps: nextTimestamps,
  };
}

export function applyRateLimitMetadata(response: NextResponse, state: RateLimitState): NextResponse {
  response.headers.set('x-ratelimit-limit', String(state.limit));
  response.headers.set('x-ratelimit-remaining', String(state.remaining));
  response.headers.set('x-ratelimit-reset', String(Math.ceil(state.reset / 1000)));

  if (!state.allowed) {
    response.headers.set('Retry-After', String(state.retryAfter));
  }

  response.cookies.set(RATE_LIMIT_COOKIE, JSON.stringify(state.timestamps), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24,
  });

  return response;
}

function extractTextContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.content)) {
    return '';
  }

  for (const block of payload.content) {
    if (isRecord(block) && typeof block.text === 'string' && block.text.trim()) {
      return block.text;
    }
  }

  return '';
}

function extractAnthropicError(payload: unknown, status: number): string {
  if (isRecord(payload)) {
    if (isRecord(payload.error) && typeof payload.error.message === 'string' && payload.error.message.trim()) {
      return payload.error.message.trim();
    }

    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message.trim();
    }
  }

  return `Anthropic request failed with status ${status}.`;
}

async function createClaudeMessage(params: {
  system?: string;
  messages: AssistantMessage[];
  maxTokens: number;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY.');
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: params.maxTokens,
      ...(params.system ? { system: params.system } : {}),
      messages: params.messages,
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(extractAnthropicError(payload, response.status));
  }

  const text = extractTextContent(payload);
  if (!text) {
    throw new Error('Claude returned an empty response.');
  }

  return text;
}

function parseChatReply(rawReply: string): {
  reply: string;
  detectedArea: string;
  suggestLetter: boolean;
} {
  const lines = rawReply.split(/\r?\n/);
  let detectedArea = 'General';
  let suggestLetter = false;
  const filteredLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('SUGGEST_LETTER:')) {
      suggestLetter = line.toLowerCase().includes('true');
      continue;
    }

    if (line.startsWith('AREA:')) {
      detectedArea = line.replace('AREA:', '').trim() || 'General';
      continue;
    }

    filteredLines.push(line);
  }

  return {
    reply: filteredLines.join('\n').trimEnd(),
    detectedArea,
    suggestLetter,
  };
}

function buildLetterPrompt(dto: LetterRequestBody): string {
  const languageInstruction =
    dto.language === 'sw'
      ? 'Write the entire letter in Swahili using formal legal Swahili.'
      : 'Write the entire letter in formal English.';

  const typeInstruction =
    dto.letterType === 'demand'
      ? 'Write a formal demand letter citing the relevant Kenyan law.'
      : 'Write a formal complaint letter to the relevant authority under Kenyan law.';

  return `Based on this situation: ${dto.situation}

${typeInstruction} ${languageInstruction}

Format the letter properly with:
- Date placeholder: [DATE]
- Sender details placeholder: [YOUR NAME], [YOUR ADDRESS], [YOUR CONTACT]
- Recipient details placeholder: [RECIPIENT NAME/TITLE], [RECIPIENT ADDRESS]
- Reference to the Constitution of Kenya 2010 (relevant Articles) and specific Kenyan Acts of Parliament
- Clear statement of the grievance
- Specific demand or complaint
- Deadline for response (14 days)
- Signature block

On the very last line output exactly: SUBJECT:<brief subject line>`;
}

function parseLetterReply(rawReply: string): { letter: string; subject: string } {
  const lines = rawReply.split(/\r?\n/);
  const subjectLine = lines.find((line) => line.startsWith('SUBJECT:'));
  const subject = subjectLine ? subjectLine.replace('SUBJECT:', '').trim() : 'Formal Letter';
  const letter = lines.filter((line) => !line.startsWith('SUBJECT:')).join('\n').trimEnd();

  return { letter, subject };
}

export async function generateChatResponse(dto: ChatRequestBody): Promise<{
  reply: string;
  detectedArea: string;
  suggestLetter: boolean;
}> {
  const messages: AssistantMessage[] = [
    ...(dto.history ?? []),
    { role: 'user', content: dto.message },
  ];

  const rawReply = await createClaudeMessage({
    system: CHAT_SYSTEM_PROMPT,
    messages,
    maxTokens: 2048,
  });

  return parseChatReply(rawReply);
}

export async function generateLetterResponse(dto: LetterRequestBody): Promise<{
  letter: string;
  subject: string;
}> {
  const rawReply = await createClaudeMessage({
    messages: [
      {
        role: 'user',
        content: buildLetterPrompt(dto),
      },
    ],
    maxTokens: 1500,
  });

  return parseLetterReply(rawReply);
}
