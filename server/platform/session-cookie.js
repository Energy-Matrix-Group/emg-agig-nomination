import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseCookies } from './http.js';
import { roleOf } from './token.js';

// The app's own session. One cookie per app, because cookies on localhost are shared across ports
// and *.onrender.com apps cannot share one. The value holds the user and an absolute expiry:
//   <payload as base64url JSON>.<HMAC-SHA256 of the payload, keyed with APP_SESSION_SECRET>
// It is not sliding. When it runs out, the app sends the person back to the portal, which returns
// them at once if their portal session is still good. That is how a deactivated person loses access
// within APP_SESSION_MINUTES.

const VERSION = 1;

export function sessionCookieName(appId) {
  return `emg_${appId}_session`;
}

export function createSessionValue(user, { secret, minutes, now = Date.now() }) {
  const payload = Buffer.from(JSON.stringify({
    v: VERSION,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isPortalAdmin: user.isPortalAdmin === true,
      role: roleOf(user.role),
    },
    exp: now + minutes * 60_000,
  })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

// The user, or null for anything that is not a good, unexpired session value.
export function readSessionValue(value, { secret, now = Date.now() }) {
  if (typeof value !== 'string') return null;
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!safeEqual(signature, sign(payload, secret))) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (data?.v !== VERSION || !Number.isFinite(data.exp) || data.exp <= now) return null;
  const user = data.user;
  if (typeof user?.id !== 'string' || typeof user.email !== 'string' || typeof user.displayName !== 'string') return null;
  // A cookie made before template 1.4.0 has no role: it reads as none until the person signs in again.
  return { id: user.id, email: user.email, displayName: user.displayName, isPortalAdmin: user.isPortalAdmin === true, role: roleOf(user.role) };
}

export function readSessionUser(req, { appId, secret, now = Date.now() }) {
  return readSessionValue(parseCookies(req)[sessionCookieName(appId)], { secret, now });
}

export function sessionCookieHeader(appId, value, { secure = false, minutes }) {
  const parts = [
    `${sessionCookieName(appId)}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(minutes * 60)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookieHeader(appId, { secure = false } = {}) {
  const parts = [
    `${sessionCookieName(appId)}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
