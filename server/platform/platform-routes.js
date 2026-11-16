import { createCallbackHandler, logoutUrl } from './handoff.js';
import { httpError, sendJson } from './http.js';
import { clearSessionCookieHeader } from './session-cookie.js';

// The routes every app has, so every UI can call them. They are not listed in an app's docs/API.md.
//   GET  /health            { ok: true }, no sign-in. Render checks it.
//   GET  /api/status        { databaseConnected }, no sign-in.
//   GET  /api/me            { user, portalUrl, appId } from the app session. appId (1.5.0) tells Joules's frame which app it is in.
//   GET  /api/apps/:id      this app's own catalogue entry.
//   POST /api/logout        clears this app's cookie and returns { logoutUrl }, the portal's sign-out.
//   POST /auth/callback     the sign-in handoff from the portal.
export function createPlatformRoutes({ config, catalog, replay, now }) {
  const callback = createCallbackHandler({ config, replay, now });

  return [
    { method: 'GET', path: '/health', handler: ({ res }) => sendJson(res, 200, { ok: true }) },

    // False when the app's own database is not the one in use (it fell back to memory).
    { method: 'GET', path: '/api/status', handler: ({ res, app }) => sendJson(res, 200, { databaseConnected: app?.databaseConnected !== false }) },

    { method: 'GET', path: '/api/me', auth: true, handler: ({ res, user }) => sendJson(res, 200, { user, portalUrl: config.portalUrl, appId: config.appId }) },

    {
      method: 'GET',
      path: '/api/apps/:id',
      auth: true,
      handler: ({ res, params }) => {
        if (params.id !== catalog.id) throw httpError(404, 'Application not found');
        sendJson(res, 200, {
          app: {
            id: catalog.id,
            name: catalog.name,
            description: catalog.description,
            statusLabel: catalog.statusLabel ?? null,
            message: catalog.message ?? catalog.description,
            href: '/',
          },
        });
      },
    },

    // Anyone may ask: clearing a cookie that is not there does no harm. Other apps keep their own
    // sessions until they run out; the portal ends its own when the person arrives at logoutUrl.
    {
      method: 'POST',
      path: '/api/logout',
      handler: ({ res }) => sendJson(res, 200, { logoutUrl: logoutUrl(config) }, {
        'Set-Cookie': clearSessionCookieHeader(config.appId, { secure: config.cookieSecure }),
      }),
    },

    { method: 'POST', path: '/auth/callback', handler: callback },
    { method: 'GET', path: '/auth/callback', handler: ({ res }) => sendJson(res, 405, { error: 'Use POST' }, { Allow: 'POST' }) },
  ];
}
