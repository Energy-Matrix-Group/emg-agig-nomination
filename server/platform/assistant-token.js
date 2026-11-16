import { randomUUID } from 'node:crypto';
import { checkLifetime, readSigned, roleOf, signClaims, TOKEN_LIFETIME_SECONDS, TokenError } from './token.js';

// Joules, the EMG helper in the portal, acting for a person. For each call it makes to an app on someone's behalf, the
// portal signs one of these with the same key as a sign-in token, and the app checks it with the same public key
// (assistant.js). The app then treats the call as that person's own, so every rule it has for them applies.
//
// Claims: { typ, sub, aud, act, who: { email, name, portalAdmin, role }, iat, exp, jti }   (role from template 1.4.0)
//   typ    always 'assistant'
//   sub    the portal user id                 aud   the id of the one app the token is for
//   act    the one thing it may do: 'manifest' (what can Joules do here?), 'preview:<action>' (what would it do?) or
//          'run:<action>' (do it)
//   iat, exp, jti as a sign-in token's: 60 seconds, and each id used once
//
// It can never sign anyone in: verifyToken refuses a token that has a typ, and an app on a template before 1.3.0 refuses it
// too, because a sign-in token keeps email, name and portalAdmin at the top, and this one keeps them in `who`.

export const ASSISTANT_TYP = 'assistant';
const ACT = /^(manifest|(preview|run):[a-z][a-z0-9_]{1,39})$/;

// Used by the portal. Apps never sign anything.
export function issueAssistantToken({ user, appId, act, privateKey, now = Date.now(), id = randomUUID() }) {
  if (!ACT.test(String(act))) throw new Error(`"${act}" is not something Joules can be allowed to do.`);
  const iat = Math.floor(now / 1000);
  return signClaims({
    typ: ASSISTANT_TYP,
    sub: user.id,
    aud: appId,
    act,
    who: { email: user.email, name: user.displayName, portalAdmin: user.isPortalAdmin === true, role: roleOf(user.role) },
    iat,
    exp: iat + TOKEN_LIFETIME_SECONDS,
    jti: id,
  }, privateKey);
}

// Returns the claims, or throws a TokenError whose code says why: malformed, signature, claims, audience, action, expired or
// replayed. `act` is what the request is asking to do; the token must say exactly that.
export function verifyAssistantToken(token, { publicKey, appId, act, now = Date.now(), replay }) {
  const claims = readSigned(token, publicKey);
  if (!wellFormed(claims)) throw new TokenError('claims', 'The token is not one of Joules\'s.');
  if (claims.aud !== appId) throw new TokenError('audience', 'The token is for a different app.');
  if (claims.act !== act) throw new TokenError('action', 'The token is for something else.');
  checkLifetime(claims, now);
  if (replay && !replay.claim(claims.jti, claims.exp)) throw new TokenError('replayed', 'The token has been used already.');
  return claims;
}

// The person the token speaks for, in the shape a session gives a handler.
export function assistantUser(claims) {
  return { id: claims.sub, email: claims.who.email, displayName: claims.who.name, isPortalAdmin: claims.who.portalAdmin, role: roleOf(claims.who.role) };
}

function wellFormed(claims) {
  const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 320;
  const who = claims.who;
  return claims.typ === ASSISTANT_TYP && text(claims.sub) && text(claims.aud) && text(claims.jti) && ACT.test(String(claims.act))
    && who !== null && typeof who === 'object' && text(who.email) && text(who.name) && typeof who.portalAdmin === 'boolean'
    && Number.isInteger(claims.iat) && Number.isInteger(claims.exp);
}
