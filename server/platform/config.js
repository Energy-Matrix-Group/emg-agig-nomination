import { randomBytes } from 'node:crypto';
import { loadPublicKey } from './keys.js';

const APP_ID = /^[a-z][a-z0-9-]{0,39}$/;
const MIN_SECRET_LENGTH = 32;
const DEFAULT_SESSION_MINUTES = 30;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const flag = (value) => String(value ?? '').trim().toLowerCase();

// True when the process looks like it serves real people: on Render, in production, or with secure cookies.
export function isProductionLike(env = {}) {
  return flag(env.COOKIE_SECURE) === 'true' || Boolean(env.RENDER) || flag(env.NODE_ENV) === 'production';
}

// Reads every platform setting once, at boot. All the problems are reported together, in plain words,
// so a person setting up a new service can fix them in one go.
export function readConfig(env = process.env) {
  const problems = [];
  const production = isProductionLike(env);
  const cookieSecure = flag(env.COOKIE_SECURE) === 'true';

  const appId = String(env.APP_ID ?? '').trim();
  if (!appId) problems.push('APP_ID is missing. Use this app\'s id, for example "ticketing".');
  else if (!APP_ID.test(appId)) problems.push(`APP_ID "${appId}" is not valid. Use lower-case letters, digits and hyphens, starting with a letter.`);

  const port = env.PORT === undefined || String(env.PORT).trim() === '' ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) problems.push(`PORT "${env.PORT}" is not a port number.`);

  const appUrl = readOrigin(env.APP_URL, { name: 'APP_URL', production, fallback: `http://localhost:${port}`, problems, example: 'https://emg-ticketing.onrender.com' });
  const portalUrl = readOrigin(env.PORTAL_URL, { name: 'PORTAL_URL', production, problems, example: 'https://emg-portal.onrender.com' });

  let portalPublicKey = null;
  if (!String(env.PORTAL_SIGNING_PUBLIC_KEY ?? '').trim()) {
    problems.push('PORTAL_SIGNING_PUBLIC_KEY is missing. Copy the public key from the portal setup (docs/SETUP.md in emg-portal).');
  } else {
    try {
      portalPublicKey = loadPublicKey(env.PORTAL_SIGNING_PUBLIC_KEY);
    } catch (error) {
      problems.push(error.message);
    }
  }

  let sessionSecret = String(env.APP_SESSION_SECRET ?? '');
  let generatedSecret = false;
  if (!sessionSecret) {
    if (production) {
      problems.push('APP_SESSION_SECRET is missing. Make one with: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'hex\'))"');
    } else {
      // Local work only: a new secret each start, so sessions end whenever the app restarts.
      sessionSecret = randomBytes(32).toString('hex');
      generatedSecret = true;
    }
  } else if (sessionSecret.length < MIN_SECRET_LENGTH) {
    problems.push(`APP_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);
  }

  const rawMinutes = String(env.APP_SESSION_MINUTES ?? '').trim();
  const sessionMinutes = rawMinutes === '' ? DEFAULT_SESSION_MINUTES : Number(rawMinutes);
  if (!Number.isInteger(sessionMinutes) || sessionMinutes < 1 || sessionMinutes > 720) {
    problems.push(`APP_SESSION_MINUTES "${rawMinutes}" must be a whole number of minutes from 1 to 720.`);
  }

  if (problems.length > 0) {
    throw new Error(`The app cannot start. Fix these settings:\n${problems.map((line) => `  - ${line}`).join('\n')}`);
  }

  return Object.freeze({
    appId,
    appUrl,
    portalUrl,
    port,
    cookieSecure,
    production,
    sessionMinutes,
    sessionSecret,
    generatedSecret,
    portalPublicKey,
    directoryToken: String(env.PORTAL_DIRECTORY_TOKEN ?? '').trim(),
  });
}

// An address is an origin only: scheme, host and optional port. Plain http is for this machine only,
// and only outside production.
function readOrigin(value, { name, production, fallback, problems, example }) {
  const text = String(value ?? '').trim();
  if (!text) {
    if (fallback && !production) return fallback;
    problems.push(`${name} is missing. Use the public address, for example ${example}.`);
    return null;
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    problems.push(`${name} "${text}" is not a web address. Start it with https://.`);
    return null;
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname) && !production)) {
    problems.push(`${name} must start with https://${production ? '' : ' (http:// is allowed for localhost only)'}.`);
    return null;
  }
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash || url.username || url.password) {
    problems.push(`${name} must be the address only, with no path, query or login, for example ${example}.`);
    return null;
  }
  return url.origin;
}
