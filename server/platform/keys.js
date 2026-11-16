import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';

// The portal signs sign-in tokens with an Ed25519 private key. Every app checks them with the public key.
// A key can be pasted three ways, because dashboards and .env files treat new lines differently:
//   1. the PEM as it is, on several lines;
//   2. the PEM on one line with the two characters \n where each new line goes;
//   3. the whole PEM encoded as base64 (the safest when a dashboard mangles new lines).
export function readPem(value, name) {
  let text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is empty.`);
  if (!text.includes('-----BEGIN')) {
    const decoded = Buffer.from(text, 'base64').toString('utf8');
    if (decoded.includes('-----BEGIN')) text = decoded.trim();
  }
  if (!text.includes('-----BEGIN')) throw new Error(`${name} is not a PEM key. Paste it as it is, or base64-encode the whole PEM.`);
  return `${text.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim()}\n`;
}

export function loadPublicKey(value, name = 'PORTAL_SIGNING_PUBLIC_KEY') {
  const pem = readPem(value, name);
  // An app must never hold the portal's private key. Refuse it rather than quietly derive the public half.
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pem)) {
    throw new Error(`${name} holds a private key. Only the portal may have that. Use the public key here.`);
  }
  return ed25519(() => createPublicKey(pem), name);
}

export function loadPrivateKey(value, name = 'PORTAL_SIGNING_PRIVATE_KEY') {
  const pem = readPem(value, name);
  return ed25519(() => createPrivateKey(pem), name);
}

function ed25519(make, name) {
  let key;
  try {
    key = make();
  } catch {
    throw new Error(`${name} is not a valid key.`);
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`${name} must be an Ed25519 key.`);
  return key;
}

// A new key pair as PEM text. Used by the one-line command in docs/SETUP.md and by the tests.
export function generateSigningKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}
