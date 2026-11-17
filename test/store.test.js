import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setup } from '../server/app/index.js';
import { DATABASE_VARIABLE } from '../server/app/store/sql.js';
import { createMemoryStore } from '../server/app/store/memory.js';
import { storeBehaviour } from './store-behaviour.js';
import { quietly } from './support.js';

test('the memory store does everything a store must', async () => {
  await storeBehaviour(createMemoryStore());
});

test('with no SQL_SERVER the app keeps its data in memory and says the database is fine', async () => {
  const app = await setup({ env: {} });
  assert.equal(app.databaseConnected, undefined);
  assert.equal(app.store.kind, 'memory');
});

test('a database that cannot be used does not stop the app: it runs in memory and says so', async () => {
  await quietly(async () => {
    const env = { SQL_SERVER: 'db.example', [DATABASE_VARIABLE]: 'a-database', SQL_USER: 'app', SQL_PASSWORD: 'secret' };
    const refused = await setup({ env, connect: async () => { throw new Error('Login failed'); } });
    assert.equal(refused.databaseConnected, false);
    assert.equal(refused.store.kind, 'memory');
  });
});

test('a pool handed in belongs to the caller, so its failure is thrown', async () => {
  const pool = { request: () => { throw new Error('pool is broken'); } };
  await assert.rejects(setup({ sql: pool, env: {} }), /pool is broken/);
});

test('a setting that is wrong stops the app with a message that names it', async () => {
  await assert.rejects(setup({ env: { NOM_ENVIRONMENT: 'LIVE' } }), /NOM_ENVIRONMENT must be NP or PROD/);
  await assert.rejects(setup({ env: { NOM_CUTOFF_WARNING_MINUTES: '2' } }), /whole number from 5 to 600/);
  assert.equal((await setup({ env: { NOM_ENVIRONMENT: 'prod' } })).settings.environment, 'PROD');
});
