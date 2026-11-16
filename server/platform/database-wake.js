import { sendJson } from './http.js';

// Azure SQL serverless can pause an idle database to save cost, and the test environment does.
// The first login after a pause is refused with error 40613 while the database resumes, which takes
// about a minute. This is the one place that knows that, so the host and every applet, now and
// later, answer the same way and the browser can wait instead of showing an error.

export const DATABASE_STATE_HEADER = 'X-Database-State';
export const DATABASE_STARTING_CODE = 'database-starting';
export const RETRY_AFTER_SECONDS = 3;

// How long a booting API waits for a database that is resuming, and how often it asks again.
const BOOT_WAIT_MS = 5 * 60_000;
const BOOT_RETRY_MS = 5_000;
const LOG_EVERY_MS = 10_000;

const COPY = {
  paused: 'The database is starting up after a cost-saving pause. This usually takes about a minute.',
  unavailable: 'The database is temporarily unavailable. Reconnecting now.',
};

const NOT_AVAILABLE_NUMBER = 40613;
// tedious reports a refused login as { code: 'ELOGIN', message } and drops the server's error number,
// so the wording is what identifies it. The number still arrives on an error raised mid-session.
const NOT_AVAILABLE = /\bdatabase\b[\s\S]{0,300}?\bis not currently available\b/i;

// SQL_AUTO_PAUSE names what is true of the environment: the databases pause when idle. It only picks
// the wording. A database that is unreachable for another reason (a failover, say) is waited for
// either way. Unset means on, because the test environment is the one that exists today.
export function databaseWakeSettings(env = {}) {
  const value = String(env.SQL_AUTO_PAUSE ?? '').trim().toLowerCase();
  return { autoPause: !['false', '0', 'off', 'no'].includes(value) };
}

export function databaseStartingMessage(settings) {
  return settings?.autoPause === false ? COPY.unavailable : COPY.paused;
}

// True when the database refused the connection because it is starting, not because of a bug.
// An error that carries a status was thrown on purpose and already says what it means.
export function isDatabaseStarting(error) {
  if (Number.isInteger(error?.status)) return false;
  for (const candidate of causesOf(error)) {
    if (candidate.number === NOT_AVAILABLE_NUMBER || candidate.info?.number === NOT_AVAILABLE_NUMBER) return true;
    if (typeof candidate.message === 'string' && NOT_AVAILABLE.test(candidate.message)) return true;
  }
  return false;
}

// mssql keeps the driver's error in originalError, and tarn keeps the last create error in
// possibleTimeoutCause when an acquire times out.
function* causesOf(error, seen = new Set(), depth = 0) {
  if (!error || typeof error !== 'object' || seen.has(error) || depth > 4) return;
  seen.add(error);
  yield error;
  const inner = [error.originalError, error.cause, error.possibleTimeoutCause];
  if (Array.isArray(error.errors)) inner.push(...error.errors);
  for (const next of inner) yield* causesOf(next, seen, depth + 1);
}

// The answer for any request that failed because the database is starting. The connection was
// refused before a statement ran, so the caller may send the same request again.
// X-Database-State is what the browser layer looks for.
export function sendDatabaseStarting(res, settings) {
  sendJson(res, 503, {
    error: databaseStartingMessage(settings),
    code: DATABASE_STARTING_CODE,
  }, {
    [DATABASE_STATE_HEADER]: 'starting',
    'Retry-After': String(RETRY_AFTER_SECONDS),
  });
}

// Every waiting browser asks again every few seconds, so the log says it once in a while, not each time.
export function createStartingNotes({ log = (line) => console.warn(line), now = Date.now } = {}) {
  let last = -Infinity;
  return (error) => {
    const at = now();
    if (at - last < LOG_EVERY_MS) return;
    last = at;
    const name = /database '([^']+)'/i.exec(String(error?.message ?? ''))?.[1];
    log(`${name ? `Database ${name}` : 'A database'} is starting after a pause. Asking browsers to wait.`);
  };
}

export const noteDatabaseStarting = createStartingNotes();

// For boot: try again while a database is resuming, then give up with the last error. Anything
// else fails at once, as it always did.
export async function retryWhileStarting(work, {
  label = 'The database',
  waitMs = BOOT_WAIT_MS,
  delayMs = BOOT_RETRY_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  log = console.warn,
} = {}) {
  const deadline = now() + waitMs;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (!isDatabaseStarting(error) || now() + delayMs > deadline) throw error;
      log(`${label} is starting after a pause. Trying again in ${delayMs / 1000} seconds (attempt ${attempt}).`);
      await sleep(delayMs);
    }
  }
}
