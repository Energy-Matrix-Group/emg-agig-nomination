import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { connectDatabase, createSqlStore, ensureSchema } from '../server/app/store/sql.js';

// Runs the same behaviour as the memory store against a real database. It skips without a .env that
// names one: run `npm run test:sql` with SQL_SERVER, SQL_USER, SQL_PASSWORD and TEMPLATE_SQL_DATABASE set.
const configured = Boolean(process.env.SQL_SERVER && process.env.TEMPLATE_SQL_DATABASE && process.env.SQL_USER && process.env.SQL_PASSWORD);

test('the SQL store counts visits like the memory store', { skip: !configured && 'no SQL settings in the environment' }, async () => {
  const pool = await connectDatabase(process.env);
  try {
    await ensureSchema(pool);
    await ensureSchema(pool); // running it again is safe
    const store = createSqlStore(pool);
    const person = randomUUID();
    assert.equal(await store.recordVisit(person), 1);
    assert.equal(await store.recordVisit(person), 2);
    assert.equal(await store.recordVisit(randomUUID()), 1);
  } finally {
    await pool.close();
  }
});
