import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { createDirectoryClient } from '../../server/platform/directory-client.js';

const USERS = [
  { id: 'u1', email: 'ann@energymatrix.com.au', displayName: 'Ann Lee', isActive: true, isPortalAdmin: true, apps: ['ticketing', 'devboard'] },
  { id: 'u2', email: 'bob@energymatrix.com.au', displayName: 'Bob Ray', isActive: true, isPortalAdmin: false, apps: ['ticketing'] },
];

// The portal's directory endpoints, with a count of the calls so caching can be seen.
async function startPortal({ token = 'dir-token', users = USERS } = {}) {
  const calls = [];
  const state = { mode: 'ok', delayMs: 0 };
  const server = http.createServer((req, res) => {
    calls.push({ url: req.url, authorization: req.headers.authorization });
    const reply = (status, body, raw) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(raw ?? JSON.stringify(body));
    };
    const respond = () => {
      if (state.mode === 'broken') return reply(500, { error: 'boom' });
      if (state.mode === 'garbage') return reply(200, null, 'not json');
      if (req.headers.authorization !== `Bearer ${token}`) return reply(401, { error: 'Sign in required' });
      if (req.url === '/api/directory/users') return reply(200, { users });
      const match = /^\/api\/directory\/users\/by-email\/(.+)$/.exec(req.url);
      if (match) {
        const user = users.find((candidate) => candidate.email === decodeURIComponent(match[1]));
        return user ? reply(200, { user }) : reply(404, { error: 'User not found' });
      }
      return reply(404, { error: 'Not found' });
    };
    if (state.mode === 'hang') return;
    setTimeout(respond, state.delayMs);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    state,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function withPortal(run, options) {
  const portal = await startPortal(options);
  try {
    await run(portal);
  } finally {
    await portal.close();
  }
}

test('it asks the portal with the bearer token and gives back the users', async () => {
  await withPortal(async (portal) => {
    const directory = createDirectoryClient({ portalUrl: portal.url, token: 'dir-token' });
    const users = await directory.listUsers();
    assert.deepEqual(users.map((user) => user.email), ['ann@energymatrix.com.au', 'bob@energymatrix.com.au']);
    assert.deepEqual(users[0].apps, ['ticketing', 'devboard']);
    assert.deepEqual(portal.calls, [{ url: '/api/directory/users', authorization: 'Bearer dir-token' }]);
  });
});

test('answers are kept for a short time, then asked for again', async () => {
  let clock = 1_000_000;
  await withPortal(async (portal) => {
    const directory = createDirectoryClient({ portalUrl: portal.url, token: 'dir-token', ttlMs: 60_000, now: () => clock });
    await directory.listUsers();
    clock += 59_000;
    await directory.listUsers();
    assert.equal(portal.calls.length, 1, 'inside the time, one call');
    clock += 2_000;
    await directory.listUsers();
    assert.equal(portal.calls.length, 2, 'after the time, a fresh call');
  });
});

test('callers that ask at the same moment share one request', async () => {
  await withPortal(async (portal) => {
    portal.state.delayMs = 30;
    const directory = createDirectoryClient({ portalUrl: portal.url, token: 'dir-token' });
    const results = await Promise.all([directory.listUsers(), directory.listUsers(), directory.findUserById('u2'), directory.findUserByEmail('ann@energymatrix.com.au'), directory.findUserByEmail('ANN@energymatrix.com.au')]);
    assert.equal(results[2].email, 'bob@energymatrix.com.au');
    assert.equal(results[3].id, 'u1');
    assert.equal(portal.calls.filter((call) => call.url === '/api/directory/users').length, 1);
    assert.equal(portal.calls.filter((call) => call.url.includes('by-email')).length, 1, 'the email is lower-cased, so both are one lookup');
  });
});

test('a lookup by email is lower-cased and encoded, cached, and a person who is not there is null', async () => {
  await withPortal(async (portal) => {
    const directory = createDirectoryClient({ portalUrl: portal.url, token: 'dir-token' });
    assert.equal((await directory.findUserByEmail('  Bob@EnergyMatrix.com.au ')).id, 'u2');
    assert.equal((await directory.findUserByEmail('bob@energymatrix.com.au')).id, 'u2');
    assert.equal(portal.calls.length, 1);
    assert.equal(portal.calls[0].url, '/api/directory/users/by-email/bob%40energymatrix.com.au');
    assert.equal(await directory.findUserByEmail('nobody@energymatrix.com.au'), null);
    assert.equal(await directory.findUserByEmail(''), null);
    assert.equal(await directory.findUserByEmail(undefined), null);
    assert.equal(portal.calls.length, 2, 'an empty address is not looked up');
  });
});

test('a lookup by id reads the cached list, and an unknown id is null', async () => {
  await withPortal(async (portal) => {
    const directory = createDirectoryClient({ portalUrl: portal.url, token: 'dir-token' });
    assert.equal((await directory.findUserById('u1')).displayName, 'Ann Lee');
    assert.equal(await directory.findUserById('nope'), null);
    assert.equal(portal.calls.length, 1);
  });
});

test('a caller cannot change what the next caller sees', async () => {
  await withPortal(async (portal) => {
    const directory = createDirectoryClient({ portalUrl: portal.url, token: 'dir-token' });
    const first = await directory.listUsers();
    first.length = 0;
    assert.equal((await directory.listUsers()).length, 2);
  });
});

test('failures are 502s that say the portal could not help, and a failure is not remembered', async () => {
  await withPortal(async (portal) => {
    const directory = createDirectoryClient({ portalUrl: portal.url, token: 'dir-token' });
    portal.state.mode = 'broken';
    await assert.rejects(directory.listUsers(), (error) => error.status === 502 && /could not look up users/.test(error.message));
    portal.state.mode = 'garbage';
    await assert.rejects(directory.listUsers(), (error) => error.status === 502);
    portal.state.mode = 'ok';
    assert.equal((await directory.listUsers()).length, 2, 'the next call tries again');

    const wrongToken = createDirectoryClient({ portalUrl: portal.url, token: 'wrong' });
    await assert.rejects(wrongToken.listUsers(), (error) => error.status === 502);
  });
});

test('a portal that is down or does not answer is a 502, not a hang', async () => {
  const down = createDirectoryClient({ portalUrl: 'http://127.0.0.1:9', token: 'dir-token' });
  await assert.rejects(down.listUsers(), (error) => error.status === 502 && /could not be reached/.test(error.message));
  await withPortal(async (portal) => {
    portal.state.mode = 'hang';
    const slow = createDirectoryClient({ portalUrl: portal.url, token: 'dir-token', timeoutMs: 80 });
    await assert.rejects(slow.listUsers(), (error) => error.status === 502 && /could not be reached/.test(error.message));
  });
});

test('without a portal address and token it says what to set, with a 503', async () => {
  for (const options of [{}, { portalUrl: 'http://x' }, { token: 't' }]) {
    const directory = createDirectoryClient(options);
    await assert.rejects(directory.listUsers(), (error) => error.status === 503 && /PORTAL_URL and PORTAL_DIRECTORY_TOKEN/.test(error.message));
    await assert.rejects(directory.findUserByEmail('a@b.c'), (error) => error.status === 503);
  }
});

test('clear() forgets everything', async () => {
  await withPortal(async (portal) => {
    const directory = createDirectoryClient({ portalUrl: portal.url, token: 'dir-token' });
    await directory.listUsers();
    await directory.findUserByEmail('bob@energymatrix.com.au');
    directory.clear();
    await directory.listUsers();
    await directory.findUserByEmail('bob@energymatrix.com.au');
    assert.equal(portal.calls.length, 4);
  });
});
