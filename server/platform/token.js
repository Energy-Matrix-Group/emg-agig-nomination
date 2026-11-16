import { randomUUID, sign, verify } from 'node:crypto';

// The sign-in token the portal hands to an app. Two parts joined by a dot, both base64url:
//   <claims as JSON>.<Ed25519 signature of the first part>
// There is no algorithm field to trust: the app only ever checks Ed25519 with the portal's public key.
//
// Claims: { sub, email, name, portalAdmin, aud, iat, exp, jti }
//   sub          the portal user id
//   aud          the id of the one app the token is for
//   iat, exp     seconds since 1970; exp is iat + 60
//   jti          a random id, so an app can refuse a token it has seen before

export const TOKEN_LIFETIME_SECONDS = 60;
const LONGEST_LIFETIME_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 30;

export class TokenError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TokenError';
    this.code = code;
  }
}

// Used by the portal. Apps never sign anything.
// The person's company role, as the portal's Users screen sets it: administrator, ops-trader, commercial, manager, executive,
// accounts, or null for someone with none. It tells an app who someone is; it grants nothing by itself. An app may decide from
// it, in its own rules, what someone sees or does there (template 1.4.0). A token from an older portal has none, and a value
// that is not a role id is read as none, so an app always gets a role id or null.
const ROLE = /^[a-z][a-z-]{0,39}$/;
export const roleOf = (value) => (typeof value === 'string' && ROLE.test(value) ? value : null);

export function issueToken({ user, appId, privateKey, now = Date.now(), id = randomUUID() }) {
  const iat = Math.floor(now / 1000);
  return signClaims({
    sub: user.id,
    email: user.email,
    name: user.displayName,
    portalAdmin: user.isPortalAdmin === true,
    role: roleOf(user.role),
    aud: appId,
    iat,
    exp: iat + TOKEN_LIFETIME_SECONDS,
    jti: id,
  }, privateKey);
}

export function signClaims(claims, privateKey) {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = sign(null, Buffer.from(body), privateKey).toString('base64url');
  return `${body}.${signature}`;
}

// Returns the claims, or throws a TokenError whose code says why:
// malformed, signature, claims, audience, expired or replayed.
export function verifyToken(token, { publicKey, appId, now = Date.now(), replay }) {
  const claims = readSigned(token, publicKey);
  // A token with a type is not a sign-in token: Joules's (assistant-token.js) has one, and it must never open a session.
  if (!wellFormed(claims) || 'typ' in claims) throw new TokenError('claims', 'The token is missing a claim.');
  if (claims.aud !== appId) throw new TokenError('audience', 'The token is for a different app.');
  checkLifetime(claims, now);

  // Last, so only a token that is otherwise good uses up its id.
  if (replay && !replay.claim(claims.jti, claims.exp)) throw new TokenError('replayed', 'The token has been used already.');
  return claims;
}

// The claims of a token the portal signed, or a TokenError (malformed, signature or claims). Says nothing yet about what
// the claims are for: verifyToken and verifyAssistantToken do that.
export function readSigned(token, publicKey) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) throw new TokenError('malformed', 'The token is missing or too long.');
  const parts = token.split('.');
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw new TokenError('malformed', 'The token is not in the expected shape.');
  const [body, signature] = parts;

  const signatureBytes = Buffer.from(signature, 'base64url');
  let valid = false;
  try {
    valid = signatureBytes.length === 64 && verify(null, Buffer.from(body), publicKey, signatureBytes);
  } catch {
    valid = false;
  }
  if (!valid) throw new TokenError('signature', 'The token was not signed by the portal.');

  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (claims && typeof claims === 'object' && !Array.isArray(claims)) return claims;
  } catch {
    // answered below
  }
  throw new TokenError('claims', 'The token claims are not JSON.');
}

// A token is good from iat (allowing for a clock a little ahead) until exp, and never for longer than five minutes.
export function checkLifetime(claims, now = Date.now()) {
  const seconds = Math.floor(now / 1000);
  if (claims.exp <= seconds) throw new TokenError('expired', 'The token has expired.');
  if (claims.iat > seconds + CLOCK_SKEW_SECONDS) throw new TokenError('expired', 'The token is not valid yet.');
  if (claims.exp - claims.iat > LONGEST_LIFETIME_SECONDS) throw new TokenError('claims', 'The token lives too long.');
}

function wellFormed(claims) {
  if (!claims || typeof claims !== 'object') return false;
  const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 320;
  return text(claims.sub) && text(claims.email) && text(claims.name) && text(claims.aud) && text(claims.jti)
    && typeof claims.portalAdmin === 'boolean'
    && Number.isInteger(claims.iat) && Number.isInteger(claims.exp);
}
