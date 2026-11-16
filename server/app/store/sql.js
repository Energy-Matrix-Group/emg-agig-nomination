import { DESIGNATIONS, ERROR_CODES, FILE_TEMPLATE, PIPELINES } from '../reference/seed.js';
import { batchStore } from './sql-batches.js';
import { dateIn, inTransaction, query, sql } from './sql-kit.js';
import { opsStore } from './sql-ops.js';
import { referenceStore } from './sql-reference.js';
import { checkSchemas, DEFAULT_SCHEMAS, schemaStatements, TABLES } from './schema.js';

// This app owns one SQL database, AGIG_NOMINATION_SQL_DATABASE, and three schemas inside it (ref, nom, ops), the
// ones the design's setup script made. It never reads another app's database or the portal's. It can be pointed
// at a database that script already built: it makes only what is missing, and checks the rest has the columns it
// needs.
export const DATABASE_VARIABLE = 'AGIG_NOMINATION_SQL_DATABASE';

const DATABASE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,120}$/;

export function databaseName(env) {
  const name = env[DATABASE_VARIABLE];
  if (!DATABASE_NAME.test(name ?? '')) throw new Error(`Missing or invalid ${DATABASE_VARIABLE}`);
  return name;
}

export async function connectDatabase(env) {
  const pool = new sql.ConnectionPool({
    server: env.SQL_SERVER,
    user: env.SQL_USER,
    password: env.SQL_PASSWORD,
    database: databaseName(env),
    options: { encrypt: true },
    connectionTimeout: 30000,
    requestTimeout: 120000,
  });
  await pool.connect();
  return pool;
}

// Idempotent and additive only: safe to run at every boot. It makes the schemas, tables, indexes and views that
// are missing, checks that the tables it found have every column the app uses, and seeds the spec's reference
// data into a table that is empty. It never alters or drops anything: anything destructive is a planned change
// that Mat reviews, never a boot step.
export async function ensureSchema(pool, schemas = DEFAULT_SCHEMAS) {
  checkSchemas(schemas);
  for (const statement of schemaStatements(schemas)) await query(pool, statement);

  const found = await query(pool, `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA IN (@ref, @nom, @ops)`, {
    ref: [sql.NVarChar(128), schemas.ref], nom: [sql.NVarChar(128), schemas.nom], ops: [sql.NVarChar(128), schemas.ops],
  });
  const have = new Set((found.recordset ?? []).map((row) => `${row.TABLE_SCHEMA}.${row.TABLE_NAME}.${row.COLUMN_NAME}`.toLowerCase()));
  const missing = TABLES.flatMap((table) => table.columns
    .map(([column]) => `${schemas[table.schema]}.${table.name}.${column}`)
    .filter((name) => !have.has(name.toLowerCase())));
  if (missing.length) {
    throw new Error(`The database's tables are not the shape this app needs. Missing columns: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' and more' : ''}.`);
  }
  await seedReference(pool, schemas);
}

// The spec's reference data, once: each table is filled only while it is empty, in one transaction, so an
// interrupted boot simply seeds it again next time.
async function seedReference(pool, s) {
  const empty = async (table) => (await query(pool, `SELECT COUNT(*) AS n FROM ${table}`)).recordset[0].n === 0;
  if (await empty(`${s.ref}.Pipeline`)) {
    await inTransaction(pool, async (tx) => {
      for (const pipeline of PIPELINES) {
        await query(tx, `INSERT ${s.ref}.Pipeline (PipelineCode, PipelineName) VALUES (@code, @name)`, {
          code: [sql.VarChar(10), pipeline.code], name: [sql.NVarChar(100), pipeline.name],
        });
      }
    });
  }
  if (await empty(`${s.ref}.FileTemplate`)) {
    await inTransaction(pool, async (tx) => {
      for (const column of FILE_TEMPLATE) {
        await query(tx, `INSERT ${s.ref}.FileTemplate (ColumnOrder, ColumnName, IsMandatory) VALUES (@order, @name, @mandatory)`, {
          order: [sql.TinyInt, column.order], name: [sql.VarChar(60), column.name], mandatory: [sql.Bit, column.mandatory],
        });
      }
    });
  }
  if (await empty(`${s.ref}.Designation`)) {
    await inTransaction(pool, async (tx) => {
      for (const point of DESIGNATIONS) {
        await query(tx, `INSERT ${s.ref}.Designation (PipelineCode, DesignationCode, Direction, LocationName, Notes, SpecSection, ValidFrom)
          VALUES (@pipeline, @code, @direction, @location, @notes, @section, @validFrom)`, {
          pipeline: [sql.VarChar(10), point.pipelineCode], code: [sql.VarChar(20), point.code], direction: [sql.VarChar(6), point.direction],
          location: [sql.NVarChar(100), point.locationName], notes: [sql.NVarChar(200), point.notes], section: [sql.VarChar(10), point.specSection],
          validFrom: [sql.Date, dateIn(point.validFrom)],
        });
      }
    });
  }
  if (await empty(`${s.ref}.ErrorCode`)) {
    await inTransaction(pool, async (tx) => {
      for (const error of ERROR_CODES) {
        await query(tx, `INSERT ${s.ref}.ErrorCode (ErrorCode, ErrorMessage) VALUES (@code, @message)`, {
          code: [sql.Char(3), error.code], message: [sql.NVarChar(200), error.message],
        });
      }
    });
  }
}

// Queries are always parameterised. Never join user input into the SQL text.
export function createSqlStore(pool, { schemas = DEFAULT_SCHEMAS } = {}) {
  checkSchemas(schemas);
  return {
    kind: 'sql',
    ...referenceStore(pool, schemas),
    ...batchStore(pool, schemas),
    ...opsStore(pool, schemas),
  };
}
