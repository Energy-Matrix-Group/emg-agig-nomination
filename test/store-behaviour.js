import assert from 'node:assert/strict';

// What every store must do, the memory store and the SQL store alike. test/store.test.js runs it on memory;
// test/sql.test.js runs it on a real database (npm run test:sql). A change to either store keeps both green.

const row = (line, overrides = {}) => ({
  csvLineNumber: line, gasDay: '2026-11-17', shipper: 'Shipper1', pipeline: 'DBNGP', contract: 'Shipper1_FH01', nomType: 'Outlet',
  marketer: null, serviceType: 'T1', subServiceType: 'T1', designation: `OS${line}-01`, designationLocation: 'Somewhere', quantityTJ: '12.345', note: null, ...overrides,
});

const batch = (overrides = {}) => ({
  environment: 'NP', status: 'VALIDATED', gasDayFrom: '2026-11-17', gasDayTo: '2026-11-17', sourceFile: 'Entered in the app',
  sourceSha256: `${Math.random().toString(16).slice(2)}`.padEnd(64, '0').slice(0, 64), contentSha256: 'c'.repeat(64),
  supersedesBatchId: null, createdBy: 'ops@example.com', validatedAt: new Date('2026-11-16T02:00:00Z'), ...overrides,
});

export async function storeBehaviour(store) {
  // Reference data is seeded once.
  assert.equal((await store.listDesignations()).length, 82);
  assert.equal((await store.listErrorCodes()).find((code) => code.code === '528').message, 'Nominated quantity Greater than Spot Won Quantity');
  assert.deepEqual((await store.listFileTemplate()).map((column) => column.order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

  const contract = await store.createContract({ code: 'Shipper1_FH01', type: 'Transport', pipelineCode: 'DBNGP', startDate: '2026-01-01', endDate: null, capacityTJ: '25', serviceType: 'T1', subServiceType: null, isActive: true });
  assert.equal(contract.capacityTJ, '25.000');
  assert.equal(contract.startDate, '2026-01-01');
  const updated = await store.updateContract(contract.id, { capacityTJ: '30.5', endDate: '2027-01-01' });
  assert.deepEqual([updated.capacityTJ, updated.endDate], ['30.500', '2027-01-01']);
  assert.equal(await store.updateContract(99999, { capacityTJ: '1' }), null);

  const point = await store.createDesignation({ pipelineCode: 'DBNGP', code: 'TEST-01', direction: 'Outlet', locationName: 'Test point', notes: null, specSection: null, validFrom: '2026-12-01', validTo: null });
  assert.equal((await store.updateDesignation(point.id, { validTo: '2027-01-01' })).validTo, '2027-01-01');

  // Spot awards: one per Gas Day and contract, changed in place.
  const award = await store.saveSpotAward({ gasDay: '2026-11-17', contractCode: 'Shipper1_SPOT', awardedTJ: '2', enteredBy: 'ops@example.com' });
  const again = await store.saveSpotAward({ gasDay: '2026-11-17', contractCode: 'Shipper1_SPOT', awardedTJ: '3.25', enteredBy: 'ops@example.com' });
  assert.equal(again.id, award.id);
  assert.deepEqual((await store.listSpotAwards({ from: '2026-11-17', to: '2026-11-17' })).map((item) => item.awardedTJ), ['3.250']);
  assert.equal(await store.deleteSpotAward(award.id), true);
  assert.equal(await store.deleteSpotAward(award.id), false);

  // A batch, its rows and issues in one write; a later one supersedes it and its unsent file.
  const first = await store.createBatch({ batch: batch(), rows: [row(2), row(3, { nomType: 'Inlet', serviceType: null, subServiceType: null })], issues: [{ line: 1, rule: 'RENOM', severity: 'Warning', message: 'Line 2: a renomination.' }, { line: null, rule: '524', severity: 'Warning', message: 'Totals.' }] });
  assert.equal(first.gasDayFrom, '2026-11-17');
  assert.equal(typeof first.createdAt, 'string');
  const rows = await store.listRows([first.id]);
  assert.deepEqual(rows.map((item) => [item.csvLineNumber, item.quantityTJ, item.nomType]), [[2, '12.345', 'Outlet'], [3, '12.345', 'Inlet']]);
  const issues = await store.listIssues(first.id);
  assert.equal(issues.find((issue) => issue.rule === 'RENOM').batchRowId, rows[1].id);
  assert.equal(issues.find((issue) => issue.rule === '524').batchRowId, null);

  assert.equal(await store.updateBatch(first.id, { status: 'APPROVED', approvedBy: 'ops@example.com', approvedAt: new Date() }, { from: ['VALIDATED'] }), true);
  assert.equal(await store.updateBatch(first.id, { status: 'APPROVED' }, { from: ['VALIDATED'] }), false, 'a guarded change happens once');
  const body = Buffer.from('Gas Day,Shipper\r\n2026-11-17,Shipper1\r\n');
  const file = await store.createFile({ batchId: first.id, fileName: 'SHNOM_Test_20261116100000.csv', body, sha256: 'a'.repeat(64), status: 'BUILT' });
  assert.equal(file.body, undefined, 'a file comes back without its bytes unless asked');
  assert.deepEqual((await store.getFile(file.id, { body: true })).body, body);
  await assert.rejects(store.createFile({ batchId: first.id, fileName: 'SHNOM_Test_20261116100000.csv', body, sha256: 'a'.repeat(64), status: 'BUILT' }), (error) => error.duplicateFileName === true);
  await store.updateBatch(first.id, { status: 'BUILT' }, { from: ['APPROVED'] });

  const second = await store.createBatch({ batch: batch({ supersedesBatchId: first.id }), rows: [row(2)], issues: [], supersede: { ids: [first.id], from: ['VALIDATED', 'APPROVED', 'BUILT'], fileNote: 'Superseded.' } });
  assert.equal((await store.getBatch(first.id)).status, 'SUPERSEDED');
  assert.equal((await store.getFile(file.id)).status, 'FAILED');
  assert.equal((await store.getFile(file.id)).lastError, 'Superseded.');
  assert.deepEqual((await store.listBatches({ from: '2026-11-17', to: '2026-11-17' })).map((item) => item.id), [second.id, first.id]);
  assert.deepEqual((await store.listBatches({ from: '2026-11-18' })).map((item) => item.id), []);
  assert.deepEqual((await store.listBatches({ status: 'SUPERSEDED' })).map((item) => item.id), [first.id]);

  // Files move on guarded changes; attempts count up.
  const sent = await store.createFile({ batchId: second.id, fileName: 'SHNOM_Test_20261116100001.csv', body, sha256: 'b'.repeat(64), status: 'BUILT' });
  assert.equal(await store.updateFile(sent.id, { status: 'UPLOADING', attempts: '+1' }, { from: ['BUILT'] }), true);
  assert.equal(await store.updateFile(sent.id, { status: 'UPLOADED', uploadedAt: new Date('2026-11-16T02:05:00Z'), remoteSize: body.length }, { from: ['UPLOADING'] }), true);
  const uploaded = await store.findFileByName('SHNOM_Test_20261116100001.csv');
  assert.deepEqual([uploaded.status, uploaded.attempts, uploaded.remoteSize, uploaded.uploadedAt], ['UPLOADED', 1, body.length, '2026-11-16T02:05:00.000Z']);
  assert.deepEqual((await store.listFiles({ status: ['UPLOADED'] })).map((item) => item.id), [sent.id]);
  assert.equal((await store.findFileByName('shnom_test_20261116100001.CSV'))?.id, sent.id, 'file names match without regard to case, as SQL Server compares them');

  // A response, its errors and the new statuses land together; linking a stray one later does too.
  const response = await store.recordResponse({
    response: { messageId: 'msg-1', receivedAt: new Date('2026-11-16T02:10:00Z'), sender: 'tbs@agig.example', subject: '[SHNOM – Failure]', attachmentName: 'r.csv', rawCsv: 'x', parsedFileName: uploaded.fileName, parsedStatus: 'Failure', responseTimestamp: '20261116101000', fileId: sent.id, matchState: 'MATCHED' },
    errors: [{ lineNumber: 2, errorCode: '507', errorDescription: 'Invalid Outlet Point', batchRowId: (await store.listRows([second.id]))[0].id }],
    file: { id: sent.id, patch: { status: 'RESPONDED', respondedAt: new Date('2026-11-16T02:10:00Z') } },
    batch: { id: second.id, patch: { status: 'REJECTED' } },
  });
  assert.equal((await store.findResponseByMessageId('msg-1')).id, response.id);
  assert.equal((await store.getBatch(second.id)).status, 'REJECTED');
  assert.deepEqual((await store.listResponseErrors([response.id])).map((error) => error.errorCode), ['507']);
  assert.deepEqual((await store.listResponses({ fileIds: [sent.id] })).map((item) => item.id), [response.id]);
  const stray = await store.recordResponse({ response: { messageId: 'msg-2', receivedAt: new Date(), subject: 'x', parsedFileName: 'other.csv', parsedStatus: 'Success', matchState: 'UNMATCHED' } });
  const linked = await store.linkResponse({ responseId: stray.id, patch: { fileId: sent.id, matchState: 'MANUAL' }, errors: [] });
  assert.equal(linked.matchState, 'MANUAL');

  // Alerts: one open alert per thing; acknowledged, cleared, and raised again once cleared.
  const raised = await store.raiseAlert({ type: 'REJECTED', severity: 'Critical', message: 'Rejected.', entityType: 'Batch', entityId: second.id });
  assert.equal(raised.created, true);
  assert.equal((await store.raiseAlert({ type: 'REJECTED', severity: 'Critical', message: 'Again.', entityType: 'Batch', entityId: second.id })).created, false);
  assert.equal((await store.raiseAlert({ type: 'MAILBOX', severity: 'Critical', message: 'No entity.' })).created, true);
  assert.equal((await store.raiseAlert({ type: 'MAILBOX', severity: 'Critical', message: 'No entity again.' })).created, false);
  assert.equal((await store.updateAlert(raised.alert.id, { acknowledgedBy: 'ops@example.com', acknowledgedAt: new Date() })).acknowledgedBy, 'ops@example.com');
  assert.equal(await store.clearAlerts({ type: 'REJECTED', entityType: 'Batch', entityId: second.id }), 1);
  assert.equal((await store.listAlerts({ open: true })).length, 1);
  assert.equal((await store.listAlerts({ afterId: raised.alert.id })).length, 1);
  const allAlerts = await store.listAlerts({});
  assert.deepEqual((await store.listAlerts({ oldestFirst: true })).map((alert) => alert.id), allAlerts.map((alert) => alert.id).reverse());
  assert.equal((await store.raiseAlert({ type: 'REJECTED', severity: 'Critical', message: 'New.', entityType: 'Batch', entityId: second.id })).created, true);

  // The audit trail, newest first.
  await store.addAudit({ action: 'contract.create', entityType: 'Contract', entityId: contract.id, detail: 'Made.', actor: 'ops@example.com' });
  await store.addAudit({ action: 'batch.cancel', entityType: 'Batch', entityId: first.id, detail: null, actor: 'ops@example.com' });
  assert.deepEqual((await store.listAudit({ limit: 2 })).map((entry) => entry.action), ['batch.cancel', 'contract.create']);
  assert.deepEqual((await store.listAudit({ entityType: 'Contract', entityId: contract.id })).map((entry) => entry.detail), ['Made.']);
}
