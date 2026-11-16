import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { DATABASE_VARIABLE, connectDatabase, createSqlStore, ensureSchema } from '../server/app/store/sql.js';
import { TABLES, VIEWS } from '../server/app/store/schema.js';
import { storeBehaviour } from './store-behaviour.js';

// Runs the same behaviour as the memory store against a real database. It skips without a .env that names one:
// run `npm run test:sql` with SQL_SERVER, SQL_USER, SQL_PASSWORD and AGIG_NOMINATION_SQL_DATABASE set.
// It works in three throwaway schemas of its own (t<random>_ref, _nom, _ops) and drops them afterwards, so it
// never touches the app's own ref, nom and ops tables. Use a test database all the same.
const configured = Boolean(process.env.SQL_SERVER && process.env[DATABASE_VARIABLE] && process.env.SQL_USER && process.env.SQL_PASSWORD);

test('the SQL store does everything the memory store does', { skip: !configured && 'no SQL settings in the environment', timeout: 300_000 }, async () => {
  const pool = await connectDatabase(process.env);
  const tag = `t${randomBytes(4).toString('hex')}`;
  const schemas = { ref: `${tag}_ref`, nom: `${tag}_nom`, ops: `${tag}_ops` };
  try {
    await ensureSchema(pool, schemas);
    await ensureSchema(pool, schemas); // running it again is safe
    await storeBehaviour(createSqlStore(pool, { schemas }));
  } finally {
    for (const view of VIEWS) await pool.request().query(`DROP VIEW IF EXISTS ${schemas[view.schema]}.${view.name}`);
    for (const table of [...TABLES].reverse()) {
      if (table.name === 'Batch') await pool.request().query(`IF OBJECT_ID('${schemas.nom}.Batch', 'U') IS NOT NULL UPDATE ${schemas.nom}.Batch SET SupersedesBatchId = NULL`);
      await pool.request().query(`DROP TABLE IF EXISTS ${schemas[table.schema]}.${table.name}`);
    }
    for (const schema of Object.values(schemas)) await pool.request().query(`IF SCHEMA_ID('${schema}') IS NOT NULL DROP SCHEMA [${schema}]`);
    await pool.close();
  }
});
