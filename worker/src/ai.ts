import { ApiError, type Env, type LlmErrorKind } from './types';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-haiku-4-5';
/** The model name comes from the client, so it is checked: an unchecked string would let any caller point our key at any model. */
const ALLOWED_MODELS = new Set(['claude-haiku-4-5', 'claude-haiku-5', 'claude-sonnet-5', 'claude-opus-5']);
const MAX_TOKENS_CAP = 2048;
const MAX_BODY_CHARS = 60_000;
const TIMEOUT_MS = 25_000;

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatBody {
  system?: string;
  turns: ChatTurn[];
  maxTokens?: number;
  anthropicModel?: string;
}

function parseRetryAfterMs(headerSeconds: string | null): number | undefined {
  const secs = headerSeconds ? Number.parseFloat(headerSeconds) : NaN;
  return Number.isFinite(secs) ? Math.round(secs * 1000) : undefined;
}

function validate(body: unknown): ChatBody {
  const b = body as Partial<ChatBody> | null;
  if (!b || !Array.isArray(b.turns) || b.turns.length === 0) {
    throw new ApiError(400, 'empty', 'Refusing to call a chat provider with no messages');
  }
  const turns = b.turns.map((t) => {
    if ((t?.role !== 'user' && t?.role !== 'assistant') || typeof t.content !== 'string') {
      throw new ApiError(400, 'http', 'Malformed turn');
    }
    return { role: t.role, content: t.content };
  });
  const size = turns.reduce((n, t) => n + t.content.length, 0) + (b.system?.length ?? 0);
  if (size > MAX_BODY_CHARS) throw new ApiError(413, 'http', 'Request too large');
  if (b.anthropicModel && !ALLOWED_MODELS.has(b.anthropicModel)) {
    throw new ApiError(400, 'http', `Unknown Anthropic model: ${b.anthropicModel}`);
  }
  return { system: typeof b.system === 'string' ? b.system : undefined, turns, maxTokens: b.maxTokens, anthropicModel: b.anthropicModel };
}

/** POST /ai: one Claude chat completion. Returns { text, provider }. */
export async function chat(rawBody: unknown, env: Env): Promise<{ text: string; provider: 'anthropic' }> {
  if (!env.ANTHROPIC_API_KEY) throw new ApiError(503, 'disabled', "No provider configured for 'chat'");
  const body = validate(rawBody);
  const maxTokens = Math.min(Math.max(1, Math.floor(body.maxTokens ?? 1024)), MAX_TOKENS_CAP);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: body.anthropicModel ?? DEFAULT_MODEL,
        max_tokens: maxTokens,
        system: body.system,
        messages: body.turns,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new ApiError(504, 'network', aborted ? 'anthropic request timed out' : 'Could not reach anthropic');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const snippet = (await res.text().catch(() => '')).slice(0, 300);
    let kind: LlmErrorKind = 'http';
    if (res.status === 429) kind = 'rate_limited';
    else if (res.status === 401 || res.status === 403) kind = 'auth';
    throw new ApiError(502, kind, `anthropic request failed (${res.status}): ${snippet}`, {
      status: res.status,
      retryAfterMs: parseRetryAfterMs(res.headers.get('retry-after')),
    });
  }

  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
    stop_details?: { category?: string | null } | null;
  };
  if (data.stop_reason === 'refusal') {
    const category = data.stop_details?.category;
    throw new ApiError(502, 'refusal', `Claude declined this request${category ? ` (${category})` : ''}`);
  }
  const text = (data.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim();
  if (!text) throw new ApiError(502, 'empty', 'Claude response contained no text content');
  return { text, provider: 'anthropic' };
}
