import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { checkAssistant, readCheck, shapeOutcome } from '../../server/platform/assistant-schema.js';
import { assistantChannel, issueAssistantToken, verifyAssistantToken } from '../../server/platform/assistant-token.js';
import { loadPrivateKey, loadPublicKey } from '../../server/platform/keys.js';
import { httpError } from '../../server/platform/kit.js';
import { signClaims } from '../../server/platform/token.js';
import { createFakePortal } from './support/fake-portal.js';
import { createFixtureApp } from './support/fixture-app.js';
import { request, withPlatformServer } from './support/server.js';

// Joules on a phone call or by text (template 1.7.0): the token says which way the person is talking to him, the door
// offers and runs only the app's set for that way, and a write's preview can carry a check that its run must match.

let warn;
before(() => {
  warn = console.warn;
  console.warn = (line, ...rest) => { if (!/^Joules refused/.test(String(line))) warn(line, ...rest); };
});
after(() => {
  console.warn = warn;
});

const person = { email: 'sam@energymatrix.com.au', displayName: 'Sam Lee', isPortalAdmin: false };
const seen = [];

const note = (name, extra = {}) => ({
  name,
  kind: 'write',
  title: 'Add a note',
  description: 'Adds a note.',
  input: { type: 'object', properties: { text: { type: 'string', maxLength: 40 } }, required: ['text'] },
  preview: async ({ input }) => ({ summary: `Add "${input.text}"`, fields: [], check: `plan-${input.text.length}` }),
  run: async ({ input, via, session, check, user }) => {
    if (check !== `plan-${input.text.length}`) throw httpError(409, 'That is not what you were shown.');
    seen.push({ user: user.id, text: input.text, via, session });
    return { summary: 'Note added' };
  },
  ...extra,
});
const whoAmI = {
  name: 'who_am_i',
  kind: 'read',
  title: 'Who is asking',
  description: 'Says how the person is talking to Joules.',
  input: { type: 'object', properties: {} },
  run: async ({ via, session, check }) => ({ via, session, check }),
};
const archive = {
  name: 'archive_note',
  kind: 'write',
  title: 'Archive a note',
  description: 'Archives a note.',
  input: { type: 'object', properties: {} },
  preview: async () => ({ summary: 'Archive it' }),
  run: async () => ({ summary: 'Archived' }),
};
const ASSISTANT = {
  about: 'Echo keeps notes.',
  actions: [whoAmI, note('add_note'), archive],
  channels: { voice: [whoAmI, note('add_note')], sms: [note('add_note')] },
};

const app = () => createFixtureApp({ assistant: ASSISTANT });
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const keysOf = (portal) => ({ publicKey: loadPublicKey(portal.keys.publicKey), privateKey: loadPrivateKey(portal.keys.privateKey) });
const call = (base, token, action, body) => request(base, `/api/assistant/${action}`, { method: 'POST', headers: bearer(token), body });

test('a token says how the person is talking to Joules; a chat token is what it always was', () => {
  const portal = createFakePortal();
  const user = portal.createUser(person);
  const read = (token, act) => verifyAssistantToken(token, { publicKey: keysOf(portal).publicKey, appId: 'echo', act });
  const chat = read(portal.assistantToken(user, 'manifest'), 'manifest');
  assert.equal('via' in chat, false, 'the chat is never written into a token, so an app before 1.7.0 reads it as before');
  assert.equal('session' in chat, false);
  assert.deepEqual(assistantChannel(chat), { via: 'chat', session: null });
  const voice = read(portal.assistantToken(user, 'manifest', { via: 'voice', session: 'call:6f1c-22' }), 'manifest');
  assert.deepEqual(assistantChannel(voice), { via: 'voice', session: 'call:6f1c-22' });
  assert.throws(() => portal.assistantToken(user, 'manifest', { via: 'fax' }), /not a way of talking/);
  assert.throws(() => portal.assistantToken(user, 'manifest', { via: 'sms', session: 'has a space' }), /session id/);
  assert.throws(() => portal.assistantToken(user, 'manifest', { via: 'sms', session: 'x'.repeat(101) }), /session id/);
});

test('a token with a way the platform does not know is refused', () => {
  const portal = createFakePortal();
  const user = portal.createUser(person);
  // Signed properly, but saying 'chat' out loud (which the portal never writes) or a way that does not exist.
  for (const via of ['chat', 'carrier-pigeon']) {
    const { publicKey, privateKey } = keysOf(portal);
    const [claims] = issueAssistantToken({ user, appId: 'echo', act: 'manifest', via: 'voice', privateKey }).split('.');
    const resigned = signClaims({ ...JSON.parse(Buffer.from(claims, 'base64url')), via }, privateKey);
    assert.throws(() => verifyAssistantToken(resigned, { publicKey, appId: 'echo', act: 'manifest' }), /not one of Joules/, via);
  }
});

test('each way gets its own manifest, and an action kept out of a way cannot be run from it', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    const manifest = async (via) => (await request(base, '/api/assistant', { headers: bearer(portal.assistantToken(user, 'manifest', { via })) })).data;
    assert.deepEqual((await manifest('chat')).actions.map((one) => one.name), ['who_am_i', 'add_note', 'archive_note']);
    assert.deepEqual((await manifest('voice')).actions.map((one) => one.name), ['who_am_i', 'add_note']);
    assert.deepEqual((await manifest('sms')).actions.map((one) => one.name), ['add_note']);
    assert.equal((await manifest('voice')).about, 'Echo keeps notes.');

    const fromVoice = await call(base, portal.assistantToken(user, 'preview:archive_note', { via: 'voice' }), 'archive_note', { mode: 'preview', input: {} });
    assert.equal(fromVoice.status, 404, 'archive is the chat\'s alone');
    const fromText = await call(base, portal.assistantToken(user, 'run:who_am_i', { via: 'sms' }), 'who_am_i', { mode: 'run' });
    assert.equal(fromText.status, 404);
    assert.equal((await call(base, portal.assistantToken(user, 'preview:archive_note'), 'archive_note', { mode: 'preview', input: {} })).status, 200, 'the chat still has it');
  }, { app: app() });
});

test('the action is told the way and the portal\'s session, and never a check it was not sent', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    const ask = (options, body = { mode: 'run' }) => call(base, portal.assistantToken(user, 'run:who_am_i', options), 'who_am_i', body);
    assert.deepEqual((await ask({ via: 'voice', session: 'call-1' })).data, { result: { via: 'voice', session: 'call-1', check: null } });
    assert.deepEqual((await ask({})).data, { result: { via: 'chat', session: null, check: null } });
    assert.deepEqual((await ask({ via: 'voice' }, { mode: 'run', check: 'abc' })).data.result.check, 'abc');
  }, { app: app() });
});

test('a preview\'s check comes back with the run, and the app can refuse anything else', async () => {
  seen.length = 0;
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    const preview = await call(base, portal.assistantToken(user, 'preview:add_note', { via: 'sms', session: 'sms-9' }), 'add_note', { mode: 'preview', input: { text: 'Buy milk' } });
    assert.deepEqual(preview.data, { preview: { summary: 'Add "Buy milk"', fields: [], check: 'plan-8' } });
    const run = (check, text = 'Buy milk') => call(base, portal.assistantToken(user, 'run:add_note', { via: 'sms', session: 'sms-9' }), 'add_note', { mode: 'run', input: { text }, check });
    assert.deepEqual((await run('plan-8', 'Buy bread!')).data, { error: 'That is not what you were shown.' });
    assert.deepEqual((await run(undefined)).data, { error: 'That is not what you were shown.' });
    assert.equal((await run('has space')).status, 400, 'a check is printable text with no spaces');
    assert.equal((await run('x'.repeat(129))).status, 400);
    assert.equal((await run(42)).status, 400);
    assert.deepEqual(seen, []);
    assert.deepEqual((await run('plan-8')).data, { done: { summary: 'Note added' } });
    assert.deepEqual(seen, [{ user: user.id, text: 'Buy milk', via: 'sms', session: 'sms-9' }]);
  }, { app: app() });
});

test('the checks on channels and on a preview\'s check', () => {
  assert.doesNotThrow(() => checkAssistant(ASSISTANT, 'echo'));
  assert.throws(() => checkAssistant({ ...ASSISTANT, channels: { email: [] } }, 'echo'), /the ways are voice and sms/);
  assert.throws(() => checkAssistant({ ...ASSISTANT, channels: { chat: [] } }, 'echo'), /assistant\.actions/);
  assert.throws(() => checkAssistant({ ...ASSISTANT, channels: { voice: 'all' } }, 'echo'), /channels\.voice must be a list/);
  assert.throws(() => checkAssistant({ ...ASSISTANT, channels: { sms: [note('add_note'), note('add_note')] } }, 'echo'), /assistant sms action add_note: the name is used twice/);
  assert.throws(() => checkAssistant({ ...ASSISTANT, channels: { voice: Array.from({ length: 21 }, (_, i) => note(`note_${i}`)) } }, 'echo'), /more than 20 actions/);
  assert.throws(() => checkAssistant({ ...ASSISTANT, channels: { voice: [{ ...archive, preview: undefined }] } }, 'echo'), /needs a preview function/);
  assert.throws(() => checkAssistant({ ...ASSISTANT, channels: [] }, 'echo'), /channels must be an object/);

  assert.deepEqual(shapeOutcome('write', 'preview', { summary: 'x', check: 'abc123' }), { preview: { summary: 'x', fields: [], check: 'abc123' } });
  assert.deepEqual(shapeOutcome('write', 'preview', { summary: 'x' }), { preview: { summary: 'x', fields: [] } });
  assert.throws(() => shapeOutcome('write', 'preview', { summary: 'x', check: 'a b' }), /check must be printable/);
  assert.throws(() => shapeOutcome('write', 'preview', { summary: 'x', check: 7 }), /check must be printable/);
  assert.equal('check' in shapeOutcome('write', 'run', { summary: 'x', check: 'abc' }).done, false, 'a run never answers a check');
  assert.deepEqual(readCheck(undefined), { value: null });
  assert.deepEqual(readCheck('sha256:ab'), { value: 'sha256:ab' });
  assert.match(readCheck('').error, /check/);
});
