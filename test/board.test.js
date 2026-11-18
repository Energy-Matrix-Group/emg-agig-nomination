import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TODAY, TOMORROW, withApp } from './support.js';
import { acceptedDay, addContracts, buildFile, dayRows, loadBatch, raiseAlert } from './worker.js';

// The Gas Day board: one row per Gas Day, today to D+31, from what the worker wrote.

const day = async (ops, gasDay) => (await ops.call('/board')).data.days.find((item) => item.gasDay === gasDay);

test('every route needs a signed-in person', async () => {
  await withApp(async ({ base }) => {
    assert.equal((await fetch(`${base}/api/agig-nomination/board`)).status, 401);
  });
});

test('today and the next 31 days, each with both cutoffs, grey where no contract is active', async () => {
  await withApp(async ({ ops, store, clock }) => {
    const board = (await ops.call('/board')).data;
    assert.deepEqual([board.days.length, board.days[0].gasDay, board.days[0].offset, board.days.at(-1).gasDay], [32, '2026-11-16', 0, '2026-12-17']);
    assert.equal(board.cutoffWarningMinutes, 60, 'the page marks a cutoff closer than this');
    assert.ok(board.days.every((item) => item.colour === 'grey'), 'no contracts yet');
    await addContracts(store);
    const tomorrow = await day(ops, TOMORROW);
    assert.equal(tomorrow.initialCutoff, '2026-11-16T06:00:00.000Z', '14:00 AWST the day before');
    assert.equal(tomorrow.renominationCutoff, '2026-11-17T12:00:00.000Z', '20:00 AWST on the day');
    assert.deepEqual([tomorrow.colour, tomorrow.label], ['none', 'Nothing sent yet']);
    clock.set('2026-11-16T12:01:00Z'); // 20:01 in Perth: today's renominations have closed
    assert.deepEqual([(await day(ops, '2026-11-16')).colour, (await day(ops, '2026-11-16')).label], ['red', 'Cutoff passed, nothing accepted']);
    clock.set('2026-11-16T16:00:00Z'); // midnight in Perth: the board moves on a day
    const next = (await ops.call('/board')).data;
    assert.deepEqual([next.today, next.days[0].gasDay, next.days.at(-1).gasDay], ['2026-11-17', '2026-11-17', '2026-12-18']);
  });
});

test('accepted is green, with what AGIG holds; a file with AGIG is blue', async () => {
  await withApp(async ({ ops, store }) => {
    await addContracts(store);
    await acceptedDay(store, dayRows(TOMORROW, { spot: '2.500' }));
    const accepted = await day(ops, TOMORROW);
    assert.deepEqual([accepted.colour, accepted.label], ['green', 'Accepted']);
    assert.deepEqual(accepted.held, { lines: 4, inletTJ: '20.000', outletTJ: '22.250' });
    const waiting = await loadBatch(store, dayRows('2026-11-18'));
    await buildFile(store, waiting);
    assert.deepEqual([(await day(ops, '2026-11-18')).colour, (await day(ops, '2026-11-18')).label], ['blue', 'Sent, waiting for AGIG']);
  });
});

test('newer numbers not sent yet are amber, and red once the 20:00 cutoff has passed', async () => {
  await withApp(async ({ ops, store, clock }) => {
    await addContracts(store);
    await acceptedDay(store, dayRows(TOMORROW));
    const newer = await loadBatch(store, dayRows(TOMORROW, { kemerton: '12.000' }));
    await buildFile(store, newer, { sent: false });
    const card = await day(ops, TOMORROW);
    assert.deepEqual([card.colour, card.label], ['amber', 'Newer numbers not sent yet']);
    assert.equal(card.latest.outletTJ, '19.250');
    assert.equal(card.held.outletTJ, '19.750');
    clock.set('2026-11-17T12:01:00Z');
    assert.deepEqual([(await day(ops, TOMORROW)).colour, (await day(ops, TOMORROW)).label], ['red', 'Cutoff passed, newer numbers never sent']);
  });
});

test('a batch that failed the worker\'s checks, or that AGIG rejected, is red', async () => {
  await withApp(async ({ ops, store }) => {
    await addContracts(store);
    await loadBatch(store, dayRows(TOMORROW), { status: 'VALIDATION_FAILED', issues: [{ line: 1, rule: '522', severity: 'Error', message: 'Outlets above capacity.' }] });
    assert.deepEqual([(await day(ops, TOMORROW)).colour, (await day(ops, TOMORROW)).label], ['red', 'Failed the checks']);
    const { answer } = await import('./worker.js');
    const rejected = await loadBatch(store, dayRows('2026-11-18'));
    await answer(store, rejected, await buildFile(store, rejected), { status: 'Failure', errors: [[3, '507', 'Invalid Outlet Point']] });
    assert.deepEqual([(await day(ops, '2026-11-18')).colour, (await day(ops, '2026-11-18')).label], ['red', 'Rejected by AGIG']);
  });
});

test('within the cutoff warning with nothing accepted, a day is amber', async () => {
  await withApp(async ({ ops, store, clock }) => {
    await addContracts(store);
    clock.set('2026-11-16T05:15:00Z'); // 13:15 AWST, 45 minutes to tomorrow's initial cutoff
    assert.deepEqual([(await day(ops, TOMORROW)).colour, (await day(ops, TOMORROW)).label], ['amber', 'Cutoff close, nothing accepted']);
    assert.deepEqual([(await day(ops, TODAY)).colour, (await day(ops, TODAY)).label], ['amber', 'Nothing accepted, renominations only'], 'today\'s initial cutoff is gone, but renominations run until 20:00');
  }, { env: { NOM_CUTOFF_WARNING_MINUTES: '60' } });
});

test('the board shows only the environment the app is set to', async () => {
  await withApp(async ({ ops, store }) => {
    await addContracts(store);
    await loadBatch(store, dayRows(TOMORROW), { environment: 'PROD' });
    assert.equal((await day(ops, TOMORROW)).latest, null);
    await raiseAlert(store, 'NO_RESPONSE', 'Critical', 'No answer.');
    assert.equal((await ops.call('/session')).data.openAlerts, 1);
  });
});
