/**
 * Calls to our Cloudflare Worker (worker/): the Claude proxy and remote-data deletion. Each request carries the
 * signed-in user's Firebase ID token, which the Worker verifies. Errors come back as { error: { kind, message, ... } }.
 */
import { CONFIG } from '../config';
import { getIdToken } from './firebase';
import { LlmError, type LlmErrorKind } from './llmError';

export function hasApi(): boolean {
  return CONFIG.USE_FIREBASE && CONFIG.API_URL.length > 0;
}

export async function apiPost<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  if (!hasApi()) throw new LlmError('disabled', 'The API address (EXPO_PUBLIC_API_URL) is not configured');
  const token = await getIdToken();
  if (!token) throw new LlmError('auth', 'Sign in required.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${CONFIG.API_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new LlmError('network', aborted ? `Request timed out after ${timeoutMs / 1000}s` : 'Could not reach the server');
  } finally {
    clearTimeout(timer);
  }

  const data = (await res.json().catch(() => null)) as
    | { error?: { kind?: LlmErrorKind; message?: string; status?: number; retryAfterMs?: number } }
    | null;
  if (!res.ok) {
    const e = data?.error;
    throw new LlmError(e?.kind ?? 'http', e?.message ?? `Request failed (${res.status})`, {
      status: e?.status ?? res.status,
      retryAfterMs: e?.retryAfterMs,
    });
  }
  return data as T;
}
