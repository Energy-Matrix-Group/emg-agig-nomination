import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ASSISTANT_MESSAGES } from '../../server/platform/assistant.js';
import { createAppServer } from '../../server/platform/create-server.js';
import { httpError } from '../../server/platform/kit.js';
import { createFakePortal } from './support/fake-portal.js';
import { createFixtureApp } from './support/fixture-app.js';
import { postCallback, request, signIn, withPlatformServer } from './support/server.js';

// Joules, the portal's helper, acting for a person in an app: the door every app has (server/platform/assistant.js).

let warn;
before(() => {
  warn = console.warn;
  console.warn = (line, ...rest) => { if (!/^(Joules refused|Sign-in refused)/.test(String(line))) warn(line, ...rest); };
});
after(() => {
  console.warn = warn;
});

const person = { email: 'sam@energymatrix.com.au', displayName: 'Sam Lee', isPortalAdmin: false };
const seen = [];
const ASSISTANT = {
  about: 'Echo keeps notes. Joules can list them and add one.',
  actions: [
    {
      name: 'list_notes',
      kind: 'read',
      title: 'Your notes',
      description: 'Lists the person\'s notes.',
      input: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 20 } } },
      run: async ({ user, input, app }) => ({ for: user, limit: input.limit ?? 5, greeting: app.greeting }),
    },
    {
      name: 'add_note',
      kind: 'write',
      title: 'Add a note',
      description: 'Adds a note.',
      input: { type: 'object', properties: { text: { type: 'string', maxLength: 40 }, colour: { type: 'string', maxLength: 10, enum: ['red', 'blue'] } }, required: ['text'] },
      preview: async ({ input }) => ({ summary: `Add the note "${input.text}"`, fields: [{ label: 'Note', value: input.text }] }),
      run: async ({ user, input }) => {
        if (input.text === 'forbidden') throw httpError(403, 'You cannot add that note.');
        seen.push({ user: user.id, text: input.text });
        return { summary: 'Note added', ref: 'N-1', path: '/notes/1' };
      },
    },
    {
      name: 'bad_path',
      kind: 'write',
      title: 'A bug',
      description: 'Answers a link to another site.',
      input: { type: 'object', properties: {} },
      preview: async () => ({ summary: 'Nothing' }),
      run: async () => ({ summary: 'Done', path: '//evil.example/' }),
    },
  ],
};

const app = (options = {}) => createFixtureApp({ assistant: ASSISTANT, ...options });
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const call = (base, token, action, body) => request(base, `/api/assistant/${action}`, { method: 'POST', headers: token ? bearer(token) : {}, body });

test('the portal can ask what Joules can do here, and nobody else can', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    const manifest = await request(base, '/api/assistant', { headers: bearer(portal.assistantToken(user, 'manifest')) });
    assert.equal(manifest.status, 200);
    assert.deepEqual(manifest.data.app, { id: 'echo', name: 'Echo', description: 'Fixture app for platform tests.' });
    assert.equal(manifest.data.about, ASSISTANT.about);
    assert.deepEqual(manifest.data.actions.map((action) => [action.name, action.kind]), [['list_notes', 'read'], ['add_note', 'write'], ['bad_path', 'write']]);
    assert.deepEqual(manifest.data.actions[1].input, ASSISTANT.actions[1].input);
    assert.ok(manifest.data.actions.every((action) => !('run' in action) && !('preview' in action)));

    assert.equal((await request(base, '/api/assistant')).status, 401, 'no token');
    const cookie = await signIn(base, portal, user);
    assert.deepEqual((await request(base, '/api/assistant', { cookie })).data, { error: ASSISTANT_MESSAGES.refused }, 'a browser session is never enough');
    assert.equal((await request(base, '/api/assistant', { headers: bearer(portal.assistantToken(user, 'manifest', { app: 'other' })) })).status, 401, 'a token for another app');
    assert.equal((await request(base, '/api/assistant', { headers: bearer(portal.assistantToken(user, 'run:list_notes')) })).status, 401, 'a token for something else');
    assert.equal((await request(base, '/api/assistant', { headers: bearer(portal.token(user)) })).status, 401, 'a sign-in token');
    assert.equal((await request(base, '/api/assistant', { headers: bearer(portal.assistantToken(user, 'manifest', { now: Date.now() - 120_000 })) })).status, 401, 'an old one');
    const once = portal.assistantToken(user, 'manifest');
    assert.equal((await request(base, '/api/assistant', { headers: bearer(once) })).status, 200);
    assert.equal((await request(base, '/api/assistant', { headers: bearer(once) })).status, 401, 'each token is used once');
  }, { app: app() });
});

test('an app that says nothing about Joules still answers, with its description and nothing to do', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    const manifest = await request(base, '/api/assistant', { headers: bearer(portal.assistantToken(user, 'manifest')) });
    assert.deepEqual(manifest.data, { app: { id: 'echo', name: 'Echo', description: 'Fixture app for platform tests.' }, about: 'Fixture app for platform tests.', actions: [] });
    assert.equal((await call(base, portal.assistantToken(user, 'run:list_notes'), 'list_notes', { mode: 'run' })).status, 404);
  });
});

test('Joules\'s token can never sign anyone in, and a sign-in token can never act as Joules', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    for (const act of ['manifest', 'run:list_notes', 'preview:add_note']) {
      const result = await postCallback(base, { token: portal.assistantToken(user, act), next: '/' });
      assert.equal(result.status, 400, act);
      assert.deepEqual(result.setCookie, []);
    }
    assert.equal((await call(base, portal.token(user), 'list_notes', { mode: 'run' })).status, 401);
  }, { app: app() });
});

test('a read action runs as the person the token names, with its input checked first', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser({ ...person, isPortalAdmin: true });
    const run = (input) => call(base, portal.assistantToken(user, 'run:list_notes'), 'list_notes', { mode: 'run', input });
    const ok = await run({ limit: 3 });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data, { result: { for: { id: user.id, email: user.email, displayName: 'Sam Lee', isPortalAdmin: true, role: null }, limit: 3, greeting: 'hello' } });
    const executive = portal.createUser({ ...person, email: 'exec@energymatrix.com.au', role: 'executive' });
    assert.equal((await call(base, portal.assistantToken(executive, 'run:list_notes'), 'list_notes', { mode: 'run', input: {} })).data.result.for.role, 'executive', 'Joules acts with the person\'s role too');
    assert.equal((await run()).data.result.limit, 5, 'no input is an empty one');
    assert.deepEqual((await run({ limit: 50 })).data, { error: '"limit" must be at most 20.' });
    assert.deepEqual((await run({ limit: 2.5 })).data, { error: '"limit" must be a whole number.' });
    assert.deepEqual((await run({ who: 'else' })).data, { error: '"who" is not something this action takes.' });
    assert.deepEqual((await run('nonsense')).data, { error: 'The input must be an object.' });
    const preview = await call(base, portal.assistantToken(user, 'preview:list_notes'), 'list_notes', { mode: 'preview' });
    assert.deepEqual(preview, { ...preview, status: 400, data: { error: ASSISTANT_MESSAGES.mode } }, 'a read has no preview');
    assert.equal((await call(base, portal.assistantToken(user, 'run:list_notes'), 'list_notes', { mode: 'sideways' })).status, 400);
    assert.equal((await call(base, portal.assistantToken(user, 'run:nothing_here'), 'nothing_here', { mode: 'run' })).status, 404);
    assert.equal((await call(base, null, 'nothing_here', { mode: 'run' })).status, 401, 'without a token nothing is said about what is there');
  }, { app: app() });
});

test('a write action previews without changing anything, and runs only with a token to run it', async () => {
  seen.length = 0;
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    const preview = await call(base, portal.assistantToken(user, 'preview:add_note'), 'add_note', { mode: 'preview', input: { text: 'Buy milk' } });
    assert.deepEqual(preview.data, { preview: { summary: 'Add the note "Buy milk"', fields: [{ label: 'Note', value: 'Buy milk' }] } });
    assert.deepEqual(seen, [], 'a preview changes nothing');
    assert.equal((await call(base, portal.assistantToken(user, 'preview:add_note'), 'add_note', { mode: 'run', input: { text: 'Buy milk' } })).status, 401, 'a preview token cannot run it');
    const done = await call(base, portal.assistantToken(user, 'run:add_note'), 'add_note', { mode: 'run', input: { text: 'Buy milk', colour: 'red' } });
    assert.deepEqual(done.data, { done: { summary: 'Note added', ref: 'N-1', path: '/notes/1' } });
    assert.deepEqual(seen, [{ user: user.id, text: 'Buy milk' }]);
    assert.deepEqual((await call(base, portal.assistantToken(user, 'run:add_note'), 'add_note', { mode: 'run', input: { colour: 'red' } })).data, { error: '"text" is needed.' });
    assert.deepEqual((await call(base, portal.assistantToken(user, 'run:add_note'), 'add_note', { mode: 'run', input: { text: 'x', colour: 'green' } })).data, { error: '"colour" must be one of: red, blue.' });
    assert.deepEqual((await call(base, portal.assistantToken(user, 'run:add_note'), 'add_note', { mode: 'run', input: { text: 'forbidden' } })).data, { error: 'You cannot add that note.' }, 'the app\'s own refusals come through');
    const errors = console.error;
    console.error = () => {};
    try {
      const bug = await call(base, portal.assistantToken(user, 'run:bad_path'), 'bad_path', { mode: 'run', input: {} });
      assert.equal(bug.status, 500, 'a link to another site is a bug in the app, never passed on');
      assert.doesNotMatch(bug.text, /evil/);
    } finally {
      console.error = errors;
    }
  }, { app: app() });
});

test('an app on its memory fallback takes no changes from Joules, but still answers what it can read', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    const write = await call(base, portal.assistantToken(user, 'preview:add_note'), 'add_note', { mode: 'preview', input: { text: 'Buy milk' } });
    assert.deepEqual(write, { ...write, status: 503, data: { error: ASSISTANT_MESSAGES.noDatabase } });
    assert.equal((await call(base, portal.assistantToken(user, 'run:list_notes'), 'list_notes', { mode: 'run' })).status, 200);
  }, { app: app({ setup: async () => ({ greeting: 'hi', databaseConnected: false }) }) });
});

test('wrong tokens are limited, and then even a right one waits', async () => {
  await withPlatformServer(async ({ base, portal }) => {
    const user = portal.createUser(person);
    for (let attempt = 0; attempt < 3; attempt += 1) assert.equal((await request(base, '/api/assistant', { headers: bearer('nope.nope') })).status, 401);
    const blocked = await request(base, '/api/assistant', { headers: bearer(portal.assistantToken(user, 'manifest')) });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  }, { app: app(), rateLimits: { tokenPerClient: 3, tokenTotal: 100 } });
});

test('an app whose assistant export cannot be served does not start, and says why', () => {
  const portal = createFakePortal();
  const start = (assistant) => createAppServer({ app: createFixtureApp({ assistant }), env: portal.env(), directory: portal.directory });
  assert.throws(() => start({ about: '', actions: [] }), /assistant\.about must be text/);
  assert.throws(() => start({ about: 'x', actions: [{ name: 'Do It', kind: 'read', title: 't', description: 'd', input: { type: 'object', properties: {} }, run() {} }] }), /name must be lower case/);
  assert.throws(() => start({ about: 'x', actions: [{ name: 'add', kind: 'write', title: 't', description: 'd', input: { type: 'object', properties: {} }, run() {} }] }), /needs a preview function/);
  assert.throws(() => start({ about: 'x', actions: [{ name: 'find', kind: 'read', title: 't', description: 'd', input: { type: 'object', properties: { q: { type: 'string' } } }, run() {} }] }), /maxLength is needed/);
  assert.throws(() => start({ about: 'x', actions: [{ name: 'find', kind: 'read', title: 't', description: 'd', input: { type: 'object', properties: { q: { type: 'string', maxLength: 9, pattern: '.*' } } }, run() {} }] }), /"pattern" is not supported/);
  assert.throws(() => start({ about: 'x', actions: [{ name: 'find', kind: 'read', title: 't', description: 'd', input: { type: 'object', properties: {}, additionalProperties: true }, run() {} }] }), /"additionalProperties", which is not supported/);
  assert.throws(() => createAppServer({ app: createFixtureApp({ id: 'assistant' }), env: portal.env({ APP_ID: 'assistant' }), directory: portal.directory }), /belongs to the platform/, '/api/assistant is the platform\'s');
});
