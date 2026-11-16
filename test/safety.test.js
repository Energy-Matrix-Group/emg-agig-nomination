import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postNewAlerts, startTeams } from '../server/app/teams.js';
import { watchdog } from '../server/app/watchdog.js';
import { addContracts, agigResponse, dayLines, publish, TOMORROW, withApp } from './support.js';

// The rules that keep the wrong numbers away from AGIG: old numbers never follow newer ones, nothing goes after its
// cutoff, nothing goes twice, and AGIG's own answer outranks a guess. Each test here was written against a case
// an independent review found (16 November 2026).

const TOKEN = 'agent-secret-1234567890';
const AGENT = { env: { NOM_AGENT_TOKEN: TOKEN } };

function agent(base) {
  return (path, body) => fetch(`${base}/api/agig-nomination${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
  }).then(async (response) => ({ status: response.status, data: await response.json() }));
}

async function acceptBatch(ops, id) {
  await ops.call(`/batches/${id}/uploaded`, { method: 'POST' });
  const fileName = (await ops.call(`/batches/${id}`)).data.file.fileName;
  await ops.call('/responses', { method: 'POST', body: { fileName: `r${id}.csv`, text: agigResponse(fileName) } });
}

const status = async (ops, id) => (await ops.call(`/batches/${id}`)).data.batch.status;

test('going back to the numbers AGIG holds sets aside the batch that was waiting, and sends nothing', async () => {
  await withApp(async ({ ops }) => {
    await addContracts(ops);
    const held = await publish(ops, dayLines());
    await acceptBatch(ops, held.data.batch.id);
    const changed = await publish(ops, dayLines(TOMORROW, { kemerton: '12' }));
    assert.equal(changed.data.batch.status, 'BUILT');
    const back = await publish(ops, dayLines());
    assert.equal(back.data.batch.status, 'DUPLICATE');
    assert.equal(await status(ops, changed.data.batch.id), 'SUPERSEDED', 'the changed numbers must not go after all');
  });
});

test('the same numbers again are sent while another file for the day is with AGIG', async () => {
  await withApp(async ({ ops }) => {
    await addContracts(ops);
    const held = await publish(ops, dayLines());
    await acceptBatch(ops, held.data.batch.id);
    const changed = await publish(ops, dayLines(TOMORROW, { kemerton: '12' }));
    await ops.call(`/batches/${changed.data.batch.id}/uploaded`, { method: 'POST' });
    const back = await publish(ops, dayLines());
    assert.equal(back.data.batch.status, 'BUILT', 'AGIG may hold the changed numbers once it answers');
  });
});

test('a duplicate is judged day by day against what AGIG holds, not against one earlier batch', async () => {
  await withApp(async ({ ops }) => {
    await addContracts(ops);
    const both = await publish(ops, [...dayLines(TOMORROW), ...dayLines('2026-11-18')]);
    await acceptBatch(ops, both.data.batch.id);
    const later = await publish(ops, dayLines('2026-11-18', { kemerton: '12' }));
    await acceptBatch(ops, later.data.batch.id);
    const again = await publish(ops, [...dayLines(TOMORROW), ...dayLines('2026-11-18')]);
    assert.equal(again.data.batch.status, 'BUILT', 'AGIG holds the later numbers for the 18th, so these are a change');
  });
});

test('a corrected service type is a change even with the same quantities', async () => {
  await withApp(async ({ ops }) => {
    const { transport } = await addContracts(ops);
    const first = await publish(ops, dayLines());
    await acceptBatch(ops, first.data.batch.id);
    await ops.call(`/contracts/${transport.id}`, { method: 'PUT', body: { ...transport, serviceType: 'P1' } });
    const again = await publish(ops, dayLines());
    assert.equal(again.data.batch.status, 'BUILT');
  });
});

test('an uncertain upload is not sent again once a newer batch has the newer numbers', async () => {
  await withApp(async ({ ops, base }) => {
    await addContracts(ops);
    const call = agent(base);
    const old = await publish(ops, dayLines());
    const { data } = await call('/agent/claim');
    await call(`/agent/files/${data.file.id}`, { outcome: 'uncertain', error: 'Connection reset' });
    const newer = await publish(ops, dayLines(TOMORROW, { kemerton: '12' }));
    const again = await ops.call(`/batches/${old.data.batch.id}/resolve`, { method: 'POST', body: { outcome: 'send-again' } });
    assert.equal(again.status, 409);
    assert.match(again.data.error, new RegExp(`Batch ${newer.data.batch.id}, published later`));
    assert.equal(await status(ops, old.data.batch.id), 'UPLOAD_UNCERTAIN');
  }, AGENT);
});

test('a file the agent could not send is set aside, not retried, once a newer batch is published', async () => {
  await withApp(async ({ ops, base }) => {
    await addContracts(ops);
    const call = agent(base);
    const old = await publish(ops, dayLines());
    const { data } = await call('/agent/claim');
    const newer = await publish(ops, dayLines(TOMORROW, { kemerton: '12' }));
    assert.equal(newer.data.batch.status, 'BUILT');
    const result = await call(`/agent/files/${data.file.id}`, { outcome: 'not-sent', error: 'Host unreachable' });
    assert.equal(result.data.recorded, 'superseded');
    assert.equal(await status(ops, old.data.batch.id), 'SUPERSEDED');
    assert.equal((await call('/agent/claim')).data.file.batchId, newer.data.batch.id, 'only the newer file goes');
  }, AGENT);
});

test('a file the agent keeps retrying is not taken for a stuck upload', async () => {
  await withApp(async ({ ops, base, app, clock }) => {
    await addContracts(ops);
    const call = agent(base);
    const { data: published } = await publish(ops, dayLines());
    for (let minute = 0; minute < 12; minute += 1) {
      const { data } = await call('/agent/claim');
      await watchdog(app); // the watchdog sees the file each time it is being tried
      await call(`/agent/files/${data.file.id}`, { outcome: 'not-sent', error: 'Host unreachable' });
      clock.advance(1);
    }
    assert.equal(await status(ops, published.batch.id), 'BUILT', 'each try starts its own 10 minutes');
    const { data } = await call('/agent/claim');
    clock.advance(11);
    await watchdog(app);
    assert.equal(await status(ops, published.batch.id), 'UPLOAD_UNCERTAIN', 'a try that never reports back is still caught');
    assert.equal((await call(`/agent/files/${data.file.id}`, { outcome: 'uploaded', remoteSize: 1 })).status, 409);
  }, AGENT);
});

test('a file past its 20:00 cutoff is never handed out: an alert asks for it to be cancelled, and the day is red', async () => {
  await withApp(async ({ ops, base, app, clock }) => {
    await addContracts(ops);
    const { data } = await publish(ops, dayLines());
    clock.set('2026-11-17T12:01:00Z'); // 20:01 AWST on the Gas Day
    assert.equal((await agent(base)('/agent/claim')).data.file, null);
    await watchdog(app);
    const late = (await ops.call('/alerts')).data.alerts.find((alert) => alert.type === 'LATE');
    assert.equal(late.entityId, data.batch.id);
    const card = (await ops.call('/board')).data.days.find((day) => day.gasDay === TOMORROW);
    assert.deepEqual([card.colour, card.label], ['red', 'Cutoff passed, nothing accepted']);
    clock.advance(11); // the agent has gone quiet, so it can be recorded by hand
    const marked = await ops.call(`/batches/${data.batch.id}/uploaded`, { method: 'POST' });
    assert.match(marked.data.warnings.join(' '), /20:00 cutoff for 2026-11-17 has passed/, 'by hand it can still be recorded, with a warning');
  }, AGENT);
});

test('a file whose cutoff is close goes ahead of an older one that can wait', async () => {
  await withApp(async ({ ops, base, clock }) => {
    await addContracts(ops);
    const call = agent(base);
    await publish(ops, dayLines('2026-11-19'));
    const first = await call('/agent/claim');
    await call(`/agent/files/${first.data.file.id}`, { outcome: 'uploaded', remoteSize: first.data.file.size });
    const later = await publish(ops, dayLines('2026-11-20'));
    clock.set('2026-11-16T05:20:00Z'); // 13:20 AWST: 40 minutes to tomorrow's initial cutoff
    const urgent = await publish(ops, dayLines(TOMORROW), { confirmWarnings: true });
    const next = await call('/agent/claim');
    assert.equal(next.data.file.batchId, urgent.data.batch.id);
    assert.equal(await status(ops, later.data.batch.id), 'BUILT', 'the one that can wait, waits');
  }, AGENT);
});

test('AGIG\'s answer outranks a batch settled by hand, with an alert when they disagree', async () => {
  await withApp(async ({ ops, app, clock }) => {
    await addContracts(ops);
    const { data } = await publish(ops, dayLines());
    await ops.call(`/batches/${data.batch.id}/uploaded`, { method: 'POST' });
    clock.advance(30);
    await watchdog(app);
    await ops.call(`/batches/${data.batch.id}/resolve`, { method: 'POST', body: { outcome: 'accepted' } });
    const fileName = (await ops.call(`/batches/${data.batch.id}`)).data.file.fileName;
    await ops.call('/responses', { method: 'POST', body: { fileName: 'late.csv', text: agigResponse(fileName, { status: 'Failure', errors: [[2, '512', 'Invalid Contract']] }) } });
    assert.equal(await status(ops, data.batch.id), 'REJECTED');
    assert.ok((await ops.call('/alerts')).data.alerts.some((alert) => alert.type === 'RESPONSE_REVIEW' && /settled by hand as accepted/.test(alert.message)));
  });
});

test('while the upload agent is at work, nobody marks a built file uploaded by hand', async () => {
  await withApp(async ({ ops, base, clock }) => {
    await addContracts(ops);
    const call = agent(base);
    const { data } = await publish(ops, dayLines());
    await call('/agent/claim');
    assert.equal((await ops.call(`/batches/${data.batch.id}/uploaded`, { method: 'POST' })).status, 409, 'not while the agent is uploading it');
    const second = await publish(ops, dayLines('2026-11-18'));
    const refused = await ops.call(`/batches/${second.data.batch.id}/uploaded`, { method: 'POST' });
    assert.equal(refused.status, 409);
    assert.match(refused.data.error, /upload agent on the office VM is sending files/);
    assert.equal((await ops.call(`/batches/${second.data.batch.id}`)).data.actions.markUploaded, false);
    clock.advance(11); // the agent has gone quiet: by hand is the way now
    assert.equal((await ops.call(`/batches/${second.data.batch.id}`)).data.actions.markUploaded, true);
  }, AGENT);
});

test('Teams gets a backlog of alerts oldest first, none skipped', async () => {
  const posted = [];
  const fetch = async (url, options) => {
    posted.push(JSON.parse(options.body).attachments[0].content.body[1].text);
    return new Response(null, { status: 202 });
  };
  await withApp(async ({ app }) => {
    await startTeams(app);
    for (let n = 1; n <= 25; n += 1) await app.store.raiseAlert({ type: 'MAILBOX', severity: 'Warning', message: `Alert ${n}`, entityType: 'Test', entityId: n });
    assert.equal(await postNewAlerts(app), 20);
    assert.equal(await postNewAlerts(app), 5);
    assert.deepEqual(posted, Array.from({ length: 25 }, (_, at) => `Alert ${at + 1}`));
  }, { fetch, env: { NOM_TEAMS_WEBHOOK_URL: 'https://example.webhook.office.com/hook' } });
});

test('codes that differ only by case are the same code, and a record id that is not a number is not found', async () => {
  await withApp(async ({ ops }) => {
    await addContracts(ops);
    const twin = await ops.call('/contracts', { method: 'POST', body: { code: 'shipper1_fh01', type: 'Transport', pipelineCode: 'DBNGP', startDate: '2026-01-01', serviceType: 'T1' } });
    assert.equal(twin.status, 409);
    for (const path of ['/batches/abc', '/responses/abc/file']) assert.equal((await ops.call(path)).status, 404, path);
    assert.equal((await ops.call('/responses/abc/link', { method: 'POST', body: { fileName: 'x' } })).status, 404);
    assert.equal((await ops.call('/lines/check', { method: 'POST', body: { lines: [{ gasDay: '2026-17-11', contract: 'Shipper1_FH01', designation: 'I1-01', quantity: '1' }] } })).data.issues[0].rule, '510');
  });
});
