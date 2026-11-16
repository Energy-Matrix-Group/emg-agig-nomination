import { httpError, readJson, sendJson } from '../../../server/platform/kit.js';

// A small app for the platform tests, so they do not depend on whatever server/app/ holds in this repo.
// Pass `routes` to add more, `setup` or `ui` to change those, and `assistant` to give Joules something to do.
export function createFixtureApp({ id = 'echo', routes = [], setup, ui, assistant } = {}) {
  const prefix = `/api/${id}`;
  const base = [
    {
      method: 'GET',
      path: `${prefix}/whoami`,
      auth: true,
      handler: async ({ res, user, app, directory }) => {
        app.calls += 1;
        const everyone = await directory.listUsers();
        sendJson(res, 200, {
          greeting: app.greeting,
          calls: app.calls,
          user,
          hasStore: app.store !== undefined,
          directorySize: everyone.length,
          directoryHasHashes: everyone.some((person) => 'passwordHash' in person),
        });
      },
    },
    { method: 'GET', path: `${prefix}/boom`, auth: true, handler: async () => { throw new Error('secret internal detail'); } },
    { method: 'GET', path: `${prefix}/teapot`, auth: true, handler: async () => { throw httpError(418, 'Short and stout'); } },
    {
      method: 'GET',
      path: `${prefix}/exit-code`,
      auth: true,
      handler: async () => {
        const error = new Error('Command failed');
        error.status = 1;
        throw error;
      },
    },
    { method: 'POST', path: `${prefix}/service`, auth: true, service: 'ECHO_TOKEN', handler: async ({ res, user }) => sendJson(res, 200, { id: user.id, displayName: user.displayName }) },
    { method: 'GET', path: `${prefix}/open`, auth: false, public: true, handler: async ({ res }) => sendJson(res, 200, { open: true }) },
    { method: 'POST', path: `${prefix}/echo`, auth: true, handler: async ({ req, res }) => sendJson(res, 200, { body: await readJson(req) }) },
    { method: 'GET', path: `${prefix}/items/:id`, auth: true, handler: async ({ res, params }) => sendJson(res, 200, { id: params.id }) },
    { method: 'GET', path: `${prefix}/read`, auth: true, handler: async ({ res, app }) => sendJson(res, 200, { value: await app.store.read() }) },
  ];

  return {
    catalog: { id, name: 'Echo', description: 'Fixture app for platform tests.', apiPrefix: prefix, statusLabel: null, message: 'Echo' },
    routes: [...base, ...routes],
    setup: setup ?? (async ({ env }) => ({ greeting: env.ECHO_GREETING ?? 'hello', calls: 0, store: { read: async () => 'stored' } })),
    ...(ui ? { ui } : {}),
    ...(assistant ? { assistant } : {}),
  };
}
