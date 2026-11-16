// Writes docs/schema/agig-nomination.sql: the tables, indexes and views this app makes at boot, for the database
// administrator to read or run by hand. It comes from server/app/store/schema.js, so it is always what the app
// does; test/schema.test.js fails when the file and the code differ.
//
//   node scripts/write-schema-script.js
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaScript } from '../server/app/store/schema-script.js';

const target = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'schema', 'agig-nomination.sql');
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, schemaScript());
console.log(`Wrote ${path.relative(process.cwd(), target)}`);
