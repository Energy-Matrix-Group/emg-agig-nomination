import sql from 'mssql';

// This app owns one SQL database, and one schema inside it. It never reads another app's database
// or the portal's. The schema name is checked before it is put into SQL text.
export const DATABASE_VARIABLE = 'AGIG_NOMINATION_SQL_DATABASE';
export const SCHEMA = 'agig_nomination';

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

// Idempotent and additive only: safe to run at every boot. New tables, new nullable columns and new
// indexes are fine. Anything destructive is a planned change that Mat reviews, never a boot step.
export async function ensureSchema(pool) {
  await pool.request().query(`IF SCHEMA_ID('${SCHEMA}') IS NULL EXEC('CREATE SCHEMA [${SCHEMA}]')`);
  await pool.request().query(`
    IF OBJECT_ID('${SCHEMA}.visits', 'U') IS NULL
    CREATE TABLE [${SCHEMA}].[visits] (
      user_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_${SCHEMA}_visits PRIMARY KEY,
      visit_count INT NOT NULL
    );
  `);
}

// Queries are always parameterised. Never join user input into the SQL text.
export function createSqlStore(pool) {
  return {
    async recordVisit(userId) {
      const result = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(`
          MERGE [${SCHEMA}].[visits] WITH (HOLDLOCK) AS target
          USING (SELECT @userId AS user_id) AS source ON target.user_id = source.user_id
          WHEN MATCHED THEN UPDATE SET visit_count = target.visit_count + 1
          WHEN NOT MATCHED THEN INSERT (user_id, visit_count) VALUES (@userId, 1)
          OUTPUT inserted.visit_count;
        `);
      return Number(result.recordset[0].visit_count);
    },
  };
}
