import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quietly, withApp } from './support.js';
import { addContracts, buildFile, dayRows, loadBatch, raiseAlert } from './worker.js';
import { DATABASE_VARIABLE } from '../server/app/store/sql.js';

// Alerts (raised by the worker, acknowledged and cleared here) and the System page.

test('the ops team acknowledges and clears alerts; others only look', async () => {
  await withApp(async ({ ops, viewer, store }) => {
    const alert = await raiseAlert(store, 'REJECTED', 'Critical', 'AGIG rejected batch 3.', { entityType: 'Batch', entityId: 3 });
    assert.equal((await viewer.call('/alerts')).data.alerts.length, 1);
    assert.equal((await viewer.call('/session')).data.canActOnAlerts, false);
    assert.equal((await ops.call('/session')).data.canActOnAlerts, true);
    const refused = await viewer.call(`/alerts/${alert.id}/acknowledge`, { method: 'POST' });
    assert.equal(refused.status, 403);
    assert.match(refused.data.error, /Only the ops team can acknowledge or clear alerts/);

    const acked = await ops.call(`/alerts/${alert.id}/acknowledge`, { method: 'POST' });
    assert.deepEqual([acked.data.alert.acknowledgedBy, acked.data.alert.clearedAt], ['ops.trader@energymatrix.com.au', null]);
    assert.equal((await ops.call('/alerts')).data.alerts.length, 1, 'acknowledged is still open');
    await ops.call(`/alerts/${alert.id}/clear`, { method: 'POST' });
    assert.equal((await ops.call('/alerts')).data.alerts.length, 0);
    assert.equal((await ops.call('/alerts?open=false')).data.alerts.length, 1);
    assert.equal((await ops.call('/alerts?open=all')).data.alerts.length, 1);
    assert.equal((await ops.call('/alerts/999/clear', { method: 'POST' })).status, 404);
    assert.equal((await ops.call('/alerts/abc/clear', { method: 'POST' })).status, 404);
  });
});

test('the System page: open and lately closed alerts, files with AGIG, files waiting, the last sent and answered', async () => {
  await withApp(async ({ ops, store }) => {
    await addContracts(store);
    const sent = await loadBatch(store, dayRows('2026-11-17'));
    const sentFile = await buildFile(store, sent, { at: '2026-11-16T01:00:00Z' });
    const waiting = await loadBatch(store, dayRows('2026-11-18'));
    await buildFile(store, waiting, { sent: false, at: '2026-11-16T01:30:00Z' });
    const open = await raiseAlert(store, 'NO_RESPONSE', 'Critical', 'No answer.');
    const closed = await raiseAlert(store, 'KEY_EXPIRY', 'Info', 'Key expires soon.');
    await ops.call(`/alerts/${closed.id}/clear`, { method: 'POST' });

    const system = (await ops.call('/system')).data;
    assert.equal(system.environment, 'NP');
    assert.deepEqual(system.alerts.map((alert) => alert.id), [open.id]);
    assert.deepEqual(system.closedAlerts.map((alert) => alert.id), [closed.id]);
    assert.deepEqual(system.withAgig.map((file) => [file.batchId, file.fileName]), [[sent.id, sentFile.fileName]]);
    assert.deepEqual(system.waiting.map((file) => file.batchId), [waiting.id]);
    assert.equal(system.lastSent.batchId, sent.id);
    assert.equal(system.lastAnswered, null);
  });
});

test('on the memory fallback after a database failure, alerts can be looked at but not changed', async () => {
  await quietly(async () => {
    const env = { SQL_SERVER: '127.0.0.1', [DATABASE_VARIABLE]: 'a-database', SQL_USER: 'app', SQL_PASSWORD: 'secret' };
    await withApp(async ({ ops, store, base }) => {
      assert.deepEqual(await (await fetch(`${base}/api/status`)).json(), { databaseConnected: false });
      const alert = await raiseAlert(store, 'MAILBOX', 'Warning', 'Mailbox down.');
      assert.equal((await ops.call('/alerts')).status, 200);
      assert.equal((await ops.call(`/alerts/${alert.id}/clear`, { method: 'POST' })).status, 503);
      assert.equal((await ops.call('/system')).data.storage, 'memory-fallback');
    }, { env });
  });
});
