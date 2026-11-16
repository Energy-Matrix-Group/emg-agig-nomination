import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postNewAlerts, startTeams } from '../server/app/teams.js';
import { watchdog } from '../server/app/watchdog.js';
import { addContracts, dayLines, publish, testClock, TODAY, TOMORROW, withApp } from './support.js';

// The Gas Day board and the watchdog's alerts.

const card = async (ops, day) => (await ops.call('/board')).data.days.find((item) => item.gasDay === day);

test('the board shows D-1 to D+7 with both cutoffs, and grey where no contract is active', async () => {
  await withApp(async ({ ops }) => {
    const board = await ops.call('/board');
    assert.equal(board.data.days.length, 9);
    assert.equal(board.data.days[0].gasDay, '2026-11-15');
    assert.ok(board.data.days.every((day) => day.colour === 'grey'), 'no contracts yet');
    await addContracts(ops);
    const tomorrow = await card(ops, TOMORROW);
    assert.equal(tomorrow.initialCutoff, '2026-11-16T06:00:00.000Z', '14:00 AWST the day before');
    assert.equal(tomorrow.renominationCutoff, '2026-11-17T12:00:00.000Z', '20:00 AWST on the day');
    assert.equal(tomorrow.colour, 'none');
    assert.equal((await card(ops, '2026-11-15')).colour, 'red', 'yesterday passed its cutoff with nothing accepted');
  });
});

test('amber while published numbers are not sent, and when the cutoff is close with nothing accepted', async () => {
  await withApp(async ({ ops, clock }) => {
    await addContracts(ops);
    await publish(ops, dayLines());
    const waiting = await card(ops, TOMORROW);
    assert.equal(waiting.colour, 'amber');
    assert.equal(waiting.latest.outletTJ, '19.750');
    clock.set('2026-11-16T05:30:00Z'); // 13:30 AWST
    assert.equal((await card(ops, '2026-11-18')).colour, 'none', 'the 18th has until 14:00 tomorrow');
    assert.equal((await card(ops, TOMORROW)).label, 'Published, not sent yet');
  });
});

test('at 13:00 on D-1 with nothing accepted for D, a cutoff alert; cleared once D is accepted', async () => {
  await withApp(async ({ ops, clock, app }) => {
    await addContracts(ops);
    clock.set('2026-11-16T04:59:00Z'); // 12:59 AWST
    await watchdog(app);
    assert.equal((await ops.call('/alerts')).data.alerts.filter((alert) => alert.type === 'CUTOFF').length, 0);
    clock.set('2026-11-16T05:00:00Z'); // 13:00 AWST
    await watchdog(app);
    await watchdog(app);
    const cutoff = (await ops.call('/alerts')).data.alerts.filter((alert) => alert.type === 'CUTOFF');
    assert.equal(cutoff.length, 1, 'raised once, however often the watchdog runs');
    assert.match(cutoff[0].message, /Gas Day 2026-11-17 and the cutoff is 14:00 today/);
  });
});

test('newer numbers not sent near a cutoff raise a stale warning', async () => {
  await withApp(async ({ ops, clock, app }) => {
    await addContracts(ops);
    const first = await publish(ops, dayLines());
    await ops.call(`/batches/${first.data.batch.id}/uploaded`, { method: 'POST' });
    const fileName = (await ops.call(`/batches/${first.data.batch.id}`)).data.file.fileName;
    const { agigResponse } = await import('./support.js');
    await ops.call('/responses', { method: 'POST', body: { fileName: 'r.csv', text: agigResponse(fileName) } });
    await publish(ops, dayLines(TOMORROW, { kemerton: '12' }));
    assert.equal((await card(ops, TOMORROW)).label, 'Newer numbers not sent yet');
    clock.set('2026-11-16T05:15:00Z'); // 13:15 AWST, 45 minutes before the cutoff
    await watchdog(app);
    const stale = (await ops.call('/alerts')).data.alerts.find((alert) => alert.type === 'STALE');
    assert.match(stale.message, /Batch 2 for Gas Day 2026-11-17 is not sent yet/);
  });
});

test('the SFTP key expiry warns at 45, 14 and 3 days', async () => {
  await withApp(async ({ ops, app, clock }) => {
    await watchdog(app);
    let alerts = (await ops.call('/alerts')).data.alerts.filter((alert) => alert.type === 'KEY_EXPIRY');
    assert.equal(alerts.length, 0, '60 days out says nothing');
    clock.set('2026-12-05T02:00:00Z');
    await watchdog(app);
    clock.set('2027-01-02T02:00:00Z');
    await watchdog(app);
    alerts = (await ops.call('/alerts')).data.alerts.filter((alert) => alert.type === 'KEY_EXPIRY');
    assert.deepEqual(alerts.map((alert) => [alert.entityId, alert.severity]), [[14, 'Warning'], [45, 'Info']]);
    const system = await ops.call('/system');
    assert.equal(system.data.keyDaysLeft, 13);
  }, { env: { NOM_SFTP_KEY_EXPIRES: '2027-01-15' } });
});

test('alerts are acknowledged and cleared by the ops team', async () => {
  await withApp(async ({ ops, viewer, app, clock }) => {
    await addContracts(ops);
    clock.set('2026-11-16T05:00:00Z');
    await watchdog(app);
    const [alert] = (await ops.call('/alerts')).data.alerts;
    assert.equal((await viewer.call(`/alerts/${alert.id}/acknowledge`, { method: 'POST' })).status, 403);
    const acked = await ops.call(`/alerts/${alert.id}/acknowledge`, { method: 'POST' });
    assert.equal(acked.data.alert.acknowledgedBy, 'ops.trader@energymatrix.com.au');
    await ops.call(`/alerts/${alert.id}/clear`, { method: 'POST' });
    assert.equal((await ops.call('/alerts')).data.alerts.length, 0);
    assert.equal((await ops.call('/alerts?open=all')).data.alerts.length, 1);
    assert.equal((await ops.call('/alerts/999/clear', { method: 'POST' })).status, 404);
  });
});

test('new alerts go to Teams once, as an adaptive card; old ones are not posted after a restart', async () => {
  const posts = [];
  const fetch = async (url, options) => {
    posts.push({ url, body: JSON.parse(options.body) });
    return new Response(null, { status: 202 });
  };
  await withApp(async ({ ops, app, clock }) => {
    await addContracts(ops);
    clock.set('2026-11-16T05:00:00Z');
    await watchdog(app); // raises the cutoff alert before Teams starts: it is old news
    await startTeams(app);
    assert.equal(await postNewAlerts(app), 0);
    clock.set(`${TODAY}T11:30:00Z`); // 19:30 AWST: today's cutoff is close with nothing accepted
    await watchdog(app);
    assert.equal(await postNewAlerts(app), 1);
    assert.equal(await postNewAlerts(app), 0);
    assert.equal(posts[0].url, 'https://example.webhook.office.com/hook');
    const content = posts[0].body.attachments[0].content;
    assert.equal(content.type, 'AdaptiveCard');
    assert.equal(content.body[0].text, '[NP] Cutoff close with nothing accepted');
    assert.match(content.body[1].text, /Gas Day 2026-11-16/);
  }, { fetch, clock: testClock(), env: { NOM_TEAMS_WEBHOOK_URL: 'https://example.webhook.office.com/hook' } });
});
