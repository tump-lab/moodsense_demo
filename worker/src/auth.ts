import { ApiError, type Env } from './types';

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function decodeJson(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as Record<string, unknown>;
}

async function signingKey(kid: string): Promise<CryptoKey> {
  // Cloudflare caches the response per the certificate's own cache headers.
  const res = await fetch(JWKS_URL, { cf: { cacheEverything: true } } as RequestInit);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  const jwk = keys.find((k) => k.kid === kid);
  if (!jwk) throw new ApiError(401, 'auth', 'Unknown signing key');
  return crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

/** Verifies a Firebase Auth ID token and returns the uid. Throws ApiError(401) on any problem. */
export async function verifyFirebaseToken(request: Request, env: Env): Promise<string> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const parts = token.split('.');
  if (parts.length !== 3) throw new ApiError(401, 'auth', 'Sign in required.');
  try {
    const head = decodeJson(parts[0]!);
    const claims = decodeJson(parts[1]!);
    if (head.alg !== 'RS256' || typeof head.kid !== 'string') throw new Error('bad header');
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      await signingKey(head.kid),
      b64urlToBytes(parts[2]!),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    const now = Math.floor(Date.now() / 1000);
    if (
      !ok ||
      claims.aud !== env.FIREBASE_PROJECT_ID ||
      claims.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}` ||
      typeof claims.exp !== 'number' ||
      claims.exp < now ||
      typeof claims.sub !== 'string' ||
      claims.sub.length === 0
    ) {
      throw new Error('bad claims');
    }
    return claims.sub;
  } catch {
    throw new ApiError(401, 'auth', 'Sign in required.');
  }
}
