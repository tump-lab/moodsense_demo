/** Typed failures for hosted-model calls and our Worker. Kept apart from aiGateway.ts so services/api.ts can use it without a cycle. */

export type AiProvider = 'anthropic' | 'openaiCompat';

export type LlmErrorKind =
  | 'rate_limited'
  | 'auth'
  | 'http'
  | 'network'
  | 'empty'
  | 'refusal'
  | 'disabled';

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly provider?: AiProvider;

  constructor(
    kind: LlmErrorKind,
    message: string,
    opts: { status?: number; retryAfterMs?: number; provider?: AiProvider } = {}
  ) {
    super(message);
    // Keeps `instanceof LlmError` working when a class transform breaks the prototype link.
    Object.setPrototypeOf(this, LlmError.prototype);
    this.name = 'LlmError';
    this.kind = kind;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
    this.provider = opts.provider;
  }
}
