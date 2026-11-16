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
  const app = await setup({ env: {}, jobs: false });
  assert.equal(app.databaseConnected, undefined);
  assert.equal(app.store.kind, 'memory');
});

test('a database that cannot be used does not stop the app: it runs in memory, says so, and takes no changes', async () => {
  await quietly(async () => {
    const env = { SQL_SERVER: 'db.example', [DATABASE_VARIABLE]: 'a-database', SQL_USER: 'app', SQL_PASSWORD: 'secret' };
    const refused = await setup({ env, jobs: false, connect: async () => { throw new Error('Login failed'); } });
    assert.equal(refused.databaseConnected, false);
    assert.equal(refused.store.kind, 'memory');
    assert.equal(refused.jobs, undefined, 'no background job runs on the fallback');

    const { withApp, addContracts } = await import('./support.js');
    await withApp(async ({ ops, base }) => {
      assert.deepEqual(await (await fetch(`${base}/api/status`)).json(), { databaseConnected: false });
      assert.equal((await ops.call('/board')).status, 200, 'it can still be looked at');
      await assert.rejects(addContracts(ops), /Contracts were not made/);
      const refusedChange = await ops.call('/contracts', { method: 'POST', body: {} });
      assert.equal(refusedChange.status, 503);
    }, { env });
  });
});

test('a pool handed in belongs to the caller, so its failure is thrown', async () => {
  const pool = { request: () => { throw new Error('pool is broken'); } };
  await assert.rejects(setup({ sql: pool, env: {}, jobs: false }), /pool is broken/);
});

test('a setting that is wrong stops the app with a message that names it', async () => {
  await assert.rejects(setup({ env: { NOM_ENVIRONMENT: 'LIVE' }, jobs: false }), /NOM_ENVIRONMENT must be NP or PROD/);
  await assert.rejects(setup({ env: { NOM_SFTP_KEY_EXPIRES: '1/1/27' }, jobs: false }), /NOM_SFTP_KEY_EXPIRES must be a date/);
  await assert.rejects(setup({ env: { NOM_TEAMS_WEBHOOK_URL: 'http://plain' }, jobs: false }), /must be an https address/);
  await assert.rejects(setup({ env: { NOM_RESPONSE_TIMEOUT_MINUTES: '0' }, jobs: false }), /whole number from 1 to 1440/);
});
