import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addContracts, dayLines, publish, TOMORROW, withApp } from './support.js';

// Reference data, Spot awards and the audit trail.

test('the spec\'s reference data is there from the start: 5 pipelines, 82 points, 28 codes, 11 columns', async () => {
  await withApp(async ({ viewer }) => {
    const { data } = await viewer.call('/reference');
    assert.equal(data.pipelines.length, 5);
    assert.equal(data.designations.length, 82);
    assert.equal(data.errorCodes.length, 28);
    assert.deepEqual(data.fileTemplate.map((column) => column.name).slice(0, 3), ['Gas Day', 'Shipper', 'Pipeline']);
    assert.deepEqual(data.contracts, [], 'the shipper\'s contracts are entered, never seeded');
  });
});

test('contracts are checked, unique, and every change is in the audit trail', async () => {
  await withApp(async ({ ops }) => {
    const bad = await ops.call('/contracts', { method: 'POST', body: { code: 'FH01', type: 'Transport', pipelineCode: 'NOPE', startDate: '2026-13-01', capacityTJ: '1.2345' } });
    assert.equal(bad.status, 400);
    for (const words of [/Shipper1_FH01/, /pipelines/, /start date/, /more than 3 decimals/]) assert.match(bad.data.error, words);

    const { transport, spot } = await addContracts(ops);
    assert.equal(transport.capacityTJ, '25.000');
    assert.equal(spot.serviceType, 'SPOT', 'a Spot contract carries SPOT unless told otherwise');
    const twice = await ops.call('/contracts', { method: 'POST', body: { code: 'Shipper1_FH01', type: 'Transport', pipelineCode: 'DBNGP', startDate: '2026-01-01', serviceType: 'T1' } });
    assert.equal(twice.status, 409);

    const changed = await ops.call(`/contracts/${transport.id}`, { method: 'PUT', body: { ...transport, capacityTJ: '30', isActive: true } });
    assert.equal(changed.data.contract.capacityTJ, '30.000');
    const audit = (await ops.call('/system')).data.audit;
    assert.equal(audit[0].action, 'contract.update');
    assert.equal(audit[0].detail, 'capacityTJ: 25.000 to 30.000');
    assert.equal(audit[0].actor, 'ops.trader@energymatrix.com.au');
  });
});

test('an inactive contract or one that does not cover the day is refused (512)', async () => {
  await withApp(async ({ ops }) => {
    const { transport } = await addContracts(ops);
    await ops.call(`/contracts/${transport.id}`, { method: 'PUT', body: { ...transport, endDate: '2026-11-16' } });
    const ended = await ops.call('/lines/check', { method: 'POST', body: { lines: dayLines() } });
    assert.match(ended.data.issues[0].message, /runs 2026-01-01 to 2026-11-16, so it does not cover 2026-11-17/);
    await ops.call(`/contracts/${transport.id}`, { method: 'PUT', body: { ...transport, isActive: false } });
    const inactive = await ops.call('/lines/check', { method: 'POST', body: { lines: dayLines() } });
    assert.match(inactive.data.issues[0].message, /is not active/);
  });
});

test('a point AGIG renames gets an end date and a new version, and old lines still read right', async () => {
  await withApp(async ({ ops }) => {
    await addContracts(ops);
    const points = (await ops.call('/reference')).data.designations;
    const kemerton = points.find((point) => point.code === 'OS5-01');
    const retired = await ops.call(`/designations/${kemerton.id}`, { method: 'PUT', body: { locationName: 'Kemerton', validTo: '2026-11-17' } });
    assert.equal(retired.data.designation.validTo, '2026-11-17');
    const renamed = await ops.call('/designations', { method: 'POST', body: { pipelineCode: 'DBNGP', code: 'OS5-01', direction: 'Outlet', locationName: 'Kemerton North', validFrom: '2026-11-18' } });
    assert.equal(renamed.status, 201);
    const check = await ops.call('/lines/check', { method: 'POST', body: { lines: [...dayLines(), ...dayLines('2026-11-18')] } });
    assert.deepEqual(check.data.summary, { errors: 0, warnings: 0 });
    assert.deepEqual(check.data.rows.filter((row) => row.designation === 'OS5-01').map((row) => row.designationLocation), ['Kemerton', 'Kemerton North']);
    const clash = await ops.call('/designations', { method: 'POST', body: { pipelineCode: 'DBNGP', code: 'OS5-01', direction: 'Outlet', locationName: 'Again', validFrom: '2026-11-18' } });
    assert.equal(clash.status, 409);
  });
});

test('Spot awards are kept per Gas Day and Spot contract, changed in place, and deleted', async () => {
  await withApp(async ({ ops }) => {
    await addContracts(ops);
    assert.equal((await ops.call('/spot-awards', { method: 'PUT', body: { gasDay: TOMORROW, contractCode: 'Shipper1_FH01', awardedTJ: '2' } })).status, 400, 'only a Spot contract');
    await ops.call('/spot-awards', { method: 'PUT', body: { gasDay: TOMORROW, contractCode: 'Shipper1_SPOT', awardedTJ: '2' } });
    const changed = await ops.call('/spot-awards', { method: 'PUT', body: { gasDay: TOMORROW, contractCode: 'Shipper1_SPOT', awardedTJ: '3.5' } });
    const { data } = await ops.call('/spot-awards');
    assert.deepEqual(data.awards.map((award) => [award.gasDay, award.awardedTJ]), [[TOMORROW, '3.500']]);
    assert.equal((await ops.call(`/spot-awards/${changed.data.award.id}`, { method: 'DELETE' })).status, 200);
    assert.deepEqual((await ops.call('/spot-awards')).data.awards, []);
  });
});

test('Joules can say how each Gas Day stands, what happened to a batch, and the open alerts', async () => {
  const { assistant } = await import('../server/app/index.js');
  await withApp(async ({ ops, app }) => {
    await addContracts(ops);
    const { data } = await publish(ops, dayLines());
    const user = { id: 'u', email: 'someone@energymatrix.com.au', displayName: 'Someone', role: null };
    const run = (name, input = {}) => assistant.actions.find((action) => action.name === name).run({ app, user, input });
    const status = await run('gas_day_status');
    assert.equal(status.days.find((day) => day.gasDay === TOMORROW).status, 'Published, not sent yet');
    const batch = await run('batch_status', { batchId: data.batch.id });
    assert.equal(batch.status, 'Ready to send');
    assert.equal(batch.path, `/batch/?id=${data.batch.id}`);
    assert.deepEqual(await run('batch_status', { batchId: 999 }), { found: false });
    assert.deepEqual(await run('open_alerts'), { alerts: [] });
  });
});
