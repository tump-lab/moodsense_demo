export interface Env {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_STORAGE_BUCKET: string;
  ANTHROPIC_API_KEY: string;
  FIREBASE_SERVICE_ACCOUNT: string;
}

export type LlmErrorKind = 'rate_limited' | 'auth' | 'http' | 'network' | 'empty' | 'refusal' | 'disabled';

/** Thrown inside the Worker and turned into the JSON error body aiGateway.ts reads on the client. */
export class ApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly kind: LlmErrorKind,
    message: string,
    readonly extra: { status?: number; retryAfterMs?: number } = {}
  ) {
    super(message);
  }
}
