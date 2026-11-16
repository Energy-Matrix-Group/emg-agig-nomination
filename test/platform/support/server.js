import { createAppServer } from '../../../server/platform/create-server.js';
import { createFixtureApp } from './fixture-app.js';
import { createFakePortal } from './fake-portal.js';

// Starts an app on a free port with a fake portal, runs `run`, then stops it.
// run receives { base, portal, server, app (what setup() returned), appModule }.
export async function withPlatformServer(run, { app = createFixtureApp(), env = {}, ...options } = {}) {
  const portal = createFakePortal({ appId: app.catalog.id });
  const server = createAppServer({ app, env: portal.env(env), directory: portal.directory, ...options });
  await server.ready;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ base, portal, server, app: await server.appContext(), appModule: app });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

// A JSON request that does not follow redirects. Returns { status, data, headers, text }.
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
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: response.status, data, headers: response.headers, text };
}

// What the portal's auto-submitting form does: post the token and the return path to /auth/callback.
export async function postCallback(base, { token, next, headers = {}, raw } = {}) {
  const response = await fetch(`${base}/auth/callback`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: raw ?? new URLSearchParams({ ...(token === undefined ? {} : { token }), ...(next === undefined ? {} : { return: next }) }).toString(),
  });
  const setCookie = response.headers.getSetCookie();
  return {
    status: response.status,
    location: response.headers.get('location'),
    setCookie,
    cookie: setCookie.map((entry) => entry.split(';')[0]).join('; '),
    headers: response.headers,
    text: await response.text(),
  };
}

// Signs a person in through the real handoff and returns their cookie.
export async function signIn(base, portal, user, options) {
  const result = await postCallback(base, { token: portal.token(user, options), next: '/' });
  if (result.status !== 303) throw new Error(`Sign-in failed with ${result.status}`);
  return result.cookie;
}
