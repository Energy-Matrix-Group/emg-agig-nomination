import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalog, setup } from '../server/app/index.js';
import { createSqlStore, DATABASE_VARIABLE, ensureSchema, SCHEMA } from '../server/app/store/sql.js';
import { ADMIN_EMAIL, login, request, STAFF_EMAIL, withServer } from './helpers.js';

async function quietly(run) {
  const { error, warn } = console;
  console.error = () => {};
  console.warn = () => {};
  try {
    return await run();
  } finally {
    console.error = error;
    console.warn = warn;
  }
}

test('hello needs a signed-in person', async () => {
  await withServer(async ({ base }) => {
    const result = await request(base, `${catalog.apiPrefix}/hello`);
    assert.equal(result.status, 401);
    assert.equal(result.data.error, 'Sign in required');
    assert.ok(result.data.signIn.includes(`/handoff?app=${catalog.id}`));
  });
});

test('hello greets the person by name and counts their visits', async () => {
  await withServer(async ({ base }) => {
    const staff = await login(base, STAFF_EMAIL);
    assert.equal(staff.status, 200);
    assert.equal(staff.data.user.email, STAFF_EMAIL);
    const first = await request(base, `${catalog.apiPrefix}/hello`, { cookie: staff.cookie });
    assert.deepEqual(first.data, { message: 'Hello Staff', visits: 1 });
    const second = await request(base, `${catalog.apiPrefix}/hello`, { cookie: staff.cookie });
    assert.equal(second.data.visits, 2);

    const admin = await login(base, ADMIN_EMAIL);
    const other = await request(base, `${catalog.apiPrefix}/hello`, { cookie: admin.cookie });
    assert.deepEqual(other.data, { message: 'Hello Administrator', visits: 1 }, 'each person has their own count');
  });
});

test('the page opens for a signed-in person and sends a signed-out one to the portal', async () => {
  await withServer(async ({ base }) => {
    const signedOut = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(signedOut.status, 302);
    assert.equal(signedOut.headers.get('location'), `http://localhost:4000/handoff?app=${catalog.id}&return=%2F`);

    const { cookie } = await login(base, STAFF_EMAIL);
    const page = await fetch(`${base}/`, { headers: { cookie } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes(`data-app="${catalog.id}"`));
    assert.match(html, /\/platform\/db-wake\.js/, 'the wait screen is added to the page');
  });
});

test('with no SQL_SERVER the app keeps its data in memory and says the database is fine', async () => {
  const context = await setup({ env: {} });
  assert.equal(context.databaseConnected, undefined);
  assert.equal(await context.store.recordVisit('u1'), 1);
});

test('a database that cannot be used does not stop the app: it runs in memory and says so', async () => {
  await quietly(async () => {
    const env = { SQL_SERVER: 'db.example', [DATABASE_VARIABLE]: 'a-database', SQL_USER: 'app', SQL_PASSWORD: 'secret' };
    const refused = await setup({ env, connect: async () => { throw new Error('Login failed'); } });
    assert.equal(refused.databaseConnected, false);
    assert.equal(await refused.store.recordVisit('u1'), 1);

    // The real driver pointed at nothing, as a developer machine would be.
    const unreachable = await setup({ env: { ...env, SQL_SERVER: '127.0.0.1' } });
    assert.equal(unreachable.databaseConnected, false);

    const noName = await setup({ env: { SQL_SERVER: '127.0.0.1', SQL_USER: 'app', SQL_PASSWORD: 'secret' } });
    assert.equal(noName.databaseConnected, false, 'a missing database name is the same fallback');

    await withServer(async ({ base }) => {
      assert.deepEqual((await request(base, '/api/status')).data, { databaseConnected: false });
      const { cookie } = await login(base, STAFF_EMAIL);
      assert.equal((await request(base, `${catalog.apiPrefix}/hello`, { cookie })).status, 200, 'the app still works');
    }, { env });
  });
});

test('a pool handed in belongs to the caller, so its failure is thrown', async () => {
  const pool = { request: () => { throw new Error('pool is broken'); } };
  await assert.rejects(setup({ sql: pool, env: {} }), /pool is broken/);
});

test('the SQL store creates its schema without destroying anything, and only runs parameterised queries', async () => {
  const statements = [];
  const inputs = [];
  const pool = {
    request() {
      const request = {
        input(name, type, value) {
          inputs.push([name, value]);
          return request;
        },
        async query(text) {
          statements.push(text);
          return { recordset: [{ visit_count: 3 }] };
        },
      };
      return request;
    },
  };
  await ensureSchema(pool);
  assert.equal(statements.length, 2);
  assert.ok(statements[0].includes(`IF SCHEMA_ID('${SCHEMA}') IS NULL`));
  assert.ok(statements[1].includes(`IF OBJECT_ID('${SCHEMA}.visits', 'U') IS NULL`));
  for (const text of statements) assert.doesNotMatch(text, /\b(DROP|DELETE|TRUNCATE|ALTER)\b/i, 'boot only adds');

  const store = createSqlStore(pool);
  assert.equal(await store.recordVisit("o'brien; DROP TABLE x"), 3);
  const query = statements.at(-1);
  assert.doesNotMatch(query, /DROP TABLE/, 'user input never reaches the SQL text');
  assert.deepEqual(inputs.at(-1), ['userId', "o'brien; DROP TABLE x"]);
});
