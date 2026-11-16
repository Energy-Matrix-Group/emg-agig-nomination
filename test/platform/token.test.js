import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadPrivateKey, loadPublicKey } from '../../server/platform/keys.js';
import { createReplayGuard } from '../../server/platform/replay-guard.js';
import { issueToken, roleOf, signClaims, TokenError, verifyToken } from '../../server/platform/token.js';
import { createFakePortal } from './support/fake-portal.js';

const portal = createFakePortal({ appId: 'ticketing' });
const privateKey = loadPrivateKey(portal.keys.privateKey);
const publicKey = loadPublicKey(portal.keys.publicKey);
const NOW = Date.parse('2026-10-02T09:00:00Z');
// Changes the first character, which always changes the decoded bytes (the last one can be padding bits).
const flip = (text) => `${text[0] === 'A' ? 'B' : 'A'}${text.slice(1)}`;
const user = { id: 'user-1', email: 'sam@energymatrix.com.au', displayName: 'Sam Lee', isPortalAdmin: true };

function claimsFor(overrides = {}) {
  const iat = Math.floor(NOW / 1000);
  return { sub: user.id, email: user.email, name: user.displayName, portalAdmin: true, aud: 'ticketing', iat, exp: iat + 60, jti: 'id-1', ...overrides };
}

function codeOf(token, options = {}) {
  try {
    verifyToken(token, { publicKey, appId: 'ticketing', now: NOW, ...options });
  } catch (error) {
    assert.ok(error instanceof TokenError, `expected a TokenError, got ${error}`);
    return error.code;
  }
  return 'accepted';
}

test('a token carries the documented claims and lives 60 seconds', () => {
  const token = issueToken({ user, appId: 'ticketing', privateKey, now: NOW, id: 'abc' });
  const claims = verifyToken(token, { publicKey, appId: 'ticketing', now: NOW });
  assert.deepEqual(claims, {
    sub: 'user-1',
    email: 'sam@energymatrix.com.au',
    name: 'Sam Lee',
    portalAdmin: true,
    role: null,
    aud: 'ticketing',
    iat: NOW / 1000,
    exp: NOW / 1000 + 60,
    jti: 'abc',
  });
  assert.equal(token.split('.').length, 2);
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('every token gets its own id', () => {
  const ids = new Set();
  for (let index = 0; index < 20; index += 1) {
    ids.add(verifyToken(issueToken({ user, appId: 'ticketing', privateKey, now: NOW }), { publicKey, appId: 'ticketing', now: NOW }).jti);
  }
  assert.equal(ids.size, 20);
});

// Template 1.4.0: the person's company role, so an app can decide from it what they see. It is a role id or null, never anything
// else, and a token without one (from an older portal) is still good.
test('a token carries the person\'s role as a role id, or null', () => {
  const role = (value) => verifyToken(issueToken({ user: { ...user, role: value }, appId: 'ticketing', privateKey, now: NOW }), { publicKey, appId: 'ticketing', now: NOW }).role;
  assert.equal(role('manager'), 'manager');
  assert.equal(role('ops-trader'), 'ops-trader');
  for (const value of [undefined, null, '', 'Manager', 'ops trader', 'x'.repeat(41), 7, { id: 'manager' }]) assert.equal(role(value), null, JSON.stringify(value));
  assert.equal(codeOf(signClaims(claimsFor(), privateKey)), 'accepted', 'a token with no role claim at all is still good');
  assert.equal(roleOf('executive'), 'executive');
  assert.equal(roleOf('<script>'), null);
});

test('a missing portalAdmin flag is false, never truthy by accident', () => {
  const token = issueToken({ user: { ...user, isPortalAdmin: undefined }, appId: 'ticketing', privateKey, now: NOW });
  assert.equal(verifyToken(token, { publicKey, appId: 'ticketing', now: NOW }).portalAdmin, false);
});

test('a changed claim, a changed signature and a foreign key are all refused as a bad signature', () => {
  const token = signClaims(claimsFor(), privateKey);
  const [body, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify(claimsFor({ portalAdmin: false, email: 'someone@else.example' }))).toString('base64url');
  assert.equal(codeOf(`${forged}.${signature}`), 'signature');
  assert.equal(codeOf(`${body}.${flip(signature)}`), 'signature');
  assert.equal(codeOf(`${body}.${Buffer.alloc(64).toString('base64url')}`), 'signature');
  assert.equal(codeOf(`${body}.${Buffer.alloc(10).toString('base64url')}`), 'signature', 'a short signature');
  assert.equal(codeOf(signClaims(claimsFor(), loadPrivateKey(createFakePortal().keys.privateKey))), 'signature');
});

test('the audience must be this app', () => {
  assert.equal(codeOf(signClaims(claimsFor({ aud: 'documentation' }), privateKey)), 'audience');
  assert.equal(codeOf(signClaims(claimsFor({ aud: 'Ticketing' }), privateKey)), 'audience', 'ids are exact');
  assert.equal(codeOf(signClaims(claimsFor(), privateKey), { appId: 'documentation' }), 'audience');
});

test('an expired token, a future one and one that lives too long are refused', () => {
  const iat = Math.floor(NOW / 1000);
  assert.equal(codeOf(signClaims(claimsFor({ iat: iat - 120, exp: iat - 60 }), privateKey)), 'expired');
  assert.equal(codeOf(signClaims(claimsFor({ iat: iat - 60, exp: iat }), privateKey)), 'expired', 'expiry is exclusive');
  assert.equal(codeOf(signClaims(claimsFor({ iat: iat + 120, exp: iat + 180 }), privateKey)), 'expired', 'issued in the future');
  assert.equal(codeOf(signClaims(claimsFor({ iat: iat + 20, exp: iat + 80 }), privateKey)), 'accepted', 'a little clock difference is fine');
  assert.equal(codeOf(signClaims(claimsFor({ exp: iat + 600 }), privateKey)), 'claims');
});

test('the shape is checked: missing, mistyped and oversized claims, and things that are not tokens', () => {
  for (const [name, overrides] of Object.entries({
    'no sub': { sub: undefined },
    'no email': { email: '' },
    'name not text': { name: 7 },
    'portalAdmin not boolean': { portalAdmin: 'yes' },
    'iat not a whole number': { iat: 1.5 },
    'exp as text': { exp: '9999999999' },
    'no jti': { jti: undefined },
    'a huge email': { email: 'a'.repeat(400) },
  })) {
    assert.equal(codeOf(signClaims(claimsFor(overrides), privateKey)), 'claims', name);
  }
  for (const bad of [undefined, null, 5, '', 'abc', 'a.b.c', 'a b.c', `${'a'.repeat(5000)}.b`, 'é.é']) {
    assert.equal(codeOf(bad), 'malformed', String(bad).slice(0, 20));
  }
  const notJson = Buffer.from('not json').toString('base64url');
  assert.equal(codeOf(`${notJson}.${Buffer.alloc(64).toString('base64url')}`), 'signature');
});

test('only a token that is otherwise good uses up its id', () => {
  const replay = createReplayGuard({ now: () => NOW });
  assert.equal(codeOf(signClaims(claimsFor({ jti: 'x', aud: 'other' }), privateKey), { replay }), 'audience');
  assert.equal(replay.size(), 0);
  assert.equal(codeOf(signClaims(claimsFor({ jti: 'x' }), privateKey), { replay }), 'accepted', 'the refused one did not use x');
  assert.equal(codeOf(signClaims(claimsFor({ jti: 'x' }), privateKey), { replay }), 'replayed');
  assert.equal(codeOf(signClaims(claimsFor({ jti: 'y' }), privateKey), { replay }), 'accepted');
});

test('a replay guard forgets an id once its token would have expired', () => {
  let clock = NOW;
  const replay = createReplayGuard({ now: () => clock });
  const expires = NOW / 1000 + 60;
  assert.equal(replay.claim('a', expires), true);
  assert.equal(replay.claim('a', expires), false);
  clock += 59_000;
  assert.equal(replay.claim('a', expires), false);
  clock += 2_000;
  assert.equal(replay.claim('a', expires), true, 'past its expiry the id is free again (the token itself would be refused as expired)');
  assert.equal(replay.size(), 1);
});
