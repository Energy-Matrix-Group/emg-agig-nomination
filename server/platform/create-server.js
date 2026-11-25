import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAssistantRoutes } from './assistant.js';
import { readConfig } from './config.js';
import { databaseWakeSettings, retryWhileStarting } from './database-wake.js';
import { createDirectoryClient } from './directory-client.js';
import { answerError, createDispatcher } from './dispatch.js';
import { handoffUrl, returnFromReferer } from './handoff.js';
import { sendJson } from './http.js';
import { createNotificationRoutes } from './notifications.js';
import { createPlatformRoutes } from './platform-routes.js';
import { createReplayGuard } from './replay-guard.js';
import { checkApp, checkRoutes } from './router.js';
import { createServiceTokens } from './service-token.js';
import { readSessionUser } from './session-cookie.js';
import { createStaticHandler } from './static.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const UI_DEFAULTS = { root: 'web', spa: false, publicPaths: [] };

// Builds the one server an app runs: its API, the sign-in callback, /health and its UI.
//
// `app` is the module in server/app/index.js:
//   catalog   { id, name, description, apiPrefix }
//   routes    [{ method, path, handler, auth, service?, public? }]
//   setup     optional async ({ sql, env, directory }) => the object handlers get as `app`
//   ui        optional { root: 'web', spa: false, publicPaths: [] }
//   assistant optional { about, actions }: what Joules, the portal's helper, can do here for a person (assistant-schema.js)
//
// Returns an http.Server that is not listening yet, with:
//   server.ready        resolves when setup() has finished (it waits for a database that is starting)
//   server.appContext() what setup() returned
//   server.config       the settings it is using
// portalFetch is how the bell's routes reach the portal (notifications.js); tests pass a fake.
export function createAppServer({
  app,
  env = process.env,
  config = readConfig(env),
  directory,
  rateLimits,
  databaseRetry,
  portalFetch,
  now = Date.now,
  root = repoRoot,
}) {
  checkApp(app, config.appId);
  const ui = { ...UI_DEFAULTS, ...app.ui };
  const uiRoot = path.resolve(root, ui.root);
  if (path.relative(root, uiRoot).startsWith('..')) throw new Error('ui.root must stay inside the repository');

  const replay = createReplayGuard({ now });
  const platformRoutes = [
    ...createPlatformRoutes({ config, catalog: app.catalog, replay, now }),
    ...createAssistantRoutes({ config, catalog: app.catalog, assistant: app.assistant, replay, now, limits: rateLimits }),
    ...createNotificationRoutes({ config, fetch: portalFetch }),
  ];
  checkRoutes([app], platformRoutes);

  const wake = databaseWakeSettings(env);
  const lookup = directory ?? createDirectoryClient({ portalUrl: config.portalUrl, token: config.directoryToken });

  // setup() runs once. A setup that throws because its database is starting is tried again for a while.
  // The apps that ship do not throw over their database: they fall back to memory (see docs/ARCHITECTURE.md).
  const context = retryWhileStarting(
    async () => (app.setup ? await app.setup({ sql: null, env, directory: lookup }) : {}) ?? {},
    { label: `The ${app.catalog.id} database`, ...databaseRetry },
  );
  context.catch(() => {});

  const readUser = (req) => readSessionUser(req, { appId: config.appId, secret: config.sessionSecret, now: now() });
  const dispatch = createDispatcher({
    routes: [...platformRoutes, ...app.routes],
    authenticate: async (req) => readUser(req),
    // An API call is answered with JSON, not a redirect: the shared client navigates the page to `signIn`.
    unauthorised: (req, res) => sendJson(res, 401, { error: 'Sign in required', signIn: handoffUrl(config, returnFromReferer(req)) }),
    serviceTokens: createServiceTokens({ env, limits: rateLimits }),
    directory: lookup,
    appContext: () => context,
  });

  // A page request without a session goes to the portal, which brings the person back to the same path.
  const publicPaths = ui.publicPaths;
  const signInRedirect = (req, url) => {
    if (publicPaths.some((prefix) => url.pathname.startsWith(prefix))) return null;
    if (readUser(req)) return null;
    return handoffUrl(config, `${url.pathname}${url.search}`);
  };
  const serveUi = createStaticHandler({
    uiRoot,
    platformRoot: path.resolve(root, 'web', 'platform'),
    spa: ui.spa === true,
    signInRedirect,
    assistant: true, // Joules, the portal's helper, in the corner of every page (web/platform/assistant.js)
    // The bell (web/platform/bell.js) only where its routes can ask the portal: without PORTAL_URL and PORTAL_DIRECTORY_TOKEN
    // every page's request for it would be an error, so the app has no bell (1.8.2). The log already says the token is missing.
    bell: Boolean(config.portalUrl && config.directoryToken),
  });

  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }
    try {
      if (await dispatch(req, res, url)) return;
      if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      await serveUi(req, res, url);
    } catch (error) {
      answerError(res, error, wake);
    }
  });
  server.ready = context.then(() => server);
  server.appContext = () => context;
  server.config = config;
  return server;
}
