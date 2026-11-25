import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request, signIn, withPlatformServer } from './support/server.js';

// The bell's routes in an app (server/platform/notifications.js, template 1.8.0): each asks the portal for the person signed in,
// with the directory token, and answers with what the portal said. The portal is faked here; the portal's own tests check
// what it decides.

const TOKEN = 'directory-token-for-tests';
const FEED = { unread: 1, tip: null, items: [{ id: 'notice:1', scope: 'everyone', kind: 'news', app: null, title: 'T', body: 'B', link: null, at: '2026-11-25T00:00:00.000Z', unread: true }], canWrite: false };

// A portal that writes down every call and answers with `answer(call)`: { status, body }.
function fakePortal(answer) {
  const calls = [];
  const portalFetch = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined, redirect: init.redirect };
    calls.push(call);
    const { status = 200, body = {}, text } = answer(call);
    return new Response(text ?? JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, portalFetch };
}

const withBell = (answer, run, env = { PORTAL_DIRECTORY_TOKEN: TOKEN }) => {
  const portal = fakePortal(answer);
  return withPlatformServer(async (context) => run({ ...context, calls: portal.calls }), { env, portalFetch: portal.portalFetch });
};

test('the list is the portal\'s, for the person signed in here, asked with the directory token, with where the portal is', async () => {
  await withBell(() => ({ body: FEED }), async ({ base, portal, calls }) => {
    const ann = portal.createUser({ email: 'ann@energymatrix.com.au', displayName: 'Ann' });
    const cookie = await signIn(base, portal, ann);
    const answer = await request(base, '/api/notifications', { cookie });
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.data, { ...FEED, portalUrl: 'http://localhost:4000' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `http://localhost:4000/api/directory/users/${ann.id}/notifications`);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(calls[0].redirect, 'error', 'a redirect is never followed');
  });
});

test('marking read and putting a tip away go to the portal for the same person, with what was sent', async () => {
  await withBell((call) => ({ body: call.url.endsWith('/read') ? { unread: 0 } : { dismissed: true, unread: 0, tip: null } }), async ({ base, portal, calls }) => {
    const ann = portal.createUser({ email: 'ann@energymatrix.com.au', displayName: 'Ann' });
    const cookie = await signIn(base, portal, ann);
    assert.deepEqual((await request(base, '/api/notifications/read', { method: 'POST', cookie, body: { ids: ['notice:1'] } })).data, { unread: 0 });
    assert.deepEqual(calls[0].body, { ids: ['notice:1'] });
    assert.equal(calls[0].url, `http://localhost:4000/api/directory/users/${ann.id}/notifications/read`);
    const away = await request(base, '/api/notifications/tips/abc/dismiss', { method: 'POST', cookie });
    assert.deepEqual(away.data, { dismissed: true, unread: 0, tip: null });
    assert.equal(calls[1].url, `http://localhost:4000/api/directory/users/${ann.id}/notifications/tips/abc/dismiss`);
  });
});

test('nobody signed in gets nothing, and the portal is not asked', async () => {
  await withBell(() => ({ body: FEED }), async ({ base, calls }) => {
    assert.equal((await request(base, '/api/notifications')).status, 401);
    assert.equal((await request(base, '/api/notifications/read', { method: 'POST', body: { all: true } })).status, 401);
    assert.equal(calls.length, 0);
  });
});

test('the portal\'s refusals for the person pass on; anything else, a starting database included, is a fixed 502', async () => {
  const answers = [
    [{ status: 404, body: { error: 'That tip was not found' } }, 404, 'That tip was not found'],
    [{ status: 400, body: { error: 'Say which to mark as read' } }, 400, 'Say which to mark as read'],
    [{ status: 503, body: { error: 'The database is starting' } }, 502, 'Notifications cannot be reached right now.'],
    [{ status: 401, body: { error: 'Sign in required' } }, 502, 'Notifications cannot be reached right now.'],
    [{ status: 200, text: 'not json' }, 502, 'Notifications cannot be reached right now.'],
  ];
  for (const [given, status, error] of answers) {
    await withBell(() => given, async ({ base, portal }) => {
      const cookie = await signIn(base, portal, portal.createUser({ email: 'ann@energymatrix.com.au', displayName: 'Ann' }));
      const answer = await request(base, '/api/notifications', { cookie });
      assert.equal(answer.status, status, JSON.stringify(given));
      assert.deepEqual(answer.data, { error });
      assert.equal(answer.headers.get('x-database-state'), null, 'the app\'s wait screen never covers its page for the bell');
    });
  }
});

test('an app with no directory token says the bell is not set up, and asks nobody', async () => {
  await withBell(() => ({ body: FEED }), async ({ base, portal, calls }) => {
    const cookie = await signIn(base, portal, portal.createUser({ email: 'ann@energymatrix.com.au', displayName: 'Ann' }));
    const answer = await request(base, '/api/notifications', { cookie });
    assert.equal(answer.status, 503);
    assert.match(answer.data.error, /PORTAL_DIRECTORY_TOKEN/);
    assert.equal(calls.length, 0);
  }, {});
});

test('a portal that cannot be reached is a 502', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const cookie = await signIn(base, portal, portal.createUser({ email: 'ann@energymatrix.com.au', displayName: 'Ann' }));
    const answer = await request(base, '/api/notifications', { cookie });
    assert.deepEqual([answer.status, answer.data], [502, { error: 'Notifications cannot be reached right now.' }]);
  }, { env: { PORTAL_DIRECTORY_TOKEN: TOKEN }, portalFetch: async () => { throw new TypeError('fetch failed'); } });
});

test('/api/notifications belongs to the platform: an app cannot take it', async () => {
  const { createAppServer } = await import('../../server/platform/create-server.js');
  const { createFixtureApp } = await import('./support/fixture-app.js');
  const { createFakePortal } = await import('./support/fake-portal.js');
  const portal = createFakePortal({ appId: 'echo' });
  const app = createFixtureApp();
  const clash = { ...app, catalog: { ...app.catalog, apiPrefix: '/api/notifications' }, routes: [] };
  assert.throws(() => createAppServer({ app: clash, env: portal.env(), directory: portal.directory }), /belongs to the platform/);
});
