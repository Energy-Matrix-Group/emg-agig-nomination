import sql from 'mssql';
import { quantityText } from '../quantity.js';

// Small helpers the SQL store is built from. Every value reaches SQL Server as a parameter: only column and table
// names, which are fixed in this code, are ever part of the SQL text.

export { sql };

// Runs one statement. `runner` is the pool or a transaction; params is { name: [type, value] }.
export function query(runner, text, params = {}) {
  const request = runner.request();
  for (const [name, [type, value]] of Object.entries(params)) request.input(name, type, value);
  return request.query(text);
}

// Runs `work(transaction)` in one transaction: all of it lands, or none of it.
export async function inTransaction(pool, work) {
  const transaction = pool.transaction();
  await transaction.begin();
  try {
    const result = await work(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback().catch(() => {});
    throw error;
  }
}

// A list of values as @prefix0, @prefix1, ... with their params, for IN (...).
export function inList(prefix, type, values) {
  const params = {};
  const names = values.map((value, index) => {
    params[`${prefix}${index}`] = [type, value];
    return `@${prefix}${index}`;
  });
  return { text: names.length ? names.join(', ') : 'NULL', params };
}

// Builds "SET a = @a, b = @b" from a patch, through a map of the fields that may change:
// { field: [Column, type, toSql?] }. A field not in the map is refused, so a typo cannot write somewhere odd.
export function setClause(patch, columns) {
  const parts = [];
  const params = {};
  for (const [field, value] of Object.entries(patch)) {
    const column = columns[field];
    if (!column) throw new Error(`Cannot change ${field}`);
    const [name, type, toSql = (given) => given] = column;
    if (value === '+1') {
      parts.push(`${name} = ${name} + 1`);
      continue;
    }
    parts.push(`${name} = @set_${field}`);
    params[`set_${field}`] = [type, value === null || value === undefined ? null : toSql(value)];
  }
  return { text: parts.join(', '), params };
}

// Conversions between SQL values and the app's: Gas Days as 'yyyy-mm-dd', instants as ISO text, quantities as
// three-decimal text.
export const dateIn = (day) => (day ? new Date(`${day}T00:00:00Z`) : null);
export const dateOut = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value ?? null);
export const timeIn = (value) => (value ? new Date(value) : null);
export const timeOut = (value) => (value instanceof Date ? value.toISOString() : value ?? null);
export const decimalIn = (value) => (value === null || value === undefined || value === '' ? null : Number(quantityText(value)));
export const decimalOut = (value) => quantityText(value);
export const bit = (value) => Boolean(value);
