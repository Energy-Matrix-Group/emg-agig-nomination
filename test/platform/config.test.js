import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isProductionLike, readConfig } from '../../server/platform/config.js';
import { createFakePortal } from './support/fake-portal.js';

const portal = createFakePortal({ appId: 'ticketing' });
const good = () => portal.env({ APP_ID: 'ticketing' });

function problems(env) {
  try {
    readConfig(env);
  } catch (error) {
    return error.message;
  }
  return null;
}

test('good settings give a config with the documented defaults', () => {
  const config = readConfig(good());
  assert.equal(config.appId, 'ticketing');
  assert.equal(config.appUrl, 'http://localhost:4001');
  assert.equal(config.portalUrl, 'http://localhost:4000');
  assert.equal(config.sessionMinutes, 30);
  assert.equal(config.port, 3000);
  assert.equal(config.cookieSecure, false);
  assert.equal(config.generatedSecret, false);
  assert.equal(config.portalPublicKey.asymmetricKeyType, 'ed25519');
  assert.equal(config.directoryToken, '');
  assert.ok(Object.isFrozen(config));
});

test('trailing slashes go, and values are read the way the env files write them', () => {
  const local = readConfig({ ...good(), PORTAL_URL: 'http://localhost:4000/', APP_SESSION_MINUTES: ' 45 ', PORT: '8080', PORTAL_DIRECTORY_TOKEN: ' secret ' });
  assert.equal(local.portalUrl, 'http://localhost:4000');
  assert.equal(local.sessionMinutes, 45);
  assert.equal(local.port, 8080);
  assert.equal(local.directoryToken, 'secret');
  const secure = readConfig({ ...good(), COOKIE_SECURE: ' TRUE ', APP_URL: 'https://app.example.test/', PORTAL_URL: 'https://portal.example.test/' });
  assert.equal(secure.cookieSecure, true);
  assert.equal(secure.production, true);
  assert.equal(secure.appUrl, 'https://app.example.test');
  assert.equal(secure.portalUrl, 'https://portal.example.test');
});

test('empty values, as .env.example leaves them, fall back to the defaults', () => {
  const config = readConfig({ ...good(), PORT: '', COOKIE_SECURE: '', APP_SESSION_MINUTES: '', NODE_ENV: '', APP_URL: '', PORTAL_DIRECTORY_TOKEN: '' });
  assert.equal(config.port, 3000);
  assert.equal(config.sessionMinutes, 30);
  assert.equal(config.appUrl, 'http://localhost:3000');
});

test('every problem is reported at once, in words, and names the setting', () => {
  const message = problems({});
  assert.match(message, /The app cannot start/);
  for (const name of ['APP_ID is missing', 'PORTAL_URL is missing', 'PORTAL_SIGNING_PUBLIC_KEY is missing']) assert.match(message, new RegExp(name));
  const bad = problems({ ...good(), APP_ID: 'Bad Id', PORTAL_URL: 'portal.example', APP_SESSION_SECRET: 'short', APP_SESSION_MINUTES: '0', PORT: 'x' });
  for (const part of ['APP_ID "Bad Id"', 'PORTAL_URL "portal.example"', 'at least 32 characters', 'APP_SESSION_MINUTES', 'PORT "x"']) assert.ok(bad.includes(part), part);
});

test('in production the session secret is required and addresses must be https', () => {
  const production = { ...good(), NODE_ENV: 'production', APP_URL: 'https://app.example.test', PORTAL_URL: 'https://portal.example.test' };
  assert.equal(problems(production), null);
  assert.match(problems({ ...production, APP_SESSION_SECRET: '' }), /APP_SESSION_SECRET is missing/);
  assert.match(problems({ ...production, PORTAL_URL: 'http://localhost:4000' }), /PORTAL_URL must start with https:\/\//);
  assert.match(problems({ ...production, APP_URL: '' }), /APP_URL is missing/);
  assert.match(problems({ ...production, NODE_ENV: undefined, RENDER: 'true', APP_URL: 'http://localhost:1' }), /APP_URL must start with https/);
});

test('locally a missing secret is made up, and flagged so the boot can warn', () => {
  const config = readConfig({ ...good(), APP_SESSION_SECRET: '' });
  assert.equal(config.generatedSecret, true);
  assert.ok(config.sessionSecret.length >= 32);
  assert.notEqual(readConfig({ ...good(), APP_SESSION_SECRET: '' }).sessionSecret, config.sessionSecret);
});

test('an address is an origin: no path, query, login or odd scheme', () => {
  for (const url of ['http://localhost:4000/portal', 'http://localhost:4000/?x=1', 'http://user:pass@localhost:4000', 'ftp://localhost', 'http://evil.example']) {
    assert.match(problems({ ...good(), PORTAL_URL: url }), /PORTAL_URL/, url);
  }
  assert.equal(problems({ ...good(), PORTAL_URL: 'https://portal.example.test' }), null);
  assert.equal(problems({ ...good(), PORTAL_URL: 'http://127.0.0.1:4000' }), null);
});

test('keys are checked: a private key, a garbled key and a missing one', () => {
  assert.match(problems({ ...good(), PORTAL_SIGNING_PUBLIC_KEY: portal.keys.privateKey }), /holds a private key/);
  assert.match(problems({ ...good(), PORTAL_SIGNING_PUBLIC_KEY: 'hello' }), /is not a PEM key/);
  assert.equal(problems({ ...good(), PORTAL_SIGNING_PUBLIC_KEY: Buffer.from(portal.keys.publicKey).toString('base64') }), null, 'base64 works');
});

test('production-like means secure cookies, Render or NODE_ENV=production', () => {
  assert.equal(isProductionLike({}), false);
  assert.equal(isProductionLike({ COOKIE_SECURE: 'true' }), true);
  assert.equal(isProductionLike({ RENDER: 'true' }), true);
  assert.equal(isProductionLike({ NODE_ENV: 'production' }), true);
  assert.equal(isProductionLike({ NODE_ENV: 'development', COOKIE_SECURE: 'false' }), false);
});
