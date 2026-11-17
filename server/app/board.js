import { formatMilli, toMilli } from './quantity.js';
import { IN_FLIGHT, NEEDS_ATTENTION, PENDING, SET_ASIDE, STATUS_LABELS } from './statuses.js';
import { ADVANCE_DAYS, addDays, awstToday, daysBetween, initialCutoff, renominationCutoff } from './time.js';

// The Gas Day board answers one question first: is every Gas Day covered by an accepted nomination, and how long
// until the cutoff? One card per Gas Day from D-1 to D+7, with the design's colours:
//   green  the latest numbers published are the ones AGIG accepted
//   blue   a file is with AGIG, waiting for its answer
//   amber  newer numbers than AGIG has accepted are not sent yet, or a cutoff is close with nothing accepted
//   red    the last batch failed the checks, or its file was rejected, had no answer or may not have arrived, or
//          the cutoff passed with nothing accepted (or with newer numbers never sent)
//   grey   no active contract that day, or more than 90 days out
//   none   nothing sent yet, with time to spare
// It is worked out here from the batches, files and rows, as nom.vGasDayStatus did for Power BI.

export const BOARD_DAYS = { before: 1, after: 7 };

// What makes two rows the same line for AGIG: the Gas Day, contract, Nom Type, point, marketer and service type
// (the key nom.vAcceptedNomination ranks by).
export function lineKey(row) {
  return [row.gasDay, row.contract, row.nomType, row.designation, row.marketer ?? '', row.serviceType ?? ''].join('|');
}

export function isValidOn(record, day, fromField = 'validFrom', toField = 'validTo') {
  return record[fromField] <= day && (!record[toField] || day <= record[toField]);
}

// The nomination AGIG holds for each line of a Gas Day: for every line (contract, Nom Type, point, marketer,
// service type), the value in the latest accepted file that carried it (nom.vAcceptedNomination's rule).
export function acceptedLines(batches, filesByBatch, rowsByBatch, day, { excludeBatchId = null } = {}) {
  const accepted = batches
    .filter((batch) => batch.status === 'ACCEPTED' && batch.id !== excludeBatchId && batch.gasDayFrom <= day && day <= batch.gasDayTo)
    .map((batch) => ({ batch, sentAt: filesByBatch.get(batch.id)?.uploadedAt ?? batch.createdAt }))
    .sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)) || b.batch.id - a.batch.id);
  const lines = new Map();
  for (const { batch } of accepted) {
    for (const row of rowsByBatch.get(batch.id) ?? []) {
      if (row.gasDay !== day) continue;
      const key = lineKey(row);
      if (!lines.has(key)) lines.set(key, row);
    }
  }
  return lines;
}

function totals(rows) {
  let inlet = 0;
  let outlet = 0;
  for (const row of rows) {
    const milli = toMilli(row.quantityTJ) ?? 0;
    if (row.nomType === 'Inlet') inlet += milli;
    else outlet += milli;
  }
  return { inletTJ: formatMilli(inlet), outletTJ: formatMilli(outlet) };
}

export function latestFiles(files) {
  const byBatch = new Map();
  for (const file of files) {
    const current = byBatch.get(file.batchId);
    if (!current || current.status === 'FAILED' || (file.status !== 'FAILED' && file.id > current.id)) byBatch.set(file.batchId, file);
  }
  return byBatch;
}

export async function gasDayBoard(app) {
  const now = app.clock();
  const today = awstToday(now);
  const first = addDays(today, -BOARD_DAYS.before);
  const last = addDays(today, BOARD_DAYS.after);
  const { environment, cutoffWarningMinutes } = app.settings;
  // Accepted batches from before the window still say what AGIG holds for a day in it.
  const batches = await app.store.listBatches({ from: first, to: last, environment, limit: 1000 });
  const ids = batches.map((batch) => batch.id);
  const [files, rows, contracts] = await Promise.all([
    app.store.listFiles({ batchIds: ids }),
    app.store.listRows(ids),
    app.store.listContracts(),
  ]);
  const filesByBatch = latestFiles(files);
  const rowsByBatch = new Map();
  for (const row of rows) rowsByBatch.set(row.batchId, [...(rowsByBatch.get(row.batchId) ?? []), row]);

  const days = [];
  for (let offset = -BOARD_DAYS.before; offset <= BOARD_DAYS.after; offset += 1) {
    const day = addDays(today, offset);
    const covering = batches.filter((batch) => batch.gasDayFrom <= day && day <= batch.gasDayTo);
    const latest = covering.find((batch) => !SET_ASIDE.includes(batch.status)) ?? null;
    const accepted = covering.find((batch) => batch.status === 'ACCEPTED') ?? null;
    const inFlight = covering.find((batch) => IN_FLIGHT.includes(batch.status)) ?? null;
    const active = contracts.some((contract) => contract.isActive && isValidOn(contract, day, 'startDate', 'endDate'));
    const initial = initialCutoff(day);
    const renomination = renominationCutoff(day);
    const held = [...acceptedLines(batches, filesByBatch, rowsByBatch, day).values()];
    const latestRows = latest ? (rowsByBatch.get(latest.id) ?? []).filter((row) => row.gasDay === day) : [];

    let colour;
    let label;
    if (!active || daysBetween(today, day) > ADVANCE_DAYS) [colour, label] = ['grey', 'No active contract'];
    else if (latest && NEEDS_ATTENTION.includes(latest.status)) [colour, label] = ['red', STATUS_LABELS[latest.status]];
    else if (inFlight) [colour, label] = ['blue', 'Sent, waiting for AGIG'];
    else if (latest && accepted && latest.id === accepted.id) [colour, label] = ['green', 'Accepted'];
    else if (now > renomination && latest && PENDING.includes(latest.status)) [colour, label] = ['red', held.length ? 'Cutoff passed, newer numbers never sent' : 'Cutoff passed, nothing accepted'];
    else if (latest && PENDING.includes(latest.status)) [colour, label] = ['amber', accepted ? 'Newer numbers not sent yet' : 'Published, not sent yet'];
    else if (!held.length && now > renomination) [colour, label] = ['red', 'Cutoff passed, nothing accepted'];
    else if (held.length) [colour, label] = ['green', 'Accepted'];
    else if (now > initial) [colour, label] = ['amber', 'Nothing accepted, renominations only'];
    else if (initial.getTime() - now.getTime() < cutoffWarningMinutes * 60_000) [colour, label] = ['amber', 'Cutoff close, nothing accepted'];
    else [colour, label] = ['none', 'Nothing sent yet'];

    const latestFile = latest ? filesByBatch.get(latest.id) ?? null : null;
    const acceptedFile = accepted ? filesByBatch.get(accepted.id) ?? null : null;
    days.push({
      gasDay: day,
      offset,
      colour,
      label,
      initialCutoff: initial.toISOString(),
      renominationCutoff: renomination.toISOString(),
      latest: latest ? { batchId: latest.id, status: latest.status, statusLabel: STATUS_LABELS[latest.status], createdAt: latest.createdAt, createdBy: latest.createdBy, fileName: latestFile?.fileName ?? null, ...totals(latestRows) } : null,
      accepted: accepted ? { batchId: accepted.id, fileName: acceptedFile?.fileName ?? null, sentAt: acceptedFile?.uploadedAt ?? null } : null,
      held: { lines: held.length, ...totals(held) },
    });
  }
  return { today, now: now.toISOString(), environment, cutoffWarningMinutes, days };
}
