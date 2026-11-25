import { httpError, readJson, sendJson } from './http.js';

// The bell's routes in an app (from template 1.8.0). The bell (web/platform/bell.js) calls them on the app's own server, as
// every page calls its own API; each one asks the portal for the person signed in here, server to server with
// PORTAL_DIRECTORY_TOKEN, and answers with what the portal said. The portal decides everything: who a notice is for, what is
// unread, and what may be marked. Nothing is kept here.
//   GET  /api/notifications                      the person's list: { unread, tip, items, canWrite, portalUrl }
//   POST /api/notifications/read                 { ids } or { all: true }: { unread }
//   POST /api/notifications/tips/:id/dismiss     puts the tip away: { dismissed, unread, tip }
// portalUrl is added, so the bell can send a link to a page of the portal (/apps/) to the portal. A portal that cannot be
// reached, or answers with anything but an answer for this person, is a 502 with fixed words: the bell then stays hidden.
// The portal's own 503 for a database that is starting is not passed on, so the app's wait screen never covers its page
// for the bell.

const TIMEOUT_MS = 8_000;
const UNREACHABLE = 'Notifications cannot be reached right now.';

export function createNotificationRoutes({ config, fetch: fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS }) {
  async function ask(user, path, { method = 'GET', body } = {}) {
    if (!config.portalUrl || !config.directoryToken) throw httpError(503, 'Notifications are not set up. Set PORTAL_URL and PORTAL_DIRECTORY_TOKEN.');
    let response;
    try {
      response = await fetchImpl(`${config.portalUrl}/api/directory/users/${encodeURIComponent(user.id)}/notifications${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.directoryToken}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw httpError(502, UNREACHABLE);
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      throw httpError(502, UNREACHABLE);
    }
    // The portal's own refusals for this person (a tip that is not theirs, nothing to mark) are passed on in its words.
    if ((response.status === 400 || response.status === 404) && typeof data?.error === 'string') throw httpError(response.status, data.error);
    if (!response.ok || !data || typeof data !== 'object') throw httpError(502, UNREACHABLE);
    return data;
  }

  return [
    {
      method: 'GET',
      path: '/api/notifications',
      auth: true,
      handler: async ({ res, user }) => sendJson(res, 200, { ...(await ask(user, '')), portalUrl: config.portalUrl }),
    },
    {
      method: 'POST',
      path: '/api/notifications/read',
      auth: true,
      handler: async ({ req, res, user }) => sendJson(res, 200, await ask(user, '/read', { method: 'POST', body: await readJson(req) })),
    },
    {
      method: 'POST',
      path: '/api/notifications/tips/:id/dismiss',
      auth: true,
      handler: async ({ res, user, params }) => sendJson(res, 200, await ask(user, `/tips/${encodeURIComponent(params.id)}/dismiss`, { method: 'POST' })),
    },
  ];
}
