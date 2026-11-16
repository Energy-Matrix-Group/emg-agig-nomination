import { schemaStatements, TABLES } from './schema.js';

// The text of docs/schema/agig-nomination.sql (scripts/write-schema-script.js writes it).
export function schemaScript() {
  const added = TABLES.filter((table) => table.added).map((table) => `${table.schema}.${table.name}`).join(' and ');
  return [
    '-- AGIG Nominations: the tables, indexes and views the app makes at boot (server/app/store/schema.js).',
    '-- Written by `node scripts/write-schema-script.js`; do not edit by hand. test/schema.test.js checks it.',
    '--',
    '-- It is the design\'s SQL setup script (sections 1 to 4 and 6) with two tables added since: ' + added + '.',
    '-- Every statement is guarded, so it is safe to run on a database the setup script already built: it makes',
    '-- only what is missing and never alters or drops anything. The spec\'s reference data (pipelines, the SHNOM',
    '-- template, the 82 points and the 28 error codes) is seeded by the app into tables that are empty.',
    '',
    ...schemaStatements().map((statement) => `${statement};\nGO\n`),
  ].join('\n');
}
