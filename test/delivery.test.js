import assert from 'node:assert/strict';
import { test } from 'node:test';
import { watchdog } from '../server/app/watchdog.js';
import { addContracts, agigResponse, dayLines, publish, withApp } from './support.js';

// Sending a file to AGIG and recording its answer: by hand, and by the upload agent on the office VM.

async function sentBatch(ops) {
  await addContracts(ops);
  const { data } = await publish(ops, dayLines());
  const uploaded = await ops.call(`/batches/${data.batch.id}/uploaded`, { method: 'POST' });
  assert.equal(uploaded.data.batch.status, 'UPLOADED');
  const detail = await ops.call(`/batches/${data.batch.id}`);
  return { id: data.batch.id, fileName: detail.data.file.fileName };
}

const answer = (ops, text, fileName = 'response.csv') => ops.call('/responses', { method: 'POST', body: { fileName, text } });

test('marked as uploaded by hand, then AGIG says Success: the batch is accepted and the Gas Day goes green', async () => {
  await withApp(async ({ ops }) => {
    const { id, fileName } = await sentBatch(ops);
    const board = await ops.call('/board');
    assert.equal(board.data.days.find((day) => day.gasDay === '2026-11-17').colour, 'blue');

    const recorded = await answer(ops, agigResponse(fileName));
    assert.equal(recorded.status, 201);
    assert.equal(recorded.data.status, 'ACCEPTED');
    const detail = await ops.call(`/batches/${id}`);
    assert.equal(detail.data.batch.status, 'ACCEPTED');
    assert.equal(detail.data.file.status, 'RESPONDED');
    assert.equal(detail.data.responses[0].matchState, 'MATCHED');
    assert.deepEqual(detail.data.timeline.map((step) => Boolean(step.at)), [true, true, true, true, true, true]);
    const day = (await ops.call('/board')).data.days.find((card) => card.gasDay === '2026-11-17');
    assert.equal(day.colour, 'green');
    assert.deepEqual(day.held, { lines: 3, inletTJ: '20.000', outletTJ: '19.750' });

    const again = await answer(ops, agigResponse(fileName));
    assert.equal(again.status, 409, 'the same response twice is recorded once');
  });
});

test('AGIG says Failure: each error is pinned to its line and decoded, and an alert is raised', async () => {
  await withApp(async ({ ops }) => {
    const { id, fileName } = await sentBatch(ops);
    // CSV line 3 is the second nomination line (line 1 is the header). Two errors on one line are joined with |.
    await answer(ops, agigResponse(fileName, { status: 'Failure', errors: [[3, '507|522', 'Invalid Outlet Point|Total Outlet Nominated greater than contract capacity']] }));
    const detail = await ops.call(`/batches/${id}`);
    assert.equal(detail.data.batch.status, 'REJECTED');
    const row = detail.data.rows.find((candidate) => candidate.csvLineNumber === 3);
    assert.equal(row.designation, 'OS5-01');
    assert.deepEqual(row.agigErrors.map((error) => [error.errorCode, error.meaning]), [
      ['507', 'Invalid Outlet Point (combination of Contract: Inlet Designation: Pipeline: Customer)'],
      ['522', 'Total Outlet Nominated greater than contract capacity'],
    ]);
    const alerts = (await ops.call('/alerts')).data.alerts;
    assert.ok(alerts.some((alert) => alert.type === 'REJECTED' && alert.entityId === id && /507, 522/.test(alert.message)));
    assert.ok(alerts.some((alert) => alert.type === 'REFERENCE'), 'a 507 suggests the reference data may not match AGIG');
    assert.equal((await ops.call('/board')).data.days.find((day) => day.gasDay === '2026-11-17').colour, 'red');
  });
});

test('a response that cannot be read, or names a file we never sent, waits for a person', async () => {
  await withApp(async ({ ops }) => {
    const { id, fileName } = await sentBatch(ops);
    const truncated = await answer(ops, 'Filename,x.csv\r\nStatus,Success\r\n');
    assert.match(truncated.data.problem, /no End row/);
    const stranger = await answer(ops, agigResponse('SHNOM_Renamed_1.csv', { status: 'Success' }), 'other.csv');
    assert.equal(stranger.data.unmatched, true);
    const list = (await ops.call('/responses')).data.responses;
    assert.deepEqual(list.map((response) => response.matchState), ['UNMATCHED', 'UNPARSEABLE']);

    const linked = await ops.call(`/responses/${stranger.data.response.id}/link`, { method: 'POST', body: { fileName } });
    assert.equal(linked.status, 200);
    assert.equal((await ops.call(`/batches/${id}`)).data.batch.status, 'ACCEPTED');
    assert.equal((await ops.call('/responses')).data.responses[0].matchState, 'MANUAL');
    assert.equal((await ops.call(`/responses/${truncated.data.response.id}/link`, { method: 'POST', body: { fileName } })).status, 409);
  });
});

test('no answer within the timeout: NO_RESPONSE, an alert, never assumed accepted; a late answer still counts', async () => {
  await withApp(async ({ ops, clock, app }) => {
    const { id, fileName } = await sentBatch(ops);
    clock.advance(19);
    await watchdog(app);
    assert.equal((await ops.call(`/batches/${id}`)).data.batch.status, 'UPLOADED');
    clock.advance(1);
    await watchdog(app);
    assert.equal((await ops.call(`/batches/${id}`)).data.batch.status, 'NO_RESPONSE');
    assert.ok((await ops.call('/alerts')).data.alerts.some((alert) => alert.type === 'NO_RESPONSE' && alert.entityId === id));

    await answer(ops, agigResponse(fileName));
    assert.equal((await ops.call(`/batches/${id}`)).data.batch.status, 'ACCEPTED');
    assert.ok(!(await ops.call('/alerts')).data.alerts.some((alert) => alert.type === 'NO_RESPONSE'), 'the alert clears when the answer comes');
  });
});

test('settling a file with no answer after checking the TBS portal', async () => {
  await withApp(async ({ ops, clock, app }) => {
    const { id } = await sentBatch(ops);
    assert.equal((await ops.call(`/batches/${id}/resolve`, { method: 'POST', body: { outcome: 'accepted' } })).status, 409, 'only once there is no answer');
    clock.advance(30);
    await watchdog(app);
    const bad = await ops.call(`/batches/${id}/resolve`, { method: 'POST', body: { outcome: 'maybe' } });
    assert.equal(bad.status, 400);
    const settled = await ops.call(`/batches/${id}/resolve`, { method: 'POST', body: { outcome: 'accepted', note: 'Seen as accepted in the TBS portal' } });
    assert.equal(settled.data.batch.status, 'ACCEPTED');
    const detail = await ops.call(`/batches/${id}`);
    assert.equal(detail.data.audit[0].action, 'batch.resolve-accepted');
    assert.equal(detail.data.audit[0].detail, 'Seen as accepted in the TBS portal');
  });
});

test('the upload agent: one file at a time, its outcome recorded, and only with its token', async () => {
  await withApp(async ({ ops, base }) => {
    await addContracts(ops);
    const first = await publish(ops, dayLines());
    const second = await publish(ops, dayLines('2026-11-18'));
    const agent = (path, body) => fetch(`${base}/api/agig-nomination${path}`, {
      method: 'POST', headers: { Authorization: 'Bearer agent-secret-1234567890', 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
    }).then(async (response) => ({ status: response.status, data: await response.json() }));

    assert.equal((await ops.call('/agent/claim', { method: 'POST' })).status, 403, 'a person, even in the ops team, is refused');
    const wrong = await fetch(`${base}/api/agig-nomination/agent/claim`, { method: 'POST', headers: { Authorization: 'Bearer nope' } });
    assert.equal(wrong.status, 401);

    const claimed = await agent('/agent/claim');
    assert.equal(claimed.status, 200);
    assert.equal(claimed.data.file.batchId, first.data.batch.id);
    const bytes = Buffer.from(claimed.data.file.body, 'base64');
    assert.match(bytes.toString('utf8'), /^Gas Day,Shipper,/);
    assert.equal((await ops.call(`/batches/${first.data.batch.id}`)).data.batch.status, 'UPLOADING');

    assert.equal((await agent('/agent/claim')).data.file, null, 'nothing else while a file is being sent');
    const done = await agent(`/agent/files/${claimed.data.file.id}`, { outcome: 'uploaded', remoteSize: bytes.length });
    assert.equal(done.data.recorded, 'uploaded');
    assert.equal((await ops.call(`/batches/${first.data.batch.id}`)).data.batch.status, 'UPLOADED');
    const waiting = await agent('/agent/claim');
    assert.equal(waiting.data.file, null, 'the next file waits for AGIG to answer the first');
    assert.match(waiting.data.waitingFor, /^SHNOM_/);

    const fileName = (await ops.call(`/batches/${first.data.batch.id}`)).data.file.fileName;
    await answer(ops, agigResponse(fileName));
    const next = await agent('/agent/claim');
    assert.equal(next.data.file.batchId, second.data.batch.id);
    const failed = await agent(`/agent/files/${next.data.file.id}`, { outcome: 'uncertain', error: 'Connection reset during transfer' });
    assert.equal(failed.data.recorded, 'uncertain');
    const detail = await ops.call(`/batches/${second.data.batch.id}`);
    assert.equal(detail.data.batch.status, 'UPLOAD_UNCERTAIN');
    assert.equal(detail.data.actions.resolve, true);
    assert.ok((await ops.call('/alerts')).data.alerts.some((alert) => alert.type === 'UPLOAD_UNCERTAIN'));
    const again = await ops.call(`/batches/${second.data.batch.id}/resolve`, { method: 'POST', body: { outcome: 'send-again' } });
    assert.equal(again.data.batch.status, 'BUILT');
  }, { env: { NOM_AGENT_TOKEN: 'agent-secret-1234567890' } });
});

test('a size that does not match what was sent is never taken as uploaded', async () => {
  await withApp(async ({ ops, base }) => {
    await addContracts(ops);
    await publish(ops, dayLines());
    const call = (path, body) => fetch(`${base}/api/agig-nomination${path}`, {
      method: 'POST', headers: { Authorization: 'Bearer agent-secret-1234567890', 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
    }).then((response) => response.json());
    const { file } = await call('/agent/claim');
    assert.equal((await call(`/agent/files/${file.id}`, { outcome: 'uploaded', remoteSize: 3 })).recorded, 'uncertain');
  }, { env: { NOM_AGENT_TOKEN: 'agent-secret-1234567890' } });
});
