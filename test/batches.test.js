import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assistant } from '../server/app/index.js';
import { TOMORROW, withApp } from './support.js';
import { acceptedDay, addContracts, answer, buildFile, dayRows, loadBatch } from './worker.js';

// Submissions, one batch in full, its file, and AGIG's responses: all read from what the worker wrote.

async function day(store) {
  await addContracts(store);
  const accepted = await acceptedDay(store, dayRows(TOMORROW), { at: '2026-11-16T01:00:00Z' });
  const rejected = await loadBatch(store, dayRows(TOMORROW, { kemerton: '18.000' }), {
    at: '2026-11-16T01:30:00Z', supersedes: accepted.id,
    issues: [{ line: 2, rule: 'RENOM', severity: 'Warning', message: 'Line 3: a renomination.' }, { line: null, rule: '524', severity: 'Warning', message: 'Outlets above inlets.' }],
  });
  const file = await buildFile(store, rejected, { at: '2026-11-16T01:35:00Z' });
  await answer(store, rejected, file, { status: 'Failure', errors: [[3, '507|522', 'Invalid Outlet Point|Total Outlet Nominated greater than contract capacity'], [9, '100', 'Invalid Gas Day']].flatMap(([line, codes, texts]) => codes.split('|').map((code, at) => [line, code, texts.split('|')[at]])), at: '2026-11-16T01:41:00Z' });
  const failed = await loadBatch(store, dayRows('2026-11-18'), { status: 'VALIDATION_FAILED', issues: [{ line: 1, rule: '522', severity: 'Error', message: 'Line 2: outlets above capacity.' }] });
  return { accepted, rejected, file, failed };
}

test('the Submissions list: newest first, each with its lines, totals, issues, AGIG errors and file', async () => {
  await withApp(async ({ ops, store }) => {
    const { accepted, rejected, failed } = await day(store);
    const { batches } = (await ops.call('/batches')).data;
    assert.deepEqual(batches.map((batch) => batch.id), [failed.id, rejected.id, accepted.id]);
    const [first, second, third] = batches;
    assert.deepEqual([first.statusLabel, first.lines, first.issueErrors, first.file], ['Failed the checks', 3, 1, null]);
    assert.deepEqual([second.status, second.lines, second.inletTJ, second.outletTJ, second.issueWarnings, second.agigErrors], ['REJECTED', 3, '20.000', '25.250', 2, 3]);
    assert.match(second.file.fileName, /^SHNOM_EMG Shipper_/);
    assert.equal(second.file.respondedAt, '2026-11-16T01:41:00.000Z');
    assert.equal(second.sourceFile.endsWith('.xlsx'), true, 'where the worker loaded it from');
    assert.deepEqual([third.status, third.agigErrors], ['ACCEPTED', 0]);
  });
});

test('the list filters by Gas Day, by status, and to the batches that need someone', async () => {
  await withApp(async ({ ops, store }) => {
    const { accepted, rejected, failed } = await day(store);
    assert.deepEqual((await ops.call(`/batches?gasDay=${TOMORROW}`)).data.batches.map((batch) => batch.id), [rejected.id, accepted.id]);
    assert.deepEqual((await ops.call('/batches?status=ACCEPTED')).data.batches.map((batch) => batch.id), [accepted.id]);
    assert.deepEqual((await ops.call('/batches?view=attention')).data.batches.map((batch) => batch.id), [failed.id, rejected.id]);
    assert.equal((await ops.call('/batches?gasDay=17/13/2026')).status, 400);
    assert.equal((await ops.call('/batches?status=NOPE')).status, 400);
  });
});

test('one batch: its rows with the checks\' findings and AGIG\'s errors on each, totals per day, and what changed', async () => {
  await withApp(async ({ ops, store }) => {
    const { accepted, rejected } = await day(store);
    const detail = (await ops.call(`/batches/${rejected.id}`)).data;
    assert.equal(detail.batch.supersedesBatchId, accepted.id);
    const kemerton = detail.rows.find((row) => row.csvLineNumber === 3);
    assert.equal(kemerton.designation, 'OS5-01');
    assert.deepEqual(kemerton.agigErrors.map((error) => [error.errorCode, error.meaning]), [
      ['507', 'Invalid Outlet Point (combination of Contract: Inlet Designation: Pipeline: Customer)'],
      ['522', 'Total Outlet Nominated greater than contract capacity'],
    ]);
    assert.deepEqual(detail.rows.find((row) => row.csvLineNumber === 4).issues.map((issue) => issue.rule), ['RENOM']);
    assert.deepEqual(detail.issues.map((issue) => issue.rule), ['524'], 'findings about the batch as a whole');
    assert.deepEqual(detail.unpinnedErrors.map((error) => [error.lineNumber, error.errorCode, error.meaning]), [[9, '100', null]], 'a line AGIG names that the file does not have, and a code not in Appendix J');
    assert.deepEqual(detail.days, [{ gasDay: TOMORROW, lines: 3, inletTJ: '20.000', outletTJ: '25.250' }]);
    assert.deepEqual(detail.changes.map((change) => [change.designation, change.before, change.after, change.change]), [['OS5-01', '12.500', '18.000', '5.500']]);
    assert.deepEqual(detail.timeline.map((step) => Boolean(step.at)), [true, true, true, true, true, true]);
    assert.equal(detail.responses[0].parsedStatus, 'Failure');
    assert.equal(detail.actions, undefined, 'nothing to do here: the app only watches');
    assert.deepEqual((await ops.call(`/batches/${accepted.id}`)).data.supersededBy, [rejected.id]);
    for (const path of ['/batches/999', '/batches/abc']) assert.equal((await ops.call(path)).status, 404, path);
  });
});

test('the SHNOM file and AGIG\'s answer download exactly as they were', async () => {
  await withApp(async ({ ops, store, base }) => {
    const { rejected, file } = await day(store);
    const csv = await fetch(`${base}/api/agig-nomination/batches/${rejected.id}/file`, { headers: { cookie: ops.cookie } });
    assert.match(csv.headers.get('content-disposition'), new RegExp(`attachment; filename="${file.fileName}"`));
    const text = await csv.text();
    assert.match(text, /^Gas Day,Shipper,Pipeline,Contract,Nom Type,Marketer,Service Type,Sub Service Type,Designation,Designation Location,Nominated Quantity \(TJ\)\r\n/);
    assert.equal((await ops.call('/batches/999/file')).status, 404);

    const { responses } = (await ops.call('/responses')).data;
    assert.equal(responses.length, 2);
    assert.deepEqual([responses[0].batchId, responses[0].parsedStatus, responses[0].errorCount, responses[0].matchState], [rejected.id, 'Failure', 3, 'MATCHED']);
    assert.equal(responses[0].rawCsv, undefined, 'the raw text comes only as a download');
    const raw = await fetch(`${base}/api/agig-nomination/responses/${responses[0].id}/file`, { headers: { cookie: ops.cookie } });
    assert.match(await raw.text(), /^Filename,SHNOM_EMG Shipper_[\s\S]*\r\nEnd$/);
  });
});

test('Joules can say how each Gas Day stands, what happened to a batch, and the open alerts', async () => {
  await withApp(async ({ store, app }) => {
    const { rejected } = await day(store);
    const user = { id: 'u', email: 'someone@energymatrix.com.au', displayName: 'Someone', role: null };
    const run = (name, input = {}) => assistant.actions.find((action) => action.name === name).run({ app, user, input });
    assert.equal((await run('gas_day_status')).days.find((item) => item.gasDay === TOMORROW).status, 'Rejected by AGIG');
    const batch = await run('batch_status', { batchId: rejected.id });
    assert.deepEqual([batch.status, batch.path, batch.agigErrors.length], ['Rejected by AGIG', `/batch/?id=${rejected.id}`, 2]);
    assert.deepEqual(await run('batch_status', { batchId: 999 }), { found: false });
    assert.deepEqual(await run('open_alerts'), { alerts: [] });
  });
});
