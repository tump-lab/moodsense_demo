import { aggregateCommunityMoods } from './aggregate';
import { chat } from './ai';
import { verifyFirebaseToken } from './auth';
import { ApiError, type Env } from './types';
import { withdrawAndDeleteRemoteData } from './withdraw';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const { pathname } = new URL(request.url);
    try {
      if (request.method !== 'POST') throw new ApiError(405, 'http', 'Method not allowed');
      if (pathname === '/ai') {
        await verifyFirebaseToken(request, env);
        return json(await chat(await request.json().catch(() => null), env));
      }
      if (pathname === '/delete') {
        const uid = await verifyFirebaseToken(request, env);
        await withdrawAndDeleteRemoteData(env, uid);
        return json({ deleted: true });
      }
      throw new ApiError(404, 'http', 'Not found');
    } catch (err) {
      if (err instanceof ApiError) {
        return json({ error: { kind: err.kind, message: err.message, ...err.extra } }, err.httpStatus);
      }
      console.error('Unhandled error', err);
      return json({ error: { kind: 'http', message: 'Internal error' } }, 500);
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      aggregateCommunityMoods(env).then(
        (msg) => console.log(msg),
        (err) => console.error('aggregateCommunityMoods failed', err)
      )
    );
  },
} satisfies ExportedHandler<Env>;
