import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addContracts, agigResponse, dayLines, publish, quietly, withApp } from './support.js';

// Reading AGIG's response emails with Microsoft Graph, against a fake Graph: no test reaches the network.

const MAIL = {
  NOM_MAIL_TENANT_ID: 'tenant-1',
  NOM_MAIL_CLIENT_ID: 'client-1',
  NOM_MAIL_CLIENT_SECRET: 'not-a-real-secret',
  NOM_MAIL_MAILBOX: 'b2b-responses@example.com',
  NOM_MAIL_AGIG_SENDER: 'tbs@agig.example',
};

function fakeGraph(messages) {
  const calls = [];
  const moved = new Map();
  const fetch = async (url, options = {}) => {
    const method = options.method ?? 'GET';
    calls.push(`${method} ${url}`);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.startsWith('https://login.microsoftonline.com/tenant-1/')) return json({ access_token: 'token-1', expires_in: 3600 });
    assert.equal(options.headers.Authorization, 'Bearer token-1');
    const path = decodeURIComponent(new URL(url).pathname + new URL(url).search);
    if (path.includes('/mailFolders/inbox/messages')) {
      assert.match(path, /isRead eq false and from\/emailAddress\/address eq 'tbs@agig.example'/);
      return json({ value: messages.filter((message) => !moved.has(message.id)) });
    }
    const attachments = /\/messages\/([^/]+)\/attachments$/.exec(path);
    if (attachments) return json({ value: messages.find((message) => message.id === attachments[1]).attachments });
    if (path.includes('/mailFolders?$filter')) return json({ value: [] });
    if (path.endsWith('/mailFolders') && method === 'POST') return json({ id: `folder-${JSON.parse(options.body).displayName}` }, 201);
    const move = /\/messages\/([^/]+)\/move$/.exec(path);
    if (move) {
      moved.set(move[1], JSON.parse(options.body).destinationId);
      return json({ id: move[1] }, 201);
    }
    if (method === 'PATCH') return json({});
    throw new Error(`Unexpected Graph call ${method} ${path}`);
  };
  return { fetch, calls, moved };
}

const email = (id, fileName, subject = '[SHNOM – Success]', extra = {}) => ({
  id, subject, receivedDateTime: '2026-11-16T02:10:00Z', from: { emailAddress: { address: 'tbs@agig.example' } }, hasAttachments: true,
  attachments: [{ '@odata.type': '#microsoft.graph.fileAttachment', name: 'SHNOM_Success_20261116101000.csv', contentBytes: Buffer.from(agigResponse(fileName, extra)).toString('base64') }],
});

test('the mailbox job records each AGIG email once, then files it in Processed or Review', async () => {
  let fileName = null;
  const messages = [];
  const graph = fakeGraph(messages);
  await withApp(async ({ ops, app }) => {
    await addContracts(ops);
    const { data } = await publish(ops, dayLines());
    await ops.call(`/batches/${data.batch.id}/uploaded`, { method: 'POST' });
    fileName = (await ops.call(`/batches/${data.batch.id}`)).data.file.fileName;
    messages.push(email('msg-1', fileName), email('msg-2', 'SHNOM_Unknown_1.csv'));

    await app.mailbox.poll(app);
    assert.equal((await ops.call(`/batches/${data.batch.id}`)).data.batch.status, 'ACCEPTED');
    assert.equal(graph.moved.get('msg-1'), 'folder-Processed');
    assert.equal(graph.moved.get('msg-2'), 'folder-Review', 'one we did not send waits for a person');
    const responses = (await ops.call('/responses')).data.responses;
    assert.deepEqual(responses.map((response) => [response.messageId, response.matchState, response.sender]), [
      ['msg-2', 'UNMATCHED', 'tbs@agig.example'],
      ['msg-1', 'MATCHED', 'tbs@agig.example'],
    ]);
    const status = (await ops.call('/system')).data.mailbox;
    assert.equal(status.configured, true);
    assert.equal(status.recorded, 2);
    assert.equal(status.lastError, null);
    assert.equal(JSON.stringify(status).includes('not-a-real-secret'), false, 'the secret never leaves the server');

    await app.mailbox.poll(app);
    assert.equal((await ops.call('/responses')).data.responses.length, 2, 'nothing is recorded twice');
    assert.equal(graph.calls.filter((call) => call.startsWith('POST https://login')).length, 1, 'the token is kept until it expires');
  }, { env: MAIL, fetch: graph.fetch });
});

test('a mailbox that keeps failing raises an alert, and the page can ask for a check', async () => {
  const fetch = async () => new Response('{}', { status: 503 });
  await withApp(async ({ ops, app, viewer }) => {
    for (let attempt = 0; attempt < 3; attempt += 1) await assert.rejects(app.mailbox.poll(app), /answered 503/);
    const alert = (await ops.call('/alerts')).data.alerts.find((item) => item.type === 'MAILBOX');
    assert.match(alert.message, /could not be read 3 times/);
    assert.equal((await viewer.call('/mailbox/check', { method: 'POST' })).status, 403);
    const memory = await ops.call('/mailbox/check', { method: 'POST' });
    assert.equal(memory.status, 503, 'the mailbox is read only on a real database');
  }, { env: MAIL, fetch });
});

test('the mailbox settings are all or nothing', async () => {
  await quietly(async () => {
    await assert.rejects(
      withApp(async () => {}, { env: { NOM_MAIL_TENANT_ID: 'tenant-1' } }),
      /needs all of NOM_MAIL_TENANT_ID, NOM_MAIL_CLIENT_ID, NOM_MAIL_CLIENT_SECRET, NOM_MAIL_MAILBOX/,
    );
  });
});
