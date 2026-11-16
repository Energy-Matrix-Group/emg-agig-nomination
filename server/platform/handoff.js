import { readForm, sendHtml } from './http.js';
import { createSessionValue, sessionCookieHeader } from './session-cookie.js';
import { TokenError, roleOf, verifyToken } from './token.js';

// The app's side of sign-in. The portal signs a person in once and hands each app a short-lived token
// in a form post. The app checks it and sets its own session cookie. See docs/ARCHITECTURE.md.

const MAX_RETURN_LENGTH = 2000;

// Where to go after sign-in. Only a path on this site: one leading slash, not two, and no backslash
// (a browser reads "/\host" as "//host"). Anything else becomes the fallback, so a crafted link cannot
// send a person to another site.
export function safeReturn(value, fallback = '/') {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_RETURN_LENGTH) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  if (value === '/auth' || value.startsWith('/auth/')) return fallback;
  return value;
}

export function handoffUrl(config, returnPath = '/') {
  const url = new URL(`${config.portalUrl}/handoff`);
  url.searchParams.set('app', config.appId);
  url.searchParams.set('return', safeReturn(returnPath));
  return url.toString();
}

export function logoutUrl(config) {
  return `${config.portalUrl}/logout`;
}

// The page a person was on when an API call said "sign in": the browser sends it as Referer.
// Used only when it is on this same host, and still checked by safeReturn.
export function returnFromReferer(req) {
  try {
    const referer = new URL(String(req.headers.referer ?? ''));
    if (referer.host !== req.headers.host) return '/';
    return safeReturn(`${referer.pathname}${referer.search}`);
  } catch {
    return '/';
  }
}

// POST /auth/callback. A good token sets the session cookie and sends the person on to `return`.
// A bad one shows a short page with a link to start again; the reason goes to the log, never to the page.
export function createCallbackHandler({ config, replay, now = Date.now }) {
  return async function callback({ req, res }) {
    const form = await readForm(req);
    const next = safeReturn(form.return);
    let claims;
    try {
      claims = verifyToken(form.token, { publicKey: config.portalPublicKey, appId: config.appId, now: now(), replay });
    } catch (error) {
      if (!(error instanceof TokenError)) throw error;
      console.warn(`Sign-in refused (${error.code}): ${error.message}`);
      // The cookie is left alone: a double click sends the form twice, and the second post is a replay.
      sendHtml(res, 400, failurePage(handoffUrl(config, next)));
      return;
    }
    const value = createSessionValue(
      { id: claims.sub, email: claims.email, displayName: claims.name, isPortalAdmin: claims.portalAdmin, role: roleOf(claims.role) },
      { secret: config.sessionSecret, minutes: config.sessionMinutes, now: now() },
    );
    // 303 turns the form post into a plain page load of `return`.
    res.writeHead(303, {
      Location: next,
      'Set-Cookie': sessionCookieHeader(config.appId, value, { secure: config.cookieSecure, minutes: config.sessionMinutes }),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    res.end();
  };
}

function failurePage(retryUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in failed</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem;">
<h1>We could not sign you in</h1>
<p>The sign-in link was not accepted. It may have expired or already been used.</p>
<p><a href="${escapeHtml(retryUrl)}">Try signing in again</a></p>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
