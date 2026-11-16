import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clearSessionCookieHeader,
  createSessionValue,
  readSessionUser,
  readSessionValue,
  sessionCookieHeader,
  sessionCookieName,
} from '../../server/platform/session-cookie.js';

const secret = 'a-session-secret-that-is-long-enough-123';
const NOW = Date.parse('2026-10-02T09:00:00Z');
const user = { id: 'u1', email: 'sam@energymatrix.com.au', displayName: 'Sam Lee', isPortalAdmin: true, extra: 'dropped' };

test('the cookie name carries the app id, so apps on localhost never read each other\'s', () => {
  assert.equal(sessionCookieName('ticketing'), 'emg_ticketing_session');
  assert.equal(sessionCookieName('retail-gas'), 'emg_retail-gas_session');
});

test('a session value holds the user and nothing else, and reads back until it expires', () => {
  const value = createSessionValue(user, { secret, minutes: 30, now: NOW });
  assert.deepEqual(readSessionValue(value, { secret, now: NOW + 1000 }), { id: 'u1', email: user.email, displayName: 'Sam Lee', isPortalAdmin: true, role: null });
  const manager = createSessionValue({ ...user, role: 'manager' }, { secret, minutes: 30, now: NOW });
  assert.equal(readSessionValue(manager, { secret, now: NOW }).role, 'manager', 'the role rides in the cookie (template 1.4.0)');
  assert.ok(readSessionValue(value, { secret, now: NOW + 30 * 60_000 - 1 }));
  assert.equal(readSessionValue(value, { secret, now: NOW + 30 * 60_000 }), null, 'the expiry moment is already too late');
  assert.match(value, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'safe to put in a cookie without encoding');
});

test('a changed payload, a changed signature, another secret and junk are all rejected', () => {
  const value = createSessionValue(user, { secret, minutes: 30, now: NOW });
  const [payload, signature] = value.split('.');
  const forged = Buffer.from(JSON.stringify({ v: 1, user: { ...user, id: 'someone-else' }, exp: NOW + 10_000_000 })).toString('base64url');
  const read = (candidate, key = secret) => readSessionValue(candidate, { secret: key, now: NOW });
  assert.equal(read(`${forged}.${signature}`), null);
  assert.equal(read(`${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`), null);
  assert.equal(read(value, 'another-secret-another-secret-12345'), null);
  for (const junk of [undefined, null, '', 'x', 'a.b.c', `${payload}.`, `.${signature}`]) assert.equal(read(junk), null, String(junk));
});

test('a signed value that is not a session is rejected: wrong version, no expiry, no user', async () => {
  const { createHmac } = await import('node:crypto');
  const signed = (data) => {
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
  };
  const good = { v: 1, user: { id: 'u', email: 'a@b.c', displayName: 'A', isPortalAdmin: false }, exp: NOW + 60_000 };
  assert.ok(readSessionValue(signed(good), { secret, now: NOW }));
  for (const bad of [{ ...good, v: 2 }, { ...good, exp: undefined }, { ...good, exp: 'soon' }, { ...good, user: undefined }, { ...good, user: { id: 7, email: 'a', displayName: 'A' } }]) {
    assert.equal(readSessionValue(signed(bad), { secret, now: NOW }), null);
  }
});

test('the user is read from the cookie that belongs to this app', () => {
  const value = createSessionValue(user, { secret, minutes: 30, now: NOW });
  const request = (cookie) => ({ headers: { cookie } });
  assert.equal(readSessionUser(request(`emg_ticketing_session=${value}`), { appId: 'ticketing', secret, now: NOW })?.id, 'u1');
  assert.equal(readSessionUser(request(`emg_ticketing_session=${value}`), { appId: 'documentation', secret, now: NOW }), null);
  assert.equal(readSessionUser(request(`other=1; emg_ticketing_session=${value}; more=2`), { appId: 'ticketing', secret, now: NOW })?.id, 'u1');
  assert.equal(readSessionUser({ headers: {} }, { appId: 'ticketing', secret, now: NOW }), null);
});

test('the cookie is HttpOnly, SameSite=Lax and Path=/, with Secure only when asked', () => {
  assert.equal(sessionCookieHeader('ticketing', 'v', { secure: false, minutes: 30 }), 'emg_ticketing_session=v; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800');
  assert.equal(sessionCookieHeader('ticketing', 'v', { secure: true, minutes: 5 }), 'emg_ticketing_session=v; HttpOnly; SameSite=Lax; Path=/; Max-Age=300; Secure');
  assert.equal(clearSessionCookieHeader('ticketing'), 'emg_ticketing_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  assert.equal(clearSessionCookieHeader('ticketing', { secure: true }), 'emg_ticketing_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure');
});
