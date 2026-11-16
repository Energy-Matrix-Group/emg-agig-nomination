import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { generateSigningKeys, loadPrivateKey, loadPublicKey, readPem } from '../../server/platform/keys.js';
import { issueToken, verifyToken } from '../../server/platform/token.js';

const keys = generateSigningKeys();
const user = { id: 'u1', email: 'a@b.example', displayName: 'A', isPortalAdmin: false };

// A token signed with the private key must verify with whichever form the public key was pasted in.
function works(publicValue, privateValue = keys.privateKey) {
  const publicKey = loadPublicKey(publicValue);
  const token = issueToken({ user, appId: 'x', privateKey: loadPrivateKey(privateValue) });
  return verifyToken(token, { publicKey, appId: 'x' }).sub === 'u1';
}

test('a generated pair is Ed25519 PEM', () => {
  assert.match(keys.publicKey, /^-----BEGIN PUBLIC KEY-----\n[\s\S]+\n-----END PUBLIC KEY-----\n$/);
  assert.match(keys.privateKey, /^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----\n$/);
  assert.equal(loadPublicKey(keys.publicKey).asymmetricKeyType, 'ed25519');
  assert.equal(loadPrivateKey(keys.privateKey).asymmetricKeyType, 'ed25519');
});

test('a key may be pasted as PEM, as one line with \\n, as base64, or with Windows line ends', () => {
  const oneLine = (pem) => pem.trim().replace(/\n/g, '\\n');
  const base64 = (pem) => Buffer.from(pem).toString('base64');
  assert.ok(works(keys.publicKey), 'as it is');
  assert.ok(works(`  ${keys.publicKey}\n\n`, `\n${keys.privateKey}  `), 'with stray white space');
  assert.ok(works(oneLine(keys.publicKey), oneLine(keys.privateKey)), 'one line with \\n');
  assert.ok(works(base64(keys.publicKey), base64(keys.privateKey)), 'base64 of the whole PEM');
  assert.ok(works(keys.publicKey.replace(/\n/g, '\r\n'), keys.privateKey.replace(/\n/g, '\r\n')), 'Windows line ends');
});

test('an app refuses a private key where the public one belongs', () => {
  assert.throws(() => loadPublicKey(keys.privateKey), /holds a private key/);
  assert.throws(() => loadPublicKey(Buffer.from(keys.privateKey).toString('base64')), /holds a private key/);
  assert.throws(() => loadPublicKey(keys.privateKey, 'PORTAL_SIGNING_PUBLIC_KEY'), /PORTAL_SIGNING_PUBLIC_KEY holds a private key/);
});

test('empty, garbled and wrong-algorithm keys are refused with a message that names the setting', () => {
  assert.throws(() => loadPublicKey(''), /PORTAL_SIGNING_PUBLIC_KEY is empty/);
  assert.throws(() => loadPublicKey('hello'), /is not a PEM key/);
  assert.throws(() => loadPublicKey('-----BEGIN PUBLIC KEY-----\nbm90IGEga2V5\n-----END PUBLIC KEY-----'), /is not a valid key/);
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => loadPublicKey(rsa.publicKey.export({ type: 'spki', format: 'pem' })), /must be an Ed25519 key/);
  assert.throws(() => loadPrivateKey(rsa.privateKey.export({ type: 'pkcs8', format: 'pem' })), /must be an Ed25519 key/);
  assert.throws(() => loadPrivateKey('nope', 'PORTAL_SIGNING_PRIVATE_KEY'), /PORTAL_SIGNING_PRIVATE_KEY is not a PEM key/);
  assert.throws(() => readPem(undefined, 'X'), /X is empty/);
});

test('the one-line command in the setup guide prints a usable pair', async () => {
  const { execFileSync } = await import('node:child_process');
  const output = execFileSync(process.execPath, ['-e', `
    const { publicKey, privateKey } = require('node:crypto').generateKeyPairSync('ed25519');
    console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }));
    console.log(publicKey.export({ type: 'spki', format: 'pem' }));
  `], { encoding: 'utf8' });
  const [privatePem, publicPem] = output.split(/(?<=-----END PRIVATE KEY-----)\s+/);
  assert.ok(works(publicPem, privatePem));
});
