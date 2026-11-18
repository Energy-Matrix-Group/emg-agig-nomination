import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assistant } from '../server/app/index.js';
import { TOMORROW, withApp } from './support.js';
import { acceptedDay, addContracts, answer, buildFile, dayRows, loadBatch, modelRows } from './worker.js';

// Several workbook models, each sending its own files to AGIG on lines of its own (Eve, 18 November 2026: more than
// six models; AGIG replaces only the lines a file carries; no two models share a line). Each Gas Day is judged model
// by model, and nothing one model does may hide or blur another.

const A = { contract: 'Shipper1_A', outlet: 'OKW-01', location: 'Alcoa Kwinana Station' };
const B = { contract: 'Shipper1_B', outlet: 'OKW-04', location: 'Cockburn Power Station incl NewGen' };
const C = { contract: 'Shipper1_C', outlet: 'NGP-NM', location: 'North Metro' };
const boardDay = async (ops, gasDay, query = '') => (await ops.call(`/board${query}`)).data.days.find((item) => item.gasDay === gasDay);

async function rejected(store, rows, modelId) {
  const batch = await loadBatch(store, rows, { modelId });
  const file = await buildFile(store, batch);
  await answer(store, batch, file, { status: 'Failure', errors: [[3, '507', 'Invalid Outlet Point']] });
  return store.getBatch(batch.id);
}

test('each model is judged on its own, and the day is as bad as its worst model', async () => {
  await withApp(async ({ ops, store }) => {
    await addContracts(store);
    await acceptedDay(store, modelRows(TOMORROW, { ...A, outletTJ: '10.000' }), { modelId: 'MODEL-A' });
    const bad = await rejected(store, modelRows(TOMORROW, { ...B, outletTJ: '6.000' }), 'MODEL-B');
    const waiting = await loadBatch(store, modelRows(TOMORROW, { ...C, outletTJ: '4.000' }), { modelId: 'MODEL-C' });
    await buildFile(store, waiting);

    const day = await boardDay(ops, TOMORROW);
    assert.deepEqual([day.colour, day.label], ['red', '3 models: 1 accepted, 1 with AGIG, 1 needs attention']);
    assert.deepEqual(day.counts, { green: 1, blue: 1, amber: 0, red: 1, none: 0 });
    assert.deepEqual(day.models.map((item) => [item.modelId, item.colour, item.label, item.latest.batchId === bad.id]),
      [['MODEL-A', 'green', 'Accepted', false], ['MODEL-B', 'red', 'Rejected by AGIG', true], ['MODEL-C', 'blue', 'Sent, waiting for AGIG', false]]);
    assert.deepEqual([day.models[0].held.outletTJ, day.models[1].held.lines], ['10.000', 0]);
    assert.equal(day.held.outletTJ, '10.000', 'AGIG holds only what it accepted, of every model');
  });
});

test('a newer batch from one model is that model\'s business: the others stay accepted, and AGIG holds them all', async () => {
  await withApp(async ({ ops, store }) => {
    await addContracts(store);
    await acceptedDay(store, modelRows(TOMORROW, { ...A, outletTJ: '10.000' }), { modelId: 'MODEL-A' });
    await acceptedDay(store, modelRows(TOMORROW, { ...B, outletTJ: '6.000' }), { modelId: 'MODEL-B' });
    let day = await boardDay(ops, TOMORROW);
    assert.deepEqual([day.colour, day.label, day.held.outletTJ, day.held.lines], ['green', '2 models: 2 accepted', '16.000', 4]);

    // Model A publishes newer numbers. Before models were told apart, B's accepted batch made this look sent.
    const newer = await loadBatch(store, modelRows(TOMORROW, { ...A, outletTJ: '11.500' }), { modelId: 'MODEL-A' });
    day = await boardDay(ops, TOMORROW);
    assert.deepEqual([day.colour, day.models.map((item) => item.label)], ['amber', ['Newer numbers not sent yet', 'Accepted']]);

    // Its change view compares it with model A alone: B's lines are not "removed".
    const { changes } = (await ops.call(`/batches/${newer.id}`)).data;
    assert.deepEqual(changes.map((change) => [change.contract, change.nomType, change.before, change.after]),
      [['Shipper1_A', 'Inlet', '10.000', '11.500'], ['Shipper1_A', 'Outlet', '10.000', '11.500']]);
  });
});

test('an active model with nothing loaded for a day is listed for it, without colouring the day', async () => {
  await withApp(async ({ ops, store }) => {
    await addContracts(store);
    await acceptedDay(store, modelRows(TOMORROW, A), { modelId: 'MODEL-A' });
    await acceptedDay(store, modelRows('2026-11-18', C), { modelId: 'MODEL-C' });
    const day = await boardDay(ops, TOMORROW);
    assert.deepEqual([day.colour, day.label, day.nothingLoaded], ['green', 'Accepted', ['MODEL-C']]);
    assert.deepEqual((await boardDay(ops, '2026-11-18')).nothingLoaded, ['MODEL-A']);
  });
});

test('two models nominating the same line make the day amber, and each batch names the other', async () => {
  await withApp(async ({ ops, store }) => {
    await addContracts(store);
    const first = await acceptedDay(store, dayRows(TOMORROW), { modelId: 'MODEL-A' });
    const second = await acceptedDay(store, [...modelRows(TOMORROW, B), dayRows(TOMORROW)[1]], { modelId: 'MODEL-B' });
    const day = await boardDay(ops, TOMORROW);
    assert.equal(day.colour, 'amber', 'AGIG keeps whichever file arrived later for that line');
    assert.deepEqual(day.overlaps, [{ contract: 'Shipper1_FH01', nomType: 'Outlet', designation: 'OS5-01', models: ['MODEL-A', 'MODEL-B'] }]);
    assert.match(day.label, /1 line nominated by two models/);
    assert.deepEqual((await ops.call(`/batches/${first.id}`)).data.overlaps.map((item) => [item.designation, item.modelId, item.batchId]), [['OS5-01', 'MODEL-B', second.id]]);
    assert.deepEqual((await ops.call(`/batches/${second.id}`)).data.overlaps.map((item) => [item.designation, item.modelId]), [['OS5-01', 'MODEL-A']]);
  });
});

test('one model alone: the board, the Submissions list and the list of models', async () => {
  await withApp(async ({ ops, store, app }) => {
    await addContracts(store);
    const good = await acceptedDay(store, modelRows(TOMORROW, A), { modelId: 'MODEL-A' });
    const bad = await rejected(store, modelRows(TOMORROW, B), 'MODEL-B');

    const onlyB = await boardDay(ops, TOMORROW, '?model=MODEL-B');
    assert.deepEqual([onlyB.colour, onlyB.label, onlyB.latest.batchId, onlyB.models, onlyB.held.lines], ['red', 'Rejected by AGIG', bad.id, [], 0]);
    assert.equal((await ops.call('/board?model=MODEL-B')).data.model, 'MODEL-B');
    assert.deepEqual((await ops.call('/board')).data.models.map((item) => [item.modelId, item.active]), [['MODEL-A', true], ['MODEL-B', true]]);
    assert.deepEqual((await ops.call('/batches?model=MODEL-A')).data.batches.map((batch) => batch.id), [good.id]);
    assert.deepEqual((await ops.call('/models')).data.models.map((item) => [item.modelId, item.batches]), [['MODEL-A', 1], ['MODEL-B', 1]]);
    assert.equal((await ops.call(`/board?model=${'x'.repeat(101)}`)).status, 400);

    const run = (name, input = {}) => assistant.actions.find((action) => action.name === name).run({ app, user: { id: 'u', email: 'someone@energymatrix.com.au', displayName: 'Someone', role: null }, input });
    const tomorrow = (await run('gas_day_status')).days.find((item) => item.gasDay === TOMORROW);
    assert.deepEqual(tomorrow.models.map((item) => [item.modelId, item.status]), [['MODEL-A', 'Accepted'], ['MODEL-B', 'Rejected by AGIG']]);
    assert.equal((await run('gas_day_status', { model: 'MODEL-A' })).days.find((item) => item.gasDay === TOMORROW).status, 'Accepted');
  });
});
