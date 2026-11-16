/**
 * Every call to a hosted AI model goes through callModel() in this file; nothing else in src/ may call a provider or import a vendor's types.
 * The Claude key lives server-side as a secret on our Cloudflare Worker: callModel() sends each request to its /ai route
 * (worker/src/ai.ts), which makes the real HTTP call. Anything in EXPO_PUBLIC_* ships in the bundle.
 */
import { CONFIG } from '../config';
import { apiPost, hasApi } from './api';
import { LlmError, type AiProvider, type LlmErrorKind } from './llmError';

export { LlmError, type AiProvider, type LlmErrorKind };

export type AiCapability = 'chat';

let killed = !CONFIG.AI_ENABLED;

export function setAiKillSwitch(enabled: boolean): void {
  killed = enabled;
}

export function isAiKillSwitchEnabled(): boolean {
  return killed;
}

let userEnabled = false;

export function setAiUserEnabled(enabled: boolean): void {
  userEnabled = enabled;
}

export function isAiUserEnabled(): boolean {
  return userEnabled;
}

/**
 * Only the server knows whether the Claude key is set, so the client can only say whether there is a Worker to ask.
 * A deployment with no key fails on the first call with LlmError('disabled').
 */
function hasProxy(): boolean {
  return hasApi();
}

export function isAiLive(capability: AiCapability): boolean {
  return !killed && userEnabled && hasProxy();
}

/** True when chat requests have somewhere to go. */
export function hasChatProvider(): boolean {
  return hasProxy();
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 25_000;

async function callAiProxy<T>(payload: Record<string, unknown>, timeoutMs: number): Promise<T> {
  return apiPost<T>('/ai', payload, timeoutMs);
}

function assertLive(capability: AiCapability): void {
  if (killed) {
    throw new LlmError('disabled', 'AI calls are switched off (kill switch on)');
  }
  if (!userEnabled) {
    throw new LlmError('disabled', 'AI features are off for this account');
  }
  if (!hasProxy()) {
    throw new LlmError('disabled', `No provider configured for '${capability}'`);
  }
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  capability: 'chat';
  system?: string;
  turns: ChatTurn[];
  maxTokens?: number;
  timeoutMs?: number;
}

export interface TextResult {
  text: string;
  provider: AiProvider;
}

export async function callModel(req: ChatRequest): Promise<TextResult> {
  assertLive(req.capability);
  if (req.turns.length === 0) {
    throw new LlmError('empty', 'Refusing to call a chat provider with no messages');
  }
  return callAiProxy<TextResult>(
    {
      op: 'chat',
      system: req.system,
      turns: req.turns,
      maxTokens: req.maxTokens,
      anthropicModel: CONFIG.ANTHROPIC_MODEL,
    },
    req.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  );
}
