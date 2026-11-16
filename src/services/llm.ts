/**
 * Chat completion with retry and canned offline replies; every real request goes through services/aiGateway.ts.
 * With no provider configured, or the kill switch on, replies are canned so callers still work offline.
 */
import {
  callModel,
  isAiLive,
  LlmError,
  setAiKillSwitch,
  isAiKillSwitchEnabled,
  type ChatTurn,
} from './aiGateway';

export { LlmError, type LlmErrorKind } from './aiGateway';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

const MOCK_REPLIES = [
  "Thanks for sharing that with me — it takes courage to put feelings into words. What you are feeling makes sense given what you are going through. Would a short breathing pause or a quick walk feel doable right now?",
  "I hear you, and I am glad you checked in. Feelings like this can be heavy, and you do not have to carry them perfectly. Maybe jot down one small thing that went okay today?",
  "That sounds like a lot to hold. Be gentle with yourself — you are doing more than you give yourself credit for. If it keeps weighing on you, talking with someone you trust or a professional can really help.",
  "It makes sense that this is sitting with you. You do not have to have it sorted out right now — noticing it, like you just did, is already the hard part.",
  "Thank you for telling me. Whatever today looked like, showing up and putting it into words counts for something. Is there one small thing that would make the next hour a little easier?",
];

let lastMockIndex = -1;

function nextMockReply(): string {
  let index = Math.floor(Math.random() * MOCK_REPLIES.length);
  if (index === lastMockIndex) index = (index + 1) % MOCK_REPLIES.length;
  lastMockIndex = index;
  const reply = MOCK_REPLIES[index]!;
  // The [mock] prefix is a developer signal: show it only when the kill switch forces mocks, not when a user simply has AI turned off.
  return isAiKillSwitchEnabled() ? `[mock] ${reply}` : reply;
}

export function setForceMock(enabled: boolean): void {
  setAiKillSwitch(enabled);
}

export function isForceMockEnabled(): boolean {
  return isAiKillSwitchEnabled();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SHORT_RETRY_CEILING_MS = 5_000;

const CHAT_MAX_TOKENS = 2048;

/** How long to wait before the one retry of a 5xx, which carries no retry-after of its own. */
const SERVER_ERROR_RETRY_DELAY_MS = 600;

/**
 * Retry delay for a failure that is worth one more attempt, or null to give up and rethrow.
 * Two kinds qualify, both observed against the providers in use:
 * - a rate limit that clears within SHORT_RETRY_CEILING_MS. Longer waits are thrown to the caller,
 *   which can tell the user how long to wait instead of showing a spinner. The free tiers meter
 *   per minute — Gemini allows five requests a minute and answers "retry in 5s" — so a couple of
 *   turns in quick succession trips a 429 that is gone a second later.
 * - a 5xx, which is the provider being briefly unavailable rather than anything about the request.
 * A timeout is deliberately not retried: the caller already waited out the full ceiling, and a
 * second attempt would double a wait the user is sitting through.
 */
function transientRetryDelayMs(err: unknown): number | null {
  if (!(err instanceof LlmError)) return null;
  if (err.kind === 'rate_limited') {
    return err.retryAfterMs != null && err.retryAfterMs <= SHORT_RETRY_CEILING_MS
      ? err.retryAfterMs
      : null;
  }
  if (err.kind === 'http' && err.status != null && err.status >= 500) {
    return SERVER_ERROR_RETRY_DELAY_MS;
  }
  return null;
}

/** At most one extra attempt; the original error is what reaches the caller if it fails again. */
async function withTransientRetry<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (err) {
    const retryIn = transientRetryDelayMs(err);
    if (retryIn == null) throw err;
    await delay(retryIn);
    return send();
  }
}

export async function chatComplete(messages: ChatMessage[]): Promise<string> {
  if (!isAiLive('chat')) {
    await delay(600);
    return nextMockReply();
  }

  const system = messages.find((m) => m.role === 'system')?.content;
  const history = messages.filter((m) => m.role !== 'system');

  return withTransientRetry(() => sendChat(system, history));
}

async function sendChat(
  system: string | undefined,
  history: ChatMessage[]
): Promise<string> {
  const { text } = await callModel({
    capability: 'chat',
    system,
    turns: toChatTurns(history),
    maxTokens: CHAT_MAX_TOKENS,
  });
  return text;
}

function toChatTurns(history: ChatMessage[]): ChatTurn[] {
  return history
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    }));
}
