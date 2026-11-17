// A stand-in for the design's nomination worker, for the tests and the demo (scripts/demo.js). The worker loads
// each Excel snapshot into nom.Batch and nom.BatchRow, records its checks in nom.ValidationIssue, builds the SHNOM
// file into nom.OutboundFile, uploads it, records AGIG's emailed answer in nom.InboundResponse and
// nom.ResponseError, and raises alerts in ops.Alert. This writes the same rows through the store, so the app can
// be shown and tested exactly as it will read the worker's.

const HEADER = ['Gas Day', 'Shipper', 'Pipeline', 'Contract', 'Nom Type', 'Marketer', 'Service Type', 'Sub Service Type', 'Designation', 'Designation Location', 'Nominated Quantity (TJ)'];

export async function addContracts(store, { from = '2026-01-01' } = {}) {
  const transport = await store.createContract({ code: 'Shipper1_FH01', type: 'Transport', pipelineCode: 'DBNGP', startDate: from, endDate: null, capacityTJ: '25', serviceType: 'T1', subServiceType: null, isActive: true });
  const spot = await store.createContract({ code: 'Shipper1_SPOT', type: 'Spot', pipelineCode: 'DBNGP', startDate: from, endDate: null, capacityTJ: null, serviceType: 'SPOT', subServiceType: null, isActive: true });
  return { transport, spot };
}

const line = (gasDay, contract, nomType, designation, location, quantityTJ, serviceType = nomType === 'Outlet' ? 'T1' : null) => ({
  gasDay, shipper: 'Shipper1', pipeline: 'DBNGP', contract, nomType, marketer: null, serviceType, subServiceType: serviceType,
  designation, designationLocation: location, quantityTJ,
});

// A day's nomination: 20 TJ in at Karratha, out at Kemerton and Pinjarra (19.750 TJ out with the defaults).
export function dayRows(gasDay, { kemerton = '12.500', spot = null } = {}) {
  const rows = [
    line(gasDay, 'Shipper1_FH01', 'Inlet', 'I1-01', 'KGP', '20.000'),
    line(gasDay, 'Shipper1_FH01', 'Outlet', 'OS5-01', 'Kemerton', kemerton),
    line(gasDay, 'Shipper1_FH01', 'Outlet', 'OS2-01', 'Alcoa Pinjarra', '7.250'),
  ];
  if (spot) rows.push(line(gasDay, 'Shipper1_SPOT', 'Outlet', 'OS5-01', 'Kemerton', spot, 'SPOT'));
  return rows;
}

let snapshot = 0;

// The worker loads a snapshot and checks it: VALIDATED (then APPROVED, when approval is automatic) or
// VALIDATION_FAILED, with what its checks found. `issues` are { line, rule, severity, message }, line 0-based.
export async function loadBatch(store, rows, { status = 'APPROVED', issues = [], by = 'olive.ops@energymatrix.com.au', at = null, environment = 'NP', supersedes = null } = {}) {
  const days = rows.map((row) => row.gasDay).sort();
  snapshot += 1;
  const when = at ? new Date(at) : null;
  return store.createBatch({
    batch: {
      environment, status, gasDayFrom: days[0], gasDayTo: days.at(-1),
      sourceFile: `F:\\AGIG SFTP TEST\\Archive\\NOM_${by.split('@')[0]}_${String(snapshot).padStart(4, '0')}.xlsx`,
      sourceSha256: `${snapshot}`.padStart(64, 'a'), contentSha256: `${snapshot}`.padStart(64, 'c'), supersedesBatchId: supersedes,
      createdBy: by, createdAt: when, validatedAt: when, approvedBy: status === 'APPROVED' ? by : null, approvedAt: status === 'APPROVED' ? when : null,
    },
    rows: rows.map((row, at2) => ({ ...row, csvLineNumber: at2 + 2 })),
    issues,
  });
}

function shnom(rows) {
  const cell = (value) => (value === null || value === undefined ? '' : String(value));
  return Buffer.from(`${[HEADER, ...rows.map((row) => [row.gasDay, row.shipper, row.pipeline, row.contract, row.nomType, row.marketer, row.serviceType, row.subServiceType, row.designation, row.designationLocation, row.quantityTJ])].map((values) => values.map(cell).join(',')).join('\r\n')}\r\n`);
}

// The worker builds the file (BUILT); `sent` uploads it too (UPLOADED).
export async function buildFile(store, batch, { sent = true, at: given = new Date() } = {}) {
  const at = new Date(given);
  const rows = await store.listRows([batch.id]);
  const stamp = new Date(new Date(at).getTime() + 8 * 3600_000).toISOString().replace(/\D/g, '').slice(0, 14);
  const file = await store.createFile({ batchId: batch.id, fileName: `SHNOM_EMG Shipper_${stamp}_${batch.id}.csv`, body: shnom(rows), sha256: 'f'.repeat(64), status: 'BUILT', builtAt: at });
  await store.updateBatch(batch.id, { status: 'BUILT' });
  if (sent) {
    await store.updateFile(file.id, { status: 'UPLOADED', uploadedAt: at, remoteSize: shnom(rows).length });
    await store.updateBatch(batch.id, { status: 'UPLOADED' });
  }
  return store.getFile(file.id);
}

// AGIG's emailed answer, matched to the file. `errors` are [csvLine, code, description].
export async function answer(store, batch, file, { status = 'Success', errors = [], at: given = new Date() } = {}) {
  const at = new Date(given);
  const rows = await store.listRows([batch.id]);
  const rowId = new Map(rows.map((row) => [row.csvLineNumber, row.id]));
  const raw = [`Filename,${file.fileName}`, 'File Timestamp,20261116103000', 'Participant_Name,EMG Shipper', 'File Type,SHNOM', `Status,${status}`,
    ...(errors.length ? ['Line Number,Error Code,Error Description', ...errors.map(([lineNumber, code, text]) => `${lineNumber},${code},${text}`)] : []), 'End'].join('\r\n');
  return store.recordResponse({
    response: {
      messageId: `graph-${batch.id}-${file.id}`, receivedAt: at, sender: 'tbs@agig.example', subject: `[SHNOM – ${status}]`,
      attachmentName: `SHNOM_${status}_20261116103000.csv`, rawCsv: raw, parsedFileName: file.fileName, parsedStatus: status,
      responseTimestamp: '20261116103000', fileId: file.id, matchState: 'MATCHED',
    },
    errors: errors.map(([lineNumber, errorCode, errorDescription]) => ({ lineNumber, errorCode, errorDescription, batchRowId: rowId.get(lineNumber) ?? null })),
    file: { id: file.id, patch: { status: 'RESPONDED', respondedAt: at } },
    batch: { id: batch.id, patch: { status: status === 'Success' ? 'ACCEPTED' : 'REJECTED' } },
  });
}

// Loads, sends and has AGIG accept a day in one go.
export async function acceptedDay(store, rows, { at = new Date(), supersedes = null } = {}) {
  const batch = await loadBatch(store, rows, { at, supersedes });
  const sent = new Date(new Date(at).getTime() + 2 * 60_000);
  const file = await buildFile(store, batch, { at: sent });
  await answer(store, batch, file, { at: new Date(sent.getTime() + 6 * 60_000) });
  return store.getBatch(batch.id);
}

export async function raiseAlert(store, type, severity, message, { entityType = null, entityId = null, at = null } = {}) {
  return store.raiseAlert({ type, severity, message, entityType, entityId, raisedAt: at });
}
