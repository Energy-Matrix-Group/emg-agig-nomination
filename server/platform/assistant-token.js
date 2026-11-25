import { randomUUID } from 'node:crypto';
import { checkLifetime, readSigned, roleOf, signClaims, TOKEN_LIFETIME_SECONDS, TokenError } from './token.js';

// Joules, the EMG helper in the portal, acting for a person. For each call it makes to an app on someone's behalf, the
// portal signs one of these with the same key as a sign-in token, and the app checks it with the same public key
// (assistant.js). The app then treats the call as that person's own, so every rule it has for them applies.
//
// Claims: { typ, sub, aud, act, who: { email, name, portalAdmin, role }, via?, session?, iat, exp, jti }
//   typ      always 'assistant'
//   sub      the portal user id                 aud   the id of the one app the token is for
//   act      the one thing it may do: 'manifest' (what can Joules do here?), 'preview:<action>' (what would it do?) or
//            'run:<action>' (do it)
//   via      how the person is talking to him (from template 1.7.0): 'voice' on a phone call, 'sms' by text. Left out for
//            the chat, so a chat token is exactly what it was before 1.7.0. The app offers each way its own actions
//            (assistant-schema.js, `channels`).
//   session  the portal's id for that call or text thread (from 1.7.0), so what the app records can point back to it
//   role     from template 1.4.0
//   iat, exp, jti as a sign-in token's: 60 seconds, and each id used once
//
// It can never sign anyone in: verifyToken refuses a token that has a typ, and an app on a template before 1.3.0 refuses it
// too, because a sign-in token keeps email, name and portalAdmin at the top, and this one keeps them in `who`.

export const ASSISTANT_TYP = 'assistant';
const ACT = /^(manifest|(preview|run):[a-z][a-z0-9_]{1,39})$/;
// The ways a person can be talking to Joules. 'chat' is the portal's chat window, and is never written into a token.
export const ASSISTANT_CHANNELS = Object.freeze(['chat', 'voice', 'sms']);
const SESSION = /^[A-Za-z0-9._:-]{1,100}$/;

// Used by the portal. Apps never sign anything.
export function issueAssistantToken({ user, appId, act, via = 'chat', session = null, privateKey, now = Date.now(), id = randomUUID() }) {
  if (!ACT.test(String(act))) throw new Error(`"${act}" is not something Joules can be allowed to do.`);
  if (!ASSISTANT_CHANNELS.includes(via)) throw new Error(`"${via}" is not a way of talking to Joules.`);
  if (session !== null && !SESSION.test(String(session))) throw new Error('A session id is letters, digits and . _ : -, at most 100 of them.');
  const iat = Math.floor(now / 1000);
  return signClaims({
    typ: ASSISTANT_TYP,
    sub: user.id,
    aud: appId,
    act,
    who: { email: user.email, name: user.displayName, portalAdmin: user.isPortalAdmin === true, role: roleOf(user.role) },
    ...(via === 'chat' ? {} : { via }),
    ...(session === null ? {} : { session }),
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

// How the person is talking to Joules, and the portal's id for that conversation (null in the chat).
export function assistantChannel(claims) {
  return { via: claims.via ?? 'chat', session: claims.session ?? null };
}

function wellFormed(claims) {
  const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 320;
  const who = claims.who;
  return claims.typ === ASSISTANT_TYP && text(claims.sub) && text(claims.aud) && text(claims.jti) && ACT.test(String(claims.act))
    && who !== null && typeof who === 'object' && text(who.email) && text(who.name) && typeof who.portalAdmin === 'boolean'
    && (claims.via === undefined || (claims.via !== 'chat' && ASSISTANT_CHANNELS.includes(claims.via)))
    && (claims.session === undefined || SESSION.test(String(claims.session)))
    && Number.isInteger(claims.iat) && Number.isInteger(claims.exp);
}
