import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { signClaims } from '../../server/platform/token.js';
import { loadPrivateKey } from '../../server/platform/keys.js';
import { createFakePortal, SESSION_SECRET } from './support/fake-portal.js';
import { createFixtureApp } from './support/fixture-app.js';
import { postCallback, request, signIn, withPlatformServer } from './support/server.js';

// A refused sign-in is logged on purpose, so the tests that refuse tokens keep that line out of the output.
let warn;
before(() => {
  warn = console.warn;
  console.warn = (line, ...rest) => { if (!String(line).startsWith('Sign-in refused')) warn(line, ...rest); };
});
after(() => {
  console.warn = warn;
});

const SPA = { root: 'test/platform/fixtures/ui/spaApp/dist', spa: true, publicPaths: ['/rate/'] };
const PORTAL = 'http://localhost:4000';
const person = { email: 'sam@energymatrix.com.au', displayName: 'Sam Lee', isPortalAdmin: false };

function spaApp() {
  return createFixtureApp({ ui: SPA });
}

async function page(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, { redirect: 'manual', headers: { Accept: 'text/html', ...options.headers } });
  return { status: response.status, location: response.headers.get('location'), text: await response.text(), headers: response.headers };
}

function handoff(returnPath) {
  return `${PORTAL}/handoff?app=echo&return=${encodeURIComponent(returnPath)}`;
}

test('a page request without a session goes to the portal, which sends the person back to the same path', async () => {
  await withPlatformServer(async ({ base }) => {
    const home = await page(base, '/');
    assert.equal(home.status, 302);
    assert.equal(home.location, handoff('/'));
    assert.equal(home.headers.get('cache-control'), 'no-store');

    const deep = await page(base, '/tickets/42?tab=open');
    assert.equal(deep.status, 302);
    assert.equal(deep.location, handoff('/tickets/42?tab=open'));
  }, { app: spaApp() });
});

test('scripts, styles and platform files open without a session, and so do the listed public pages', async () => {
  await withPlatformServer(async ({ base }) => {
    assert.equal((await page(base, '/assets/main-3f9a1c.js')).status, 200);
    assert.equal((await page(base, '/platform/api.js')).status, 200);
    assert.equal((await page(base, '/platform/tokens.css')).status, 200);
    assert.equal((await page(base, '/health')).status, 200);
    const rate = await page(base, '/rate/some-token');
    assert.equal(rate.status, 200);
    assert.match(rate.text, /SPA demo/);
    assert.equal((await page(base, '/ratebook')).status, 302, 'a public path is a prefix with its slash, not a word');
  }, { app: spaApp() });
});

test('an API call without a session is a JSON 401 with the handoff address, not a redirect', async () => {
  await withPlatformServer(async ({ base }) => {
    const bare = await request(base, '/api/me');
    assert.equal(bare.status, 401);
    assert.deepEqual(bare.data, { error: 'Sign in required', signIn: handoff('/') });

    // The page the person was on comes back as the return path, when it is on this same host.
    const host = new URL(base).host;
    const fromPage = await request(base, '/api/me', { headers: { Referer: `http://${host}/tickets/7?x=1`, Host: host } });
    assert.equal(fromPage.data.signIn, handoff('/tickets/7?x=1'));
    const elsewhere = await request(base, '/api/me', { headers: { Referer: 'https://evil.example/tickets/7' } });
    assert.equal(elsewhere.data.signIn, handoff('/'));
  });
});

test('a good token sets the app\'s own cookie and sends the person to the return path', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    const result = await postCallback(base, { token: portal.token(user), next: '/tickets/9?x=1' });
    assert.equal(result.status, 303);
    assert.equal(result.location, '/tickets/9?x=1');
    assert.equal(result.setCookie.length, 1);
    const [cookie, ...flags] = result.setCookie[0].split('; ');
    assert.match(cookie, /^emg_echo_session=/);
    assert.deepEqual(flags, ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=1800']);
    assert.doesNotMatch(result.setCookie[0], /Secure/);

    const me = await request(base, '/api/me', { cookie: result.cookie });
    assert.equal(me.status, 200);
    assert.deepEqual(me.data, {
      user: { id: user.id, email: user.email, displayName: 'Sam Lee', isPortalAdmin: false, role: null },
      portalUrl: PORTAL,
      appId: 'echo', // from 1.5.0: which app this is, for Joules's frame (web/platform/assistant.js)
    });
    // The page itself opens now.
    assert.equal((await page(base, '/tickets/9', { headers: { cookie: result.cookie } })).status, 200);
  }, { app: spaApp() });
});

test('the portal admin flag travels in the token and the cookie', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const admin = portal.createUser({ ...person, email: 'boss@energymatrix.com.au', isPortalAdmin: true });
    const cookie = await signIn(base, portal, admin);
    assert.equal((await request(base, '/api/me', { cookie })).data.user.isPortalAdmin, true);
  });
});

// Template 1.4.0: the company role the portal sets on its Users screen reaches the app, so the app can decide from it what someone
// sees there. Someone with no role, or a token from an older portal, is null.
test('the person\'s role travels in the token and the cookie, and is null when there is none', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const manager = portal.createUser({ ...person, email: 'paul@energymatrix.com.au', role: 'manager' });
    assert.equal((await request(base, '/api/me', { cookie: await signIn(base, portal, manager) })).data.user.role, 'manager');
    const nobody = portal.createUser({ ...person, email: 'new@energymatrix.com.au' });
    assert.equal((await request(base, '/api/me', { cookie: await signIn(base, portal, nobody) })).data.user.role, null);
    assert.equal((await portal.directory.findUserById(manager.id)).role, 'manager', 'and the directory says it too');
  });
});

test('the cookie is Secure when COOKIE_SECURE is true', async () => {
  const env = { COOKIE_SECURE: 'true', APP_URL: 'https://echo.example.test', PORTAL_URL: 'https://portal.example.test' };
  await withPlatformServer(async ({ base, portal }) => {
    const result = await postCallback(base, { token: portal.token(portal.createUser(person)), next: '/' });
    assert.match(result.setCookie[0], /; Secure$/);
  }, { env });
});

test('a tampered or foreign token is refused, and no cookie is set', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    const good = portal.token(user);
    const [body, signature] = good.split('.');

    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const forgedBody = Buffer.from(JSON.stringify({ ...claims, portalAdmin: true, email: 'boss@energymatrix.com.au' })).toString('base64url');
    const flipped = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
    const stranger = createFakePortal({ appId: 'echo' });
    const strangerToken = stranger.token(user);

    for (const [name, token] of Object.entries({
      'a changed claim': `${forgedBody}.${signature}`,
      'a changed signature': `${body}.${flipped}`,
      'a token signed by another key': strangerToken,
      'no signature': `${body}.`,
      'three parts': `${body}.${signature}.${signature}`,
      'not a token': 'hello',
      'a very long token': 'a'.repeat(5000),
    })) {
      const result = await postCallback(base, { token, next: '/' });
      assert.equal(result.status, 400, name);
      assert.deepEqual(result.setCookie, [], name);
      assert.match(result.text, /could not sign you in/i, name);
      assert.equal(result.text.includes(token.slice(0, 40)), false, `${name}: the token is never echoed`);
    }
    assert.equal((await request(base, '/api/me')).status, 401);
  });
});

test('a token for another app is refused', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    const result = await postCallback(base, { token: portal.token(user, { app: 'ticketing' }), next: '/' });
    assert.equal(result.status, 400);
    assert.deepEqual(result.setCookie, []);
  });
});

test('an expired token and one that is not valid yet are refused', async () => {
  let clock = Date.parse('2026-10-02T09:00:00Z');
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    const old = portal.token(user, { now: clock - 61_000 });
    assert.equal((await postCallback(base, { token: old, next: '/' })).status, 400, 'expired a second ago');
    const early = portal.token(user, { now: clock + 120_000 });
    assert.equal((await postCallback(base, { token: early, next: '/' })).status, 400, 'issued in the future');
    const fine = portal.token(user, { now: clock - 59_000 });
    assert.equal((await postCallback(base, { token: fine, next: '/' })).status, 303, 'still inside its minute');
  }, { now: () => clock });
});

test('a token that lives too long is refused even when signed by the portal', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    const iat = Math.floor(Date.now() / 1000);
    const token = signClaims(
      { sub: user.id, email: user.email, name: user.displayName, portalAdmin: false, aud: 'echo', iat, exp: iat + 3600, jti: 'long-lived' },
      loadPrivateKey(portal.keys.privateKey),
    );
    assert.equal((await postCallback(base, { token, next: '/' })).status, 400);
  });
});

test('a token works once: a replay is refused', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    const token = portal.token(user, { id: 'one-time-id' });
    const first = await postCallback(base, { token, next: '/' });
    assert.equal(first.status, 303);
    const second = await postCallback(base, { token, next: '/' });
    assert.equal(second.status, 400);
    // The refusal leaves the session the first post made alone, so a double click does no harm.
    assert.deepEqual(second.setCookie, []);
    assert.equal((await request(base, '/api/me', { cookie: first.cookie })).status, 200);
  });
});

test('a bad return path is ignored and the person lands on /', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    for (const next of [
      '//evil.example',
      '//evil.example/path',
      'https://evil.example/path',
      'http://evil.example',
      '/\\evil.example',
      '/path\\..\\evil',
      'javascript:alert(1)',
      'evil.example',
      '/line\r\nbreak',
      '/tab\there',
      '/auth/callback',
      '/auth',
      '',
      `/${'a'.repeat(3000)}`,
    ]) {
      const result = await postCallback(base, { token: portal.token(user), next });
      assert.equal(result.status, 303, JSON.stringify(next).slice(0, 40));
      assert.equal(result.location, '/', JSON.stringify(next).slice(0, 40));
    }
    // A missing return field behaves the same way.
    assert.equal((await postCallback(base, { token: portal.token(user) })).location, '/');
    // A good one is kept as it is, query included.
    assert.equal((await postCallback(base, { token: portal.token(user), next: '/a/b?c=d&e=f' })).location, '/a/b?c=d&e=f');
  });
});

test('the callback only takes a form post with a token', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    const token = portal.token(user);
    const json = await fetch(`${base}/auth/callback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    assert.equal(json.status, 415);
    assert.equal(json.headers.getSetCookie().length, 0);

    assert.equal((await postCallback(base, {})).status, 400, 'no token');
    assert.equal((await postCallback(base, { raw: `token=${'a'.repeat(30_000)}` })).status, 413);

    const get = await request(base, '/auth/callback');
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');
    // A token in the address is never accepted.
    assert.equal((await request(base, `/auth/callback?token=${encodeURIComponent(token)}`)).status, 405);
  });
});

test('the session is absolute, not sliding', async () => {
  let clock = Date.parse('2026-10-02T09:00:00Z');
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    const cookie = await signIn(base, portal, user, { now: clock });

    clock += 29 * 60_000;
    const late = await request(base, '/api/me', { cookie });
    assert.equal(late.status, 200);
    assert.equal(late.headers.get('set-cookie'), null, 'using the session does not extend it');

    clock += 2 * 60_000;
    const gone = await request(base, '/api/me', { cookie });
    assert.equal(gone.status, 401);
    assert.equal(gone.data.signIn, handoff('/'));
  }, { now: () => clock });
});

test('APP_SESSION_MINUTES sets how long a sign-in lasts', async () => {
  let clock = Date.parse('2026-10-02T09:00:00Z');
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    const result = await postCallback(base, { token: portal.token(user, { now: clock }), next: '/' });
    assert.match(result.setCookie[0], /Max-Age=300/);
    clock += 4 * 60_000;
    assert.equal((await request(base, '/api/me', { cookie: result.cookie })).status, 200);
    clock += 2 * 60_000;
    assert.equal((await request(base, '/api/me', { cookie: result.cookie })).status, 401);
  }, { now: () => clock, env: { APP_SESSION_MINUTES: '5' } });
});

test('a cookie from another app, a forged one and one signed with another secret are all refused', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    const cookie = await signIn(base, portal, user);
    const value = cookie.split('=').slice(1).join('=');

    assert.equal((await request(base, '/api/me', { cookie: `emg_ticketing_session=${value}` })).status, 401, 'a name for another app');
    assert.equal((await request(base, '/api/me', { cookie: 'emg_echo_session=garbage' })).status, 401);
    assert.equal((await request(base, '/api/me', { cookie: `emg_echo_session=${value.replace(/.$/, value.endsWith('A') ? 'B' : 'A')}` })).status, 401, 'a changed signature');
    const [payload] = value.split('.');
    assert.equal((await request(base, '/api/me', { cookie: `emg_echo_session=${payload}.` })).status, 401, 'no signature');
  });
  assert.notEqual(SESSION_SECRET, 'another-secret');
  await withPlatformServer(async ({ base, portal }) => {
    const cookie = await signIn(base, portal, portal.createUser(person));
    assert.equal((await request(base, '/api/me', { cookie })).status, 200);
  }, { env: { APP_SESSION_SECRET: 'another-secret-0123456789abcdef0123456789' } });
});

test('logout clears the cookie and says where the portal ends the rest', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const cookie = await signIn(base, portal, portal.createUser(person));
    const result = await request(base, '/api/logout', { method: 'POST', cookie });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { logoutUrl: `${PORTAL}/logout` });
    const header = result.headers.getSetCookie()[0];
    assert.match(header, /^emg_echo_session=;/);
    assert.match(header, /Max-Age=0/);
    assert.match(header, /HttpOnly/);
    // It works for anyone, signed in or not, so signing out can never fail.
    assert.equal((await request(base, '/api/logout', { method: 'POST' })).status, 200);
  });
});

test('/api/apps/:id is this app\'s own catalogue entry, and /api/status and /health need no session', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const cookie = await signIn(base, portal, portal.createUser(person));
    const entry = await request(base, '/api/apps/echo', { cookie });
    assert.equal(entry.status, 200);
    assert.deepEqual(entry.data, { app: { id: 'echo', name: 'Echo', description: 'Fixture app for platform tests.', statusLabel: null, message: 'Echo', href: '/' } });
    assert.equal((await request(base, '/api/apps/ticketing', { cookie })).status, 404);
    assert.equal((await request(base, '/api/apps/echo')).status, 401);

    assert.deepEqual((await request(base, '/health')).data, { ok: true });
    assert.deepEqual((await request(base, '/api/status')).data, { databaseConnected: true });
  });
});

test('an app whose catalogue id differs from APP_ID does not start', async () => {
  const { createAppServer } = await import('../../server/platform/create-server.js');
  const portal = createFakePortal({ appId: 'echo' });
  assert.throws(
    () => createAppServer({ app: createFixtureApp({ id: 'other' }), env: portal.env(), directory: portal.directory }),
    /APP_ID is "echo" but the app's catalogue id is "other"/,
  );
});
