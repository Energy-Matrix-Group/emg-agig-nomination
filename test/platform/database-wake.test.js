import assert from 'node:assert/strict';
import { test } from 'node:test';
import sql from 'mssql';
import { createAppServer } from '../../server/platform/create-server.js';
import { DATABASE_STATE_HEADER, isDatabaseStarting } from '../../server/platform/database-wake.js';
import { httpError } from '../../server/platform/kit.js';
import { createFakePortal } from './support/fake-portal.js';
import { createFixtureApp } from './support/fixture-app.js';
import { NOT_AVAILABLE_MESSAGE } from './support/paused-sql-server.js';
import { request, signIn, withPlatformServer } from './support/server.js';

const asleep = () => new sql.ConnectionError(NOT_AVAILABLE_MESSAGE, 'ELOGIN');
const person = { email: 'sam@energymatrix.com.au', displayName: 'Sam' };

// Makes the store fail the way a paused database does. The returned function is the database finishing its resume.
function pause(store) {
  const original = store.read;
  store.read = async () => {
    throw asleep();
  };
  return () => {
    store.read = original;
  };
}

// The platform says once that a database is starting; the tests need not repeat it in the output.
async function quietly(run) {
  const { warn, error } = console;
  console.warn = () => {};
  console.error = () => {};
  try {
    await run();
  } finally {
    console.warn = warn;
    console.error = error;
  }
}

function assertAskedToWait(result, message = /starting up after a cost-saving pause/) {
  assert.equal(result.status, 503);
  assert.equal(result.headers.get(DATABASE_STATE_HEADER), 'starting');
  assert.equal(result.headers.get('retry-after'), '3');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.data.code, 'database-starting');
  assert.match(result.data.error, message);
}

test('a paused database asks the browser to wait, then recovers; the session does not need the database', async () => {
  await quietly(() => withPlatformServer(async ({ base, portal, app }) => {
    const cookie = await signIn(base, portal, portal.createUser(person));
    const resume = pause(app.store);

    assertAskedToWait(await request(base, '/api/echo/read', { cookie }));
    assert.equal((await request(base, '/api/me', { cookie })).status, 200, 'sign-in state is in the cookie, not the database');

    resume();
    const back = await request(base, '/api/echo/read', { cookie });
    assert.equal(back.status, 200);
    assert.equal(back.data.value, 'stored');
  }));
});

test('the wording follows SQL_AUTO_PAUSE', async () => {
  await quietly(() => withPlatformServer(async ({ base, portal, app }) => {
    const cookie = await signIn(base, portal, portal.createUser(person));
    pause(app.store);
    const result = await request(base, '/api/echo/read', { cookie });
    assertAskedToWait(result, /temporarily unavailable/);
    assert.doesNotMatch(result.data.error, /cost-saving/);
  }, { env: { SQL_AUTO_PAUSE: 'false' } }));
});

test('any other failure is still a generic 500, with no wait header', async () => {
  await quietly(() => withPlatformServer(async ({ base, portal, app }) => {
    const cookie = await signIn(base, portal, portal.createUser(person));
    app.store.read = async () => {
      throw new Error('table exploded');
    };
    const result = await request(base, '/api/echo/read', { cookie });
    assert.equal(result.status, 500);
    assert.equal(result.headers.get(DATABASE_STATE_HEADER), null);
    assert.deepEqual(result.data, { error: 'Something went wrong. Please try again.' });
  }));
});

test('an error thrown on purpose keeps its own status even when its wording matches', async () => {
  await quietly(() => withPlatformServer(async ({ base, portal, app }) => {
    const cookie = await signIn(base, portal, portal.createUser(person));
    app.store.read = async () => {
      throw httpError(503, "Database 'reports' on server 'x' is not currently available.");
    };
    const result = await request(base, '/api/echo/read', { cookie });
    assert.equal(result.status, 503);
    assert.equal(result.headers.get(DATABASE_STATE_HEADER), null);
    assert.match(result.data.error, /is not currently available/);
  }));
});

function bootWith(setup, databaseRetry) {
  const portal = createFakePortal({ appId: 'sleepy' });
  return createAppServer({ app: createFixtureApp({ id: 'sleepy', setup }), env: portal.env(), directory: portal.directory, databaseRetry });
}

test('boot waits for an app database that is starting', async () => {
  let attempts = 0;
  const server = bootWith(async () => {
    attempts += 1;
    if (attempts < 3) throw asleep();
    return { ready: true };
  }, { sleep: async () => {}, log: () => {} });
  await server.ready;
  assert.deepEqual(await server.appContext(), { ready: true });
  assert.equal(attempts, 3);
});

test('boot stops when the database stays asleep for the whole wait', async () => {
  const server = bootWith(async () => {
    throw asleep();
  }, { waitMs: 0, sleep: async () => {}, log: () => {} });
  await assert.rejects(server.ready, (error) => isDatabaseStarting(error));
});

test('boot does not wait for a setup that fails for another reason', async () => {
  let attempts = 0;
  const server = bootWith(async () => {
    attempts += 1;
    throw new Error('bad configuration');
  }, { sleep: async () => { throw new Error('should not wait'); }, log: () => {} });
  await assert.rejects(server.ready, /bad configuration/);
  assert.equal(attempts, 1);
});

test('an app with no setup() gets an empty context', async () => {
  const portal = createFakePortal({ appId: 'plain' });
  const app = createFixtureApp({ id: 'plain' });
  delete app.setup;
  const server = createAppServer({ app, env: portal.env(), directory: portal.directory });
  await server.ready;
  assert.deepEqual(await server.appContext(), {});
});
