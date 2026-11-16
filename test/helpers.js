import * as app from '../server/app/index.js';
import { createAppServer } from '../server/platform/create-server.js';
import { createFakePortal } from './platform/support/fake-portal.js';
import { postCallback } from './platform/support/server.js';

// The same names the old host helpers had, so a test reads the same: withServer, login, request.
// The app is started with a fake portal, and login() signs in through the real handoff, so the real
// cookie code runs in every test. Passwords do not exist in an app: the portal checks them.
export const ADMIN_EMAIL = 'mat.harvey@energymatrix.com.au';
export const ADMIN_PASSWORD = 'admin-pass-1';
export const STAFF_EMAIL = 'staff@energymatrix.com.au';
export const STAFF_PASSWORD = 'staff-pass-1';

// Which fake portal belongs to which running server, so login(base, email) can find the one to sign with.
const portals = new Map();

// Runs `run` with a started app. It receives:
//   base        the server's address
//   portal      the fake portal: portal.createUser({ email, displayName, isPortalAdmin, apps }), portal.updateUser(...)
//   admin       a portal admin who can open this app
//   staff       an ordinary person who can open this app
//   appContext  () => what setup() returned
//   server      the http.Server
// options: env (more settings), now (a clock), app (a different app module), and anything createAppServer takes.
export async function withServer(run, { app: module = app, env = {}, ...options } = {}) {
  const portal = createFakePortal({ appId: module.catalog.id });
  const admin = portal.createUser({ email: ADMIN_EMAIL, displayName: 'Administrator', isPortalAdmin: true });
  const staff = portal.createUser({ email: STAFF_EMAIL, displayName: 'Staff' });
  const server = createAppServer({ app: module, env: portal.env(env), directory: portal.directory, ...options });
  await server.ready;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  portals.set(base, portal);
  try {
    await run({ base, portal, admin, staff, server, appContext: server.appContext });
  } finally {
    portals.delete(base);
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

// Signs in the person with this email, who must exist in the fake portal. The second argument is ignored:
// it is only here so tests written for the old password sign-in keep their shape.
export async function login(base, email) {
  const portal = portals.get(base);
  if (!portal) throw new Error('login() only works inside withServer()');
  const user = await portal.directory.findUserByEmail(email);
  if (!user) return { status: 401, data: { error: 'Unknown person' }, cookie: '', setCookie: [] };
  const callback = await postCallback(base, { token: portal.token(user), next: '/' });
  if (callback.status !== 303) return { status: callback.status, data: {}, cookie: '', setCookie: callback.setCookie };
  const me = await request(base, '/api/me', { cookie: callback.cookie });
  return { status: me.status, data: me.data, cookie: callback.cookie, setCookie: callback.setCookie };
}

export async function request(base, path, { method = 'GET', cookie, body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...headers,
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { status: response.status, data, headers: response.headers };
}
