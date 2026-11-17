import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { schemaScript } from '../server/app/store/schema-script.js';
import { schemaStatements, TABLES } from '../server/app/store/schema.js';
import { createSqlStore, ensureSchema } from '../server/app/store/sql.js';

// The SQL store's shape, without a database: what boot runs, and that input only ever travels as parameters.

function fakePool({ columns = TABLES.flatMap((table) => table.columns.map(([column]) => ({ TABLE_SCHEMA: table.schema, TABLE_NAME: table.name, COLUMN_NAME: column }))), count = 0 } = {}) {
  const statements = [];
  const inputs = [];
  const request = () => {
    const self = {
      input(name, type, value) {
        inputs.push([name, value]);
        return self;
      },
      async query(text) {
        statements.push(text);
        if (text.includes('INFORMATION_SCHEMA.COLUMNS')) return { recordset: columns, rowsAffected: [columns.length] };
        if (text.includes('COUNT(*)')) return { recordset: [{ n: count }], rowsAffected: [1] };
        return { recordset: [{}], rowsAffected: [1] };
      },
    };
    return self;
  };
  return {
    statements,
    inputs,
    request,
    transaction: () => ({ begin: async () => {}, commit: async () => {}, rollback: async () => {}, request }),
  };
}

test('boot only adds: every statement is guarded, and nothing is altered, dropped or deleted', async () => {
  const pool = fakePool();
  await ensureSchema(pool);
  const ddl = pool.statements.filter((text) => /CREATE (SCHEMA|TABLE|INDEX|VIEW)/.test(text));
  assert.ok(ddl.length >= 3 + TABLES.length + 2);
  for (const text of ddl) assert.match(text, /^IF (SCHEMA_ID|OBJECT_ID|NOT EXISTS)/, 'each is guarded');
  for (const text of pool.statements) assert.doesNotMatch(text, /\b(DROP|DELETE|TRUNCATE|ALTER)\b/i, 'boot only adds');
  // The seeds are parameterised: no point code reaches the SQL text.
  assert.equal(pool.inputs.filter(([name]) => name === 'code').length, 5 + 82 + 28);
  for (const text of pool.statements) assert.doesNotMatch(text, /OS5-01|Kemerton/);
});

test('a table already there is seeded only when it is empty', async () => {
  const pool = fakePool({ count: 3 });
  await ensureSchema(pool);
  assert.equal(pool.statements.some((text) => text.startsWith('INSERT')), false);
});

test('a database whose tables are another shape is refused, naming the missing columns', async () => {
  const columns = TABLES.flatMap((table) => table.columns.map(([column]) => ({ TABLE_SCHEMA: table.schema, TABLE_NAME: table.name, COLUMN_NAME: column })))
    .filter((column) => !(column.TABLE_NAME === 'Batch' && column.COLUMN_NAME === 'ContentSha256'));
  await assert.rejects(ensureSchema(fakePool({ columns })), /Missing columns: nom\.Batch\.ContentSha256/);
});

test('the design\'s twelve tables, their columns and constraints, and its two views, are all here', () => {
  assert.deepEqual(TABLES.map((table) => `${table.schema}.${table.name}`), [
    'ref.Pipeline', 'ref.Designation', 'ref.FileTemplate', 'ref.ErrorCode', 'ref.Contract',
    'nom.Batch', 'nom.BatchRow', 'nom.ValidationIssue', 'nom.OutboundFile', 'nom.InboundResponse', 'nom.ResponseError',
    'ops.Alert',
  ]);
  const text = schemaStatements().join('\n');
  for (const piece of ['CONSTRAINT UQ_Batch_Source UNIQUE (SourceSha256)', 'FileName varchar(120) NOT NULL UNIQUE', 'GraphMessageId varchar(200) NOT NULL UNIQUE', "CHECK (MatchState IN ('UNMATCHED','MATCHED','MANUAL','UNPARSEABLE'))", 'CREATE VIEW nom.vAcceptedNomination', 'CREATE VIEW nom.vGasDayStatus']) {
    assert.ok(text.includes(piece), piece);
  }
});

test('schema names other than the fixed ones must be plain names', () => {
  assert.throws(() => schemaStatements({ ref: 'ref', nom: 'nom; DROP TABLE x', ops: 'ops' }), /not allowed/);
  assert.throws(() => createSqlStore(fakePool(), { schemas: { ref: 'Ref', nom: 'nom', ops: 'ops' } }), /not allowed/);
});

test('input never reaches the SQL text', async () => {
  const pool = fakePool();
  const store = createSqlStore(pool);
  const hostile = "x'; DROP TABLE nom.Batch; --";
  await store.listBatches({ from: '2026-11-17', status: ['BUILT'], environment: hostile });
  await store.updateAlert(1, { acknowledgedBy: hostile, acknowledgedAt: new Date() });
  await store.raiseAlert({ type: 'TEST', severity: 'Info', message: hostile });
  for (const text of pool.statements) assert.doesNotMatch(text, /DROP TABLE/);
  assert.ok(pool.inputs.some(([, value]) => value === hostile));
});

test('docs/schema/agig-nomination.sql is what the app makes (node scripts/write-schema-script.js)', async () => {
  const written = await readFile(new URL('../docs/schema/agig-nomination.sql', import.meta.url), 'utf8');
  assert.equal(written, schemaScript());
});
