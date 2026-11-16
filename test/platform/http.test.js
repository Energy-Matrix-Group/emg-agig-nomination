import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFixtureApp } from './support/fixture-app.js';
import { request, signIn, withPlatformServer } from './support/server.js';

const person = { email: 'sam@energymatrix.com.au', displayName: 'Sam' };

async function quietly(run) {
  const { error } = console;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = error;
  }
}

test('health is public, and status says the database is connected unless setup says otherwise', async () => {
  await withPlatformServer(async ({ base }) => {
    const health = await request(base, '/health');
    assert.equal(health.status, 200);
    assert.deepEqual(health.data, { ok: true });
    assert.deepEqual((await request(base, '/api/status')).data, { databaseConnected: true });
  });
  await withPlatformServer(async ({ base }) => {
    assert.deepEqual((await request(base, '/api/status')).data, { databaseConnected: false });
  }, { app: createFixtureApp({ setup: async () => ({ databaseConnected: false }) }) });
});

test('setup runs once, with the env and the directory, and its result is `app` in every handler', async () => {
  await withPlatformServer(async ({ base, portal, app }) => {
    const sam = portal.createUser(person);
    portal.createUser({ email: 'jo@energymatrix.com.au', displayName: 'Jo' });
    const cookie = await signIn(base, portal, sam);
    const first = await request(base, '/api/echo/whoami', { cookie });
    assert.equal(first.status, 200);
    assert.equal(first.data.greeting, 'bonjour');
    assert.equal(first.data.user.email, sam.email);
    assert.deepEqual(Object.keys(first.data.user).sort(), ['displayName', 'email', 'id', 'isPortalAdmin', 'role']);
    assert.equal(first.data.directorySize, 2);
    assert.equal(first.data.directoryHasHashes, false);
    const second = await request(base, '/api/echo/whoami', { cookie });
    assert.equal(second.data.calls, 2);
    assert.equal(app.calls, 2);
  }, { env: { ECHO_GREETING: 'bonjour' } });
});

test('errors keep their message only when they carry a status from 400 to 599', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const cookie = await signIn(base, portal, portal.createUser(person));
    await quietly(async () => {
      const boom = await request(base, '/api/echo/boom', { cookie });
      assert.equal(boom.status, 500);
      assert.deepEqual(boom.data, { error: 'Something went wrong. Please try again.' });
      const exitCode = await request(base, '/api/echo/exit-code', { cookie });
      assert.equal(exitCode.status, 500, 'a status of 1 is an exit code, not an HTTP status');
      assert.deepEqual(exitCode.data, { error: 'Something went wrong. Please try again.' });
    });
    const teapot = await request(base, '/api/echo/teapot', { cookie });
    assert.equal(teapot.status, 418);
    assert.deepEqual(teapot.data, { error: 'Short and stout' });
  });
});

test('a 500 is logged with its detail, and the detail never reaches the person', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const cookie = await signIn(base, portal, portal.createUser(person));
    const logged = [];
    const { error } = console;
    console.error = (...args) => logged.push(args);
    try {
      const boom = await request(base, '/api/echo/boom', { cookie });
      assert.equal(boom.text.includes('secret internal detail'), false);
    } finally {
      console.error = error;
    }
    assert.equal(logged.length, 1);
    assert.match(String(logged[0][0]), /secret internal detail/);
  });
});

test('request bodies must be JSON by media type and within the size limit', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const cookie = await signIn(base, portal, portal.createUser(person));
    const post = (headers, body) => fetch(`${base}/api/echo/echo`, { method: 'POST', headers: { cookie, ...headers }, body });
    const disguised = await post({ 'Content-Type': 'text/plain; application/json' }, JSON.stringify({ a: 1 }));
    assert.equal(disguised.status, 415);
    assert.equal((await post({ 'Content-Type': 'Application/JSON; charset=utf-8' }, JSON.stringify({ a: 1 }))).status, 200);
    const tooLarge = await post({ 'Content-Type': 'application/json' }, JSON.stringify({ text: 'x'.repeat(200_000) }));
    assert.equal(tooLarge.status, 413);
    assert.deepEqual(await tooLarge.json(), { error: 'Payload too large' });
    assert.equal((await post({ 'Content-Type': 'application/json' }, '{broken')).status, 400);
    assert.equal((await post({ 'Content-Type': 'application/json' }, '[1,2]')).status, 400);
    assert.deepEqual((await post({ 'Content-Type': 'application/json' }, '')).status, 200, 'an empty body is an empty object');
  });
});

test('a malformed escape in a path parameter is not found, not a server error', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const cookie = await signIn(base, portal, portal.createUser(person));
    assert.equal((await request(base, '/api/echo/items/%E0%A4%A', { cookie })).status, 404);
    assert.equal((await request(base, '/api/echo/items/ok', { cookie })).data.id, 'ok');
    assert.equal((await request(base, '/api/apps/%E0%A4%A', { cookie })).status, 404);
  });
});

test('unknown API routes are JSON 404s, and routes need the right method', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const cookie = await signIn(base, portal, portal.createUser(person));
    for (const path of ['/api/nope', '/api/echo/nope', '/api', '/auth/nope']) {
      const missing = await request(base, path, { cookie });
      assert.equal(missing.status, 404, path);
      assert.deepEqual(missing.data, { error: 'Not found' }, path);
    }
    assert.equal((await request(base, '/api/echo/open', { method: 'POST' })).status, 404, 'a route answers only its own method');
  });
});

test('a route with auth: false is open, and one with auth: true is not', async () => {
  await withPlatformServer(async ({ base }) => {
    assert.deepEqual((await request(base, '/api/echo/open')).data, { open: true });
    assert.equal((await request(base, '/api/echo/whoami')).status, 401);
  });
});

test('a malformed request target is refused without stopping the server', async () => {
  await withPlatformServer(async ({ base, server }) => {
    const net = await import('node:net');
    const reply = await new Promise((resolve, reject) => {
      const socket = net.connect(server.address().port, '127.0.0.1', () => socket.write('GET // HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
      const chunks = [];
      socket.on('data', (chunk) => chunks.push(chunk));
      socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      socket.on('error', reject);
    });
    assert.match(reply, /^HTTP\/1\.1 400/);
    assert.equal((await request(base, '/health')).status, 200);
  });
});

test('JSON answers are never cached, are not sniffed, and are compressed when large and asked for', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const cookie = await signIn(base, portal, portal.createUser(person));
    const small = await request(base, '/health');
    assert.equal(small.headers.get('cache-control'), 'no-store');
    assert.equal(small.headers.get('x-content-type-options'), 'nosniff');
    assert.match(small.headers.get('content-type'), /application\/json/);
    const echoed = await fetch(`${base}/api/echo/echo`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip' },
      body: JSON.stringify({ text: 'x'.repeat(5000) }),
    });
    assert.equal(echoed.headers.get('content-encoding'), 'gzip');
    assert.equal((await echoed.json()).body.text.length, 5000);
  });
});
