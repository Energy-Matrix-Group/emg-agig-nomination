import assert from 'node:assert/strict';
import { test } from 'node:test';
import sql from 'mssql';
import { httpError } from '../../server/platform/kit.js';
import {
  createStartingNotes,
  databaseStartingMessage,
  databaseWakeSettings,
  isDatabaseStarting,
  retryWhileStarting,
} from '../../server/platform/database-wake.js';
import { NOT_AVAILABLE_MESSAGE, startPausedSqlServer } from './support/paused-sql-server.js';

const starting = () => new sql.ConnectionError(NOT_AVAILABLE_MESSAGE, 'ELOGIN');

function circular() {
  const error = new Error('loop');
  error.cause = error;
  return error;
}

// The classifier hinges on the exact error the driver produces, so this uses the real driver against a
// server that refuses logins the way a paused database does. If a driver upgrade changes the error,
// this fails here instead of the browser showing a raw error again.
async function refusedBy(server) {
  const pool = new sql.ConnectionPool({
    server: '127.0.0.1',
    port: server.port,
    user: 'app',
    password: 'secret',
    database: 'emg-apps',
    options: { encrypt: false },
    connectionTimeout: 10_000,
  });
  try {
    return await pool.connect().then(() => null, (error) => error);
  } finally {
    await pool.close().catch(() => {});
  }
}

test('a real pool refused by a paused database is recognised as starting', async () => {
  const paused = await startPausedSqlServer();
  try {
    const error = await refusedBy(paused);
    assert.ok(error, 'the login was refused');
    assert.equal(error.code, 'ELOGIN');
    assert.equal(isDatabaseStarting(error), true);
  } finally {
    await paused.close();
  }
});

test('a real pool refused for any other reason is not mistaken for a paused database', async () => {
  const refusals = [
    [18456, "Login failed for user 'emgdev'."],
    [40615, "Client with IP address '203.0.113.7' is not allowed to access the server."],
  ];
  for (const [number, message] of refusals) {
    const server = await startPausedSqlServer({ number, message });
    try {
      const error = await refusedBy(server);
      assert.ok(error, message);
      assert.equal(isDatabaseStarting(error), false, message);
    } finally {
      await server.close();
    }
  }
});

test('every shape a resuming database can arrive in is recognised', () => {
  const sessionError = Object.assign(new Error('The database went offline.'), { info: { number: 40613 } });
  const shapes = {
    'login refused': starting(),
    'number on a request error': new sql.RequestError(sessionError, 'EREQUEST'),
    'number only': Object.assign(new Error('x'), { number: 40613 }),
    'wrapped as a cause': new Error('Could not load the session', { cause: starting() }),
    'wrapped by mssql': new sql.ConnectionError(starting()),
    'acquire timed out after a refused login': Object.assign(new Error('aquire timeout'), { possibleTimeoutCause: starting() }),
    'inside an aggregate': new AggregateError([new Error('other'), starting()]),
  };
  for (const [name, error] of Object.entries(shapes)) assert.equal(isDatabaseStarting(error), true, name);
});

test('nothing else is treated as a database that is starting', () => {
  const others = {
    'plain error': new Error('boom'),
    'wrong password': new sql.ConnectionError("Login failed for user 'emgdev'.", 'ELOGIN'),
    'missing database': new sql.ConnectionError('Cannot open database "emg-apps" requested by the login. The login failed.', 'ELOGIN'),
    'firewall': new sql.ConnectionError("Client with IP address '203.0.113.7' is not allowed to access the server.", 'ELOGIN'),
    'connect timeout': new sql.ConnectionError('Failed to connect to db.example:1433 in 30000ms', 'ETIMEOUT'),
    'bad query': new sql.RequestError('Invalid object name', 'EREQUEST'),
    'another service': new Error('The mailbox is not currently available'),
    'a deliberate error with the same words': httpError(503, "Database 'x' on server 'y' is not currently available."),
    'a circular cause': circular(),
    'null': null,
    'undefined': undefined,
    'a string': 'Database x is not currently available',
    'a number': 40613,
    'an empty object': {},
  };
  for (const [name, error] of Object.entries(others)) assert.equal(isDatabaseStarting(error), false, name);
});

test('SQL_AUTO_PAUSE only changes the wording, and is on unless it is switched off', () => {
  assert.deepEqual(databaseWakeSettings({}), { autoPause: true });
  assert.deepEqual(databaseWakeSettings(), { autoPause: true });
  for (const value of ['', 'true', 'on', '1', 'yes', 'anything']) {
    assert.equal(databaseWakeSettings({ SQL_AUTO_PAUSE: value }).autoPause, true, value);
  }
  for (const value of ['false', 'FALSE', ' 0 ', 'off', 'No']) {
    assert.equal(databaseWakeSettings({ SQL_AUTO_PAUSE: value }).autoPause, false, value);
  }
  assert.match(databaseStartingMessage({ autoPause: true }), /starting up after a cost-saving pause/);
  assert.doesNotMatch(databaseStartingMessage({ autoPause: false }), /cost-saving/);
  assert.match(databaseStartingMessage({ autoPause: false }), /temporarily unavailable/);
});

test('boot waits for a database that is resuming and then carries on', async () => {
  let calls = 0;
  const waits = [];
  const lines = [];
  const result = await retryWhileStarting(async () => {
    calls += 1;
    if (calls < 3) throw starting();
    return 'connected';
  }, { label: 'The host database', sleep: async (ms) => { waits.push(ms); }, log: (line) => lines.push(line) });
  assert.equal(result, 'connected');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [5000, 5000]);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /The host database is starting after a pause\. Trying again in 5 seconds \(attempt 1\)/);
});

test('boot fails at once for any other error', async () => {
  let calls = 0;
  await assert.rejects(retryWhileStarting(async () => {
    calls += 1;
    throw new Error('firewall');
  }, { sleep: async () => { throw new Error('should not wait'); } }), /firewall/);
  assert.equal(calls, 1);
});

test('boot gives up with the last error once the wait is used up', async () => {
  let clock = 0;
  let calls = 0;
  await assert.rejects(retryWhileStarting(async () => {
    calls += 1;
    throw starting();
  }, {
    waitMs: 12_000,
    delayMs: 5_000,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    log: () => {},
  }), (error) => isDatabaseStarting(error));
  assert.equal(calls, 3);
});

test('the log says a database is starting once in a while and names it', () => {
  const lines = [];
  let clock = 5_000_000;
  const note = createStartingNotes({ log: (line) => lines.push(line), now: () => clock });
  note(starting());
  clock += 1_000;
  note(starting());
  clock += 10_000;
  note(starting());
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'Database emg-apps is starting after a pause. Asking browsers to wait.');
  createStartingNotes({ log: (line) => lines.push(line), now: () => clock })(new Error('The service is busy'));
  assert.match(lines.at(-1), /^A database is starting/);
});
