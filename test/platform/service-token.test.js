import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SERVICE_ACTOR } from '../../server/platform/service-token.js';
import { request, signIn, withPlatformServer } from './support/server.js';

const call = (base, token, client) => request(base, '/api/echo/service', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': client },
});

test('the right token reaches a service route as one fixed actor', async () => {
  await withPlatformServer(async ({ base }) => {
    const result = await call(base, 'echo-secret-token', '10.0.0.1');
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { id: '00000000-0000-4000-8000-0000000000a1', displayName: 'Release notes' });
    assert.equal(SERVICE_ACTOR.id, result.data.id);
  }, { env: { ECHO_TOKEN: 'echo-secret-token' } });
});

test('wrong tokens are limited per client and in total, and a blocked client is refused even with the right token', async () => {
  await withPlatformServer(async ({ base }) => {
    assert.equal((await call(base, 'echo-secret-token', '10.0.0.1')).data.displayName, 'Release notes');
    assert.equal((await call(base, 'guess-1', '10.0.0.1')).status, 401);
    assert.equal((await call(base, 'guess-2', '10.0.0.1')).status, 401);
    const blocked = await call(base, 'echo-secret-token', '10.0.0.1');
    assert.equal(blocked.status, 429);
    assert.match(blocked.data.error, /^Too many attempts\. Try again in \d+ minutes?\.$/);
    assert.match(blocked.headers.get('retry-after'), /^\d+$/);
    assert.equal((await call(base, 'echo-secret-token', '10.0.0.2')).status, 200, 'another client is not blocked');

    assert.equal((await call(base, 'guess-3', '10.0.0.3')).status, 401);
    assert.equal((await call(base, 'guess-4', '10.0.0.4')).status, 401);
    assert.equal((await call(base, 'echo-secret-token', '10.0.0.5')).status, 429, 'the total limit blocks everyone');
  }, { env: { ECHO_TOKEN: 'echo-secret-token' }, rateLimits: { tokenPerClient: 2, tokenTotal: 4 } });
});

test('a blocked client is let back in when the window ends', async () => {
  let clock = 1_000_000;
  await withPlatformServer(async ({ base }) => {
    await call(base, 'wrong', '10.0.0.1');
    assert.equal((await call(base, 'echo-secret-token', '10.0.0.1')).status, 429);
    clock += 15 * 60 * 1000;
    assert.equal((await call(base, 'echo-secret-token', '10.0.0.1')).status, 200);
  }, { env: { ECHO_TOKEN: 'echo-secret-token' }, rateLimits: { tokenPerClient: 1, now: () => clock } });
});

test('a signed-in person reaches a service route without a token and is never token-limited', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const sam = portal.createUser({ email: 'sam@energymatrix.com.au', displayName: 'Sam' });
    const cookie = await signIn(base, portal, sam);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await request(base, '/api/echo/service', { method: 'POST', cookie });
      assert.equal(result.status, 200);
      assert.equal(result.data.displayName, 'Sam');
      assert.equal(result.data.id, sam.id);
    }
  }, { env: { ECHO_TOKEN: 'echo-secret-token' }, rateLimits: { tokenPerClient: 1, tokenTotal: 1 } });
});

test('a blank or unset token never lets anyone in, and a missing header is just "sign in"', async () => {
  for (const env of [{ ECHO_TOKEN: '' }, {}]) {
    await withPlatformServer(async ({ base }) => {
      assert.equal((await call(base, '', '10.0.0.1')).status, 401);
      assert.equal((await call(base, 'anything', '10.0.0.1')).status, 401);
      const bare = await request(base, '/api/echo/service', { method: 'POST' });
      assert.equal(bare.status, 401);
      assert.equal(bare.data.error, 'Sign in required');
    }, { env });
  }
});

test('the token is read as a bearer token only, not from the address or the body', async () => {
  await withPlatformServer(async ({ base }) => {
    assert.equal((await request(base, '/api/echo/service?token=echo-secret-token', { method: 'POST' })).status, 401);
    assert.equal((await request(base, '/api/echo/service', { method: 'POST', body: { token: 'echo-secret-token' } })).status, 401);
    assert.equal((await request(base, '/api/echo/service', { method: 'POST', headers: { Authorization: 'Basic echo-secret-token' } })).status, 401);
    assert.equal((await request(base, '/api/echo/service', { method: 'POST', headers: { Authorization: 'bearer echo-secret-token' } })).status, 200, 'the word Bearer is not case sensitive');
  }, { env: { ECHO_TOKEN: 'echo-secret-token' } });
});
