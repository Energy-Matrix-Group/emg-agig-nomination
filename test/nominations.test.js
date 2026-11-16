import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addContracts, dayLines, publish, TODAY, TOMORROW, withApp } from './support.js';

// Entering, checking and publishing a nomination: the workbook's Check column, Publish macro and
// usp_ValidateBatch, through HTTP.

test('every route needs a signed-in person', async () => {
  await withApp(async ({ base }) => {
    const response = await fetch(`${base}/api/agig-nomination/board`);
    assert.equal(response.status, 401);
  });
});

test('the check fills each line from the reference data, as the workbook formulas did', async () => {
  await withApp(async ({ ops }) => {
    await addContracts(ops);
    const result = await ops.call('/lines/check', { method: 'POST', body: { lines: dayLines() } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.summary, { errors: 0, warnings: 0 });
    const [inlet, outlet] = result.data.rows;
    assert.equal(inlet.shipper, 'Shipper1');
    assert.equal(inlet.pipeline, 'DBNGP');
    assert.equal(inlet.nomType, 'Inlet');
    assert.equal(inlet.serviceType, '', 'an inlet has no service type');
    assert.equal(inlet.designationLocation, 'KGP');
    assert.equal(outlet.nomType, 'Outlet');
    assert.equal(outlet.serviceType, 'T1');
    assert.equal(outlet.subServiceType, 'T1', 'the sub service type is the service type unless the contract says otherwise');
    assert.equal(outlet.quantityTJ, '12.500');
  });
});

test('each rule mirrors the AGIG error code it would have caused', async () => {
  await withApp(async ({ ops }) => {
    await addContracts(ops);
    const lines = [
      { gasDay: 'not a day', contract: 'Shipper1_FH01', designation: 'I1-01', quantity: '1' },
      { gasDay: TOMORROW, contract: 'Nobody_X1', designation: 'I1-01', quantity: '1' },
      { gasDay: TOMORROW, contract: 'Shipper1_FH01', designation: 'XX-99', quantity: '1' },
      { gasDay: TOMORROW, contract: 'Shipper1_FH01', designation: 'WO-01', quantity: '1' },
      { gasDay: TOMORROW, contract: 'Shipper1_FH01', designation: 'I1-02', quantity: '1.2345' },
      { gasDay: TOMORROW, contract: 'Shipper1_FH01', designation: 'I1-03', quantity: '-2' },
      { gasDay: TOMORROW, contract: 'Shipper1_FH01', designation: 'I1-04', quantity: '1', marketer: 'Someone' },
      { gasDay: '2026-11-15', contract: 'Shipper1_FH01', designation: 'I1-05', quantity: '1' },
      { gasDay: '2027-03-01', contract: 'Shipper1_FH01', designation: 'I2-01', quantity: '1' },
      { gasDay: TOMORROW, contract: 'Shipper1_FH01', designation: 'I1-05', quantity: '1' },
      { gasDay: TOMORROW, contract: 'Shipper1_FH01', designation: 'I1-05', quantity: '2' },
      { gasDay: TOMORROW, contract: 'Shipper1_SPOT', designation: 'I2-02', quantity: '1' },
    ];
    const result = await ops.call('/lines/check', { method: 'POST', body: { lines } });
    const rules = (line) => result.data.issues.filter((issue) => issue.line === line).map((issue) => issue.rule);
    assert.deepEqual(rules(0), ['510']);
    assert.deepEqual(rules(1), ['512']);
    assert.deepEqual(rules(2), ['504/506']);
    assert.deepEqual(rules(3), ['507'], 'WO-01 is an outlet on the WAWP, not on the DBNGP');
    assert.deepEqual(rules(4), ['503']);
    assert.deepEqual(rules(5), ['503']);
    assert.deepEqual(rules(6), ['515']);
    assert.deepEqual(rules(7), ['502'], 'yesterday is past its 20:00 cutoff');
    assert.deepEqual(rules(8), ['508'], 'more than 90 days ahead');
    assert.deepEqual(rules(10), ['DUP']);
    assert.deepEqual(rules(11), ['505'], 'a Spot contract takes outlet points only');
    assert.match(result.data.issues.find((issue) => issue.rule === '512').message, /Nobody_X1 is not a known contract/);
  });
});

test('totals: outlets above capacity (522), Spot above the award (528), and outlets above inlets as a warning (524)', async () => {
  await withApp(async ({ ops }) => {
    await addContracts(ops);
    const over = await ops.call('/lines/check', { method: 'POST', body: { lines: dayLines(TOMORROW, { kemerton: '18' }) } });
    const capacity = over.data.issues.find((issue) => issue.rule === '522');
    assert.equal(capacity.severity, 'Error');
    assert.match(capacity.message, /25\.250 TJ, more than the contracted 25\.000 TJ/);
    assert.deepEqual(capacity.lines, [1, 2]);
    assert.equal(over.data.issues.find((issue) => issue.rule === '524').severity, 'Warning');

    const spotLine = { gasDay: TOMORROW, contract: 'Shipper1_SPOT', designation: 'OS5-01', quantity: '3' };
    const noAward = await ops.call('/lines/check', { method: 'POST', body: { lines: [spotLine] } });
    assert.match(noAward.data.issues.find((issue) => issue.rule === '528').message, /no Spot award is entered/);
    assert.equal((await ops.call('/spot-awards', { method: 'PUT', body: { gasDay: TOMORROW, contractCode: 'Shipper1_SPOT', awardedTJ: '2.5' } })).status, 200);
    const above = await ops.call('/lines/check', { method: 'POST', body: { lines: [spotLine] } });
    assert.match(above.data.issues.find((issue) => issue.rule === '528').message, /3\.000 TJ, more than the 2\.500 TJ awarded/);
    const within = await ops.call('/lines/check', { method: 'POST', body: { lines: [{ ...spotLine, quantity: '2.5' }] } });
    assert.deepEqual(within.data.summary, { errors: 0, warnings: 0 });
  });
});

test('after 14:00 the day before, a line is a renomination: a warning to confirm, not an error', async () => {
  await withApp(async ({ ops, clock }) => {
    await addContracts(ops);
    clock.set('2026-11-16T07:00:00Z'); // 15:00 AWST
    const refused = await publish(ops, dayLines());
    assert.equal(refused.status, 409);
    assert.equal(refused.data.issues[0].rule, 'RENOM');
    const confirmed = await publish(ops, dayLines(), { confirmWarnings: true });
    assert.equal(confirmed.status, 201);
    const detail = await ops.call(`/batches/${confirmed.data.batch.id}`);
    assert.equal(detail.data.rows[0].issues[0].rule, 'RENOM', 'the warnings people confirmed are kept with the batch');
  });
});

test('a batch with an error is never made', async () => {
  await withApp(async ({ ops }) => {
    await addContracts(ops);
    const result = await publish(ops, dayLines(TOMORROW, { kemerton: 'twelve' }));
    assert.equal(result.status, 422);
    assert.equal(result.data.summary.errors, 1);
    assert.deepEqual((await ops.call('/batches')).data.batches, []);
    const empty = await publish(ops, []);
    assert.equal(empty.data.issues[0].rule, 'EMPTY');
  });
});

test('publishing is the approval: the file is built straight away, with AGIG\'s exact header', async () => {
  await withApp(async ({ ops, base }) => {
    await addContracts(ops);
    const published = await publish(ops, dayLines());
    assert.equal(published.status, 201);
    const batch = published.data.batch;
    assert.equal(batch.status, 'BUILT');
    assert.equal(batch.approvedBy, 'ops.trader@energymatrix.com.au');
    const detail = await ops.call(`/batches/${batch.id}`);
    assert.equal(detail.data.file.fileName, 'SHNOM_EMG Shipper_20261116100000.csv', 'the name carries the time in AWST');
    assert.equal(detail.data.actions.markUploaded, true);
    const file = await fetch(`${base}/api/agig-nomination/batches/${batch.id}/file`, { headers: { cookie: ops.cookie } });
    assert.match(file.headers.get('content-disposition'), /attachment; filename="SHNOM_EMG Shipper_20261116100000.csv"/);
    assert.equal(await file.text(), [
      'Gas Day,Shipper,Pipeline,Contract,Nom Type,Marketer,Service Type,Sub Service Type,Designation,Designation Location,Nominated Quantity (TJ)',
      '2026-11-17,Shipper1,DBNGP,Shipper1_FH01,Inlet,,,,I1-01,KGP,20.000',
      '2026-11-17,Shipper1,DBNGP,Shipper1_FH01,Outlet,,T1,T1,OS5-01,Kemerton,12.500',
      '2026-11-17,Shipper1,DBNGP,Shipper1_FH01,Outlet,,T1,T1,OS2-01,Alcoa Pinjarra,7.250',
      '',
    ].join('\r\n'));
  });
});

test('two files in the same second get different names', async () => {
  await withApp(async ({ ops }) => {
    await addContracts(ops);
    const first = await publish(ops, dayLines());
    const second = await publish(ops, dayLines('2026-11-18'));
    const names = await Promise.all([first, second].map(async ({ data }) => (await ops.call(`/batches/${data.batch.id}`)).data.file.fileName));
    assert.deepEqual(names, ['SHNOM_EMG Shipper_20261116100000.csv', 'SHNOM_EMG Shipper_20261116100001.csv']);
  });
});

test('with auto-approval off, an operator approves each batch, and it is refused once the cutoff has passed', async () => {
  await withApp(async ({ ops, clock }) => {
    await addContracts(ops);
    const published = await publish(ops, dayLines(TODAY), { confirmWarnings: true });
    assert.equal(published.data.batch.status, 'VALIDATED');
    clock.set('2026-11-16T12:30:00Z'); // 20:30 AWST, past today's cutoff
    const late = await ops.call(`/batches/${published.data.batch.id}/approve`, { method: 'POST' });
    assert.equal(late.status, 422);
    assert.match(late.data.error, /cutoff has passed for 2026-11-16/);

    const tomorrow = await publish(ops, dayLines(), { confirmWarnings: true });
    const approved = await ops.call(`/batches/${tomorrow.data.batch.id}/approve`, { method: 'POST' });
    assert.equal(approved.data.batch.status, 'BUILT');
    assert.equal((await ops.call(`/batches/${tomorrow.data.batch.id}/approve`, { method: 'POST' })).status, 409);
  }, { env: { NOM_AUTO_APPROVE: 'false' } });
});

test('without the participant name the batch is approved but no file is made, and it says why', async () => {
  await withApp(async ({ ops }) => {
    await addContracts(ops);
    const published = await publish(ops, dayLines());
    assert.equal(published.data.batch.status, 'APPROVED');
    assert.match(published.data.warnings[0], /NOM_PARTICIPANT/);
  }, { participant: null });
});

test('the same numbers AGIG already accepted are a duplicate, not sent unless someone says so', async () => {
  await withApp(async ({ ops }) => {
    await addContracts(ops);
    const first = await publish(ops, dayLines());
    await ops.call(`/batches/${first.data.batch.id}/uploaded`, { method: 'POST' });
    const { agigResponse } = await import('./support.js');
    const fileName = (await ops.call(`/batches/${first.data.batch.id}`)).data.file.fileName;
    await ops.call('/responses', { method: 'POST', body: { fileName: 'r.csv', text: agigResponse(fileName) } });

    const again = await publish(ops, dayLines());
    assert.equal(again.data.batch.status, 'DUPLICATE');
    assert.match(again.data.warnings[0], /same numbers AGIG accepted in batch 1/);
    const sent = await ops.call(`/batches/${again.data.batch.id}/send-anyway`, { method: 'POST' });
    assert.equal(sent.data.batch.status, 'BUILT');
  });
});

test('a newer batch supersedes one that was waiting to be sent, and its file can no longer be sent', async () => {
  await withApp(async ({ ops }) => {
    await addContracts(ops);
    const first = await publish(ops, dayLines());
    const second = await publish(ops, dayLines(TOMORROW, { kemerton: '12' }));
    assert.match(second.data.warnings[0], /Batch 1 had not been sent and is now superseded/);
    const old = await ops.call(`/batches/${first.data.batch.id}`);
    assert.equal(old.data.batch.status, 'SUPERSEDED');
    assert.equal(old.data.file.status, 'FAILED');
    assert.deepEqual(old.data.supersededBy, [second.data.batch.id]);
    assert.equal(old.data.actions.markUploaded, false);
    assert.equal((await ops.call(`/batches/${first.data.batch.id}/uploaded`, { method: 'POST' })).status, 409);
    const fresh = await ops.call(`/batches/${second.data.batch.id}`);
    assert.equal(fresh.data.batch.supersedesBatchId, first.data.batch.id);
  });
});

test('cancelling a batch before it is sent', async () => {
  await withApp(async ({ ops }) => {
    await addContracts(ops);
    const published = await publish(ops, dayLines());
    const cancelled = await ops.call(`/batches/${published.data.batch.id}/cancel`, { method: 'POST' });
    assert.equal(cancelled.data.batch.status, 'CANCELLED');
    const detail = await ops.call(`/batches/${published.data.batch.id}`);
    assert.match(detail.data.file.lastError, /cancelled by ops.trader/);
    assert.equal(detail.data.audit[0].action, 'batch.cancel');
    assert.equal((await ops.call(`/batches/${published.data.batch.id}/cancel`, { method: 'POST' })).status, 409);
  });
});

test('people without an ops role can look at everything but change nothing', async () => {
  await withApp(async ({ ops, viewer }) => {
    await addContracts(ops);
    const published = await publish(ops, dayLines());
    assert.equal((await viewer.call('/session')).data.canOperate, false);
    assert.equal((await ops.call('/session')).data.canOperate, true);
    assert.equal((await viewer.call(`/batches/${published.data.batch.id}`)).status, 200);
    assert.equal((await viewer.call(`/batches/${published.data.batch.id}`)).data.actions.cancel, false);
    for (const [path, method, body] of [
      ['/batches', 'POST', { lines: dayLines() }],
      [`/batches/${published.data.batch.id}/cancel`, 'POST'],
      ['/spot-awards', 'PUT', { gasDay: TOMORROW, contractCode: 'Shipper1_SPOT', awardedTJ: '1' }],
      ['/contracts', 'POST', {}],
    ]) {
      const refused = await viewer.call(path, { method, body });
      assert.equal(refused.status, 403, `${method} ${path}`);
      assert.match(refused.data.error, /Only the ops team/);
    }
  });
});

test('pasted rows from Excel are read by their header, with Australian dates and thousands separators', async () => {
  await withApp(async ({ ops }) => {
    const text = [
      'Gas Day\tShipper\tPipeline\tContract\tNom Type\tMarketer\tService Type\tSub Service Type\tDesignation\tDesignation Location\tNominated Quantity (TJ)\tCheck',
      '17/11/2026\tShipper1\tDBNGP\tShipper1_FH01\tInlet\t\t\t\tI1-01\tKGP\t1,020.5\tOK',
      '\t\t\t\t\t\t\t\t\t\t\t',
      '\t\t\t\t\t\t\t\t\tTotal\t1032.5\t',
      '17-Nov-26\tShipper1\tDBNGP\tShipper1_FH01\tOutlet\t\tT1\tT1\tOS5-01\tKemerton\t12\tOK',
    ].join('\r\n');
    const read = await ops.call('/lines/read', { method: 'POST', body: { text } });
    assert.equal(read.status, 200);
    assert.equal(read.data.skipped, 1, 'a row with no contract (a total) is skipped, and a blank one is ignored');
    assert.deepEqual(read.data.lines.map((line) => [line.gasDay, line.contract, line.designation, line.quantity]), [
      ['2026-11-17', 'Shipper1_FH01', 'I1-01', '1,020.5'],
      ['2026-11-17', 'Shipper1_FH01', 'OS5-01', '12'],
    ]);

    const short = await ops.call('/lines/read', { method: 'POST', body: { text: '2026-11-17,Shipper1_FH01,I1-01,5' } });
    assert.equal(short.data.lines[0].designation, 'I1-01', 'four columns are Gas Day, Contract, Designation, Quantity');
    const unknown = await ops.call('/lines/read', { method: 'POST', body: { text: 'a,b,c\n1,2,3' } });
    assert.match(unknown.data.problems[0], /Cannot tell which column is which/);
  });
});
