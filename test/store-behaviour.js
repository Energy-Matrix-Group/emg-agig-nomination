import assert from 'node:assert/strict';

// What every store must do, the memory store and the SQL store alike. test/store.test.js runs it on memory;
// test/sql.test.js runs it on a real database (npm run test:sql). A change to either store keeps both green.
// The writes here are the worker's (test/worker.js stands in for it); the app itself only reads, and
// acknowledges and clears alerts.

const row = (line, overrides = {}) => ({
  csvLineNumber: line, gasDay: '2026-11-17', shipper: 'Shipper1', pipeline: 'DBNGP', contract: 'Shipper1_FH01', nomType: 'Outlet',
  marketer: null, serviceType: 'T1', subServiceType: 'T1', designation: `OS${line}-01`, designationLocation: 'Somewhere', quantityTJ: '12.345', note: null, ...overrides,
});

let serial = 0;
const batch = (overrides = {}) => ({
  environment: 'NP', status: 'VALIDATED', gasDayFrom: '2026-11-17', gasDayTo: '2026-11-17', sourceFile: 'F:\\AGIG SFTP TEST\\Archive\\NOM_ops_0001.xlsx',
  sourceSha256: String(serial += 1).padStart(64, '0'), contentSha256: 'c'.repeat(64),
  supersedesBatchId: null, createdBy: 'ops@example.com', validatedAt: new Date('2026-11-16T02:00:00Z'), ...overrides,
});

export async function storeBehaviour(store) {
  // Reference data is seeded once.
  assert.equal((await store.listDesignations()).length, 82);
  assert.equal((await store.listPipelines()).length, 5);
  assert.equal((await store.listErrorCodes()).find((code) => code.code === '528').message, 'Nominated quantity Greater than Spot Won Quantity');
  assert.deepEqual((await store.listFileTemplate()).map((column) => column.order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const contract = await store.createContract({ code: 'Shipper1_FH01', type: 'Transport', pipelineCode: 'DBNGP', startDate: '2026-01-01', endDate: null, capacityTJ: '25', serviceType: 'T1', subServiceType: null, isActive: true });
  assert.deepEqual([contract.capacityTJ, contract.startDate, contract.endDate, contract.isActive], ['25.000', '2026-01-01', null, true]);
  assert.deepEqual((await store.listContracts()).map((item) => item.code), ['Shipper1_FH01']);

  // A batch, its rows and issues in one write, with the time the worker gives it.
  const first = await store.createBatch({
    batch: batch({ createdAt: new Date('2026-11-16T01:00:00Z') }),
    rows: [row(2), row(3, { nomType: 'Inlet', serviceType: null, subServiceType: null, quantityTJ: '20' })],
    issues: [{ line: 1, rule: 'RENOM', severity: 'Warning', message: 'Line 2: a renomination.' }, { line: null, rule: '524', severity: 'Error', message: 'Totals.' }],
  });
  assert.deepEqual([first.gasDayFrom, first.createdAt, first.validatedAt], ['2026-11-17', '2026-11-16T01:00:00.000Z', '2026-11-16T02:00:00.000Z']);
  const rows = await store.listRows([first.id]);
  assert.deepEqual(rows.map((item) => [item.csvLineNumber, item.quantityTJ, item.nomType]), [[2, '12.345', 'Outlet'], [3, '20.000', 'Inlet']]);
  const issues = await store.listIssues(first.id);
  assert.equal(issues.find((issue) => issue.rule === 'RENOM').batchRowId, rows[1].id);
  assert.equal(issues.find((issue) => issue.rule === '524').batchRowId, null);
  assert.equal(await store.updateBatch(first.id, { status: 'APPROVED', approvedBy: 'ops@example.com', approvedAt: new Date() }, { from: ['VALIDATED'] }), true);
  assert.equal(await store.updateBatch(first.id, { status: 'APPROVED' }, { from: ['VALIDATED'] }), false, 'a guarded change happens once');

  const second = await store.createBatch({ batch: batch({ status: 'SUPERSEDED', gasDayTo: '2026-11-18', supersedesBatchId: first.id }), rows: [row(2, { gasDay: '2026-11-18' })] });
  assert.deepEqual((await store.listBatches({ from: '2026-11-17', to: '2026-11-17' })).map((item) => item.id), [second.id, first.id]);
  assert.deepEqual((await store.listBatches({ from: '2026-11-18' })).map((item) => item.id), [second.id]);
  assert.deepEqual((await store.listBatches({ status: ['SUPERSEDED'] })).map((item) => item.id), [second.id]);
  assert.deepEqual((await store.listBatches({ environment: 'PROD' })), []);
  assert.deepEqual((await store.listBatches({ ids: [first.id] })).map((item) => item.supersedesBatchId), [null]);

  // Files: the bytes come back only when asked for.
  const body = Buffer.from('Gas Day,Shipper\r\n2026-11-17,Shipper1\r\n');
  const file = await store.createFile({ batchId: first.id, fileName: 'SHNOM_Test_20261116100000.csv', body, sha256: 'a'.repeat(64), status: 'BUILT' });
  assert.equal(file.body, undefined);
  assert.deepEqual((await store.getFile(file.id, { body: true })).body, body);
  assert.equal(await store.updateFile(file.id, { status: 'UPLOADED', uploadedAt: new Date('2026-11-16T02:05:00Z'), remoteSize: body.length }, { from: ['BUILT'] }), true);
  assert.equal(await store.updateFile(file.id, { status: 'UPLOADED' }, { from: ['BUILT'] }), false);
  const uploaded = await store.getFile(file.id);
  assert.deepEqual([uploaded.status, uploaded.remoteSize, uploaded.uploadedAt], ['UPLOADED', body.length, '2026-11-16T02:05:00.000Z']);
  assert.deepEqual((await store.listFiles({ status: ['UPLOADED'] })).map((item) => item.id), [file.id]);
  assert.deepEqual((await store.listFiles({ batchIds: [second.id] })), []);

  // A response, its errors and the new statuses land together.
  const response = await store.recordResponse({
    response: { messageId: 'msg-1', receivedAt: new Date('2026-11-16T02:10:00Z'), sender: 'tbs@agig.example', subject: '[SHNOM – Failure]', attachmentName: 'r.csv', rawCsv: 'Filename,x\r\nEnd', parsedFileName: uploaded.fileName, parsedStatus: 'Failure', responseTimestamp: '20261116101000', fileId: file.id, matchState: 'MATCHED' },
    errors: [{ lineNumber: 2, errorCode: '507', errorDescription: 'Invalid Outlet Point', batchRowId: rows[0].id }, { lineNumber: 9, errorCode: '100', errorDescription: null, batchRowId: null }],
    file: { id: file.id, patch: { status: 'RESPONDED', respondedAt: new Date('2026-11-16T02:10:00Z') } },
    batch: { id: first.id, patch: { status: 'REJECTED' } },
  });
  assert.equal((await store.getResponse(response.id)).rawCsv, 'Filename,x\r\nEnd');
  assert.equal((await store.getBatch(first.id)).status, 'REJECTED');
  assert.equal((await store.getFile(file.id)).respondedAt, '2026-11-16T02:10:00.000Z');
  assert.deepEqual((await store.listResponseErrors([response.id])).map((error) => [error.errorCode, error.batchRowId]), [['507', rows[0].id], ['100', null]]);
  assert.deepEqual((await store.listResponses({ fileIds: [file.id] })).map((item) => item.id), [response.id]);
  assert.deepEqual((await store.listResponses({ fileIds: [] })), []);

  // Each batch's summary: lines, totals, issues and AGIG's error lines.
  assert.deepEqual(await store.batchSummaries([first.id, second.id]), [
    { batchId: first.id, lines: 2, inletTJ: '20.000', outletTJ: '12.345', issueErrors: 1, issueWarnings: 1, agigErrors: 2 },
    { batchId: second.id, lines: 1, inletTJ: '0.000', outletTJ: '12.345', issueErrors: 0, issueWarnings: 0, agigErrors: 0 },
  ]);
  assert.deepEqual(await store.batchSummaries([]), []);

  // Alerts: raised (by the worker), acknowledged, cleared.
  const alert = await store.raiseAlert({ type: 'REJECTED', severity: 'Critical', message: 'Rejected.', entityType: 'Batch', entityId: first.id, raisedAt: new Date('2026-11-16T02:11:00Z') });
  const other = await store.raiseAlert({ type: 'MAILBOX', severity: 'Warning', message: 'No entity.' });
  assert.deepEqual([alert.raisedAt, alert.acknowledgedBy, alert.clearedAt, other.entityType], ['2026-11-16T02:11:00.000Z', null, null, null]);
  assert.equal((await store.updateAlert(alert.id, { acknowledgedBy: 'ops@example.com', acknowledgedAt: new Date() })).acknowledgedBy, 'ops@example.com');
  assert.ok((await store.updateAlert(alert.id, { clearedAt: new Date() })).clearedAt);
  assert.equal(await store.updateAlert(99999, { clearedAt: new Date() }), null);
  assert.deepEqual((await store.listAlerts({ open: true })).map((item) => item.id), [other.id]);
  assert.deepEqual((await store.listAlerts({ open: false })).map((item) => item.id), [alert.id]);
  assert.deepEqual((await store.listAlerts({})).map((item) => item.id), [other.id, alert.id]);
}
