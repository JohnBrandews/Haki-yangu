import { ChatResponse, Language, LetterResponse, Message, Scenario } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

export interface RateLimitInfo {
  limit?: string;
  remaining?: string;
  reset?: string;
}

export interface RateLimitError extends Error {
  ratelimit?: RateLimitInfo;
}

export async function sendMessage(params: {
  message: string;
  history: Message[];
  language: Language;
  sessionId: string;
}): Promise<ChatResponse & { ratelimit?: RateLimitInfo }> {
  const res = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: params.message,
      history: params.history.map((m) => ({ role: m.role, content: m.content })),
      language: params.language,
      sessionId: params.sessionId,
    }),
  });

  const ratelimit: RateLimitInfo = {
    limit: res.headers.get('x-ratelimit-limit') || undefined,
    remaining: res.headers.get('x-ratelimit-remaining') || undefined,
    reset: res.headers.get('x-ratelimit-reset') || undefined,
  };

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) {
      const err = new Error(data.message || 'Too many requests. Please wait a minute.') as RateLimitError;
      err.ratelimit = ratelimit;
      throw err;
    }
    throw new Error(data.message || `Chat request failed: ${res.status}`);
  }

  const data = await res.json();
  return { ...data, ratelimit };
}

export async function generateLetter(params: {
  situation: string;
  chatHistory: Message[];
  language: Language;
  letterType: 'demand' | 'complaint';
}): Promise<LetterResponse> {
  const res = await fetch(`${API_URL}/letter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      situation: params.situation,
      chatHistory: params.chatHistory.map((m) => ({ role: m.role, content: m.content })),
      language: params.language,
      letterType: params.letterType,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) {
      throw new Error(data.message || 'Too many requests. Please wait a minute.');
    }
    throw new Error(data.message || `Letter request failed: ${res.status}`);
  }
  return res.json();
}

export async function getScenarios(): Promise<{ scenarios: Scenario[] }> {
  const res = await fetch(`${API_URL}/scenarios`);
  if (!res.ok) throw new Error(`Scenarios request failed: ${res.status}`);
  return res.json();
}
