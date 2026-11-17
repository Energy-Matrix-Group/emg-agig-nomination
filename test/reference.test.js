import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routes } from '../server/app/index.js';
import { withApp } from './support.js';
import { addContracts } from './worker.js';

// Reference data is read-only here, and the app as a whole only watches.

test('the spec\'s reference data is there from the start: 5 pipelines, 82 points, 28 codes, 11 columns', async () => {
  await withApp(async ({ viewer, store }) => {
    const empty = (await viewer.call('/reference')).data;
    assert.deepEqual([empty.pipelines.length, empty.designations.length, empty.errorCodes.length, empty.fileTemplate.length], [5, 82, 28, 11]);
    assert.deepEqual(empty.contracts, [], 'the shipper\'s contracts come from the database administrator\'s scripts');
    await addContracts(store);
    const { contracts } = (await viewer.call('/reference')).data;
    assert.deepEqual(contracts.map((contract) => [contract.code, contract.type, contract.capacityTJ, contract.serviceType]), [
      ['Shipper1_FH01', 'Transport', '25.000', 'T1'],
      ['Shipper1_SPOT', 'Spot', null, 'SPOT'],
    ]);
  });
});

// A deliberate gap: nominations are made in the workbook and loaded, sent and answered by the worker, so nothing
// here creates or changes a batch, a response or the reference data. Don't add a route that does without asking.
test('every route only reads, except acknowledging and clearing an alert', async () => {
  const writes = routes.filter((route) => route.method !== 'GET').map((route) => `${route.method} ${route.path}`);
  assert.deepEqual(writes, ['POST /api/agig-nomination/alerts/:id/acknowledge', 'POST /api/agig-nomination/alerts/:id/clear']);
  await withApp(async ({ ops }) => {
    for (const [method, path] of [['POST', '/batches'], ['POST', '/contracts'], ['PUT', '/spot-awards'], ['POST', '/responses'], ['POST', '/lines/check']]) {
      assert.equal((await ops.call(path, { method, body: {} })).status, 404, `${method} ${path}`);
    }
  });
});
