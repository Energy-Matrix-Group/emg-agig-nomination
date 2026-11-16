import { createMemoryStore } from './memory.js';
import { connectDatabase, createSqlStore, DATABASE_VARIABLE, ensureSchema } from './sql.js';

// One interface, two adapters. With no SQL_SERVER the memory store is the choice. With one, the app opens
// its own database. If that cannot be used, the app stays up on memory and reports databaseConnected: false,
// so /api/status says so and the UI shows its "no database" banner. A pool passed in as `sql` belongs to the
// caller (the SQL tests), so its failure is thrown.
export async function openStore({ sql = null, env = {}, connect = connectDatabase } = {}) {
  if (!sql && !env.SQL_SERVER) return { store: createMemoryStore() };
  let pool = sql;
  try {
    pool ??= await connect(env);
    await ensureSchema(pool);
    if (!sql) console.log(`This app uses SQL database ${env[DATABASE_VARIABLE]} on ${env.SQL_SERVER}`);
    return { store: createSqlStore(pool) };
  } catch (error) {
    if (sql) throw error;
    console.error(error);
    await pool?.close?.().catch(() => {});
    console.warn(`Cannot use database ${env[DATABASE_VARIABLE] || '(not set)'} on ${env.SQL_SERVER}. This app is running in memory and loses its data on restart.`);
    return { store: createMemoryStore(), databaseConnected: false };
  }
}
