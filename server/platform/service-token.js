import { timingSafeEqual } from 'node:crypto';
import { clientKey, createRateLimiter } from './rate-limit.js';

// Server-to-server calls (GitHub Actions posting a release note, Claude raising a DevBoard ticket) carry
// a bearer token instead of a session. A route opts in with `service: 'SOME_TOKEN'`, naming an
// environment variable. The caller is then this one fixed actor.
export const SERVICE_ACTOR = Object.freeze({
  id: '00000000-0000-4000-8000-0000000000a1',
  email: 'releases@energymatrix.local',
  displayName: 'Release notes',
  isPortalAdmin: false,
  role: null,
});

// Only *_TOKEN names qualify. Otherwise a route could turn SQL_PASSWORD into a credential.
export const SERVICE_TOKEN_NAME = /^[A-Z][A-Z0-9_]*_TOKEN$/;

export const TOKEN_LIMITS = {
  windowMs: 15 * 60 * 1000,
  tokenPerClient: 10,
  tokenTotal: 100,
};

export function createServiceTokens({ env = {}, limits = {} } = {}) {
  const settings = { ...TOKEN_LIMITS, ...limits };
  const make = (limit) => createRateLimiter({ limit, windowMs: settings.windowMs, now: settings.now });
  const perClient = make(settings.tokenPerClient);
  const total = make(settings.tokenTotal);

  // { user } when the token is right, { user: null } when there is none or it is wrong,
  // { retryAfter } when this caller has guessed too often. A blocked caller is refused even with the right
  // token, otherwise guessing could simply carry on.
  return function check(req, name) {
    const expected = env?.[name];
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header.trim()) : null;
    const presented = match?.[1] ?? '';
    if (!expected || !presented) return { user: null };
    const client = clientKey(req);
    const retryAfter = Math.max(perClient.retryAfter(client), total.retryAfter('all'));
    if (retryAfter) return { retryAfter };
    if (safeEqual(presented, String(expected))) return { user: SERVICE_ACTOR };
    perClient.fail(client);
    total.fail('all');
    return { user: null };
  };
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
