import { formatMilli, toMilli } from './quantity.js';
import { IN_FLIGHT, NEEDS_ATTENTION, PENDING, SET_ASIDE, STATUS_LABELS } from './statuses.js';
import { ADVANCE_DAYS, addDays, awstToday, daysBetween, initialCutoff, renominationCutoff } from './time.js';

// The Gas Day board answers one question first: is every Gas Day covered by an accepted nomination, and how long
// until the cutoff? One line per Gas Day from today to 31 days ahead, with the design's colours:
//   green  the latest numbers published are the ones AGIG accepted
//   blue   a file is with AGIG, waiting for its answer
//   amber  newer numbers than AGIG has accepted are not sent yet, or a cutoff is close with nothing accepted
//   red    the last batch failed the checks, or its file was rejected, had no answer or may not have arrived, or
//          the cutoff passed with nothing accepted (or with newer numbers never sent)
//   grey   no active contract that day, or more than 90 days out
//   none   nothing sent yet, with time to spare
// It is worked out here from the batches, files and rows, as nom.vGasDayStatus did for Power BI.

// Today's Gas Day (its date in Perth) and the next 31 (Eve, 18 November 2026: "always ... current gas day to the
// next 31 days"). Yesterday is closed to AGIG, so it is not on the board; its batches are on Submissions.
export const BOARD_DAYS = { before: 0, after: 31 };

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

// A model that loaded a batch in the last two weeks counts as one that nominates: on a Gas Day where it has
// loaded nothing, the board says so ("nothing loaded"), without colouring the day, since the app cannot know
// whether that model was meant to nominate that day.
export const ACTIVE_MODEL_DAYS = 14;

// Worst first, for a day's colour across its models.
const COLOUR_RANK = { green: 0, none: 1, blue: 2, amber: 3, red: 4 };
const COUNT_WORDS = { green: 'accepted', blue: 'with AGIG', amber: 'loaded, not sent', red: 'need attention', none: 'nothing sent' };
export const modelOf = (batch) => batch.modelId ?? null;

// One model's state for a Gas Day (or every batch's, when nobody has a model id), by the design's colours.
// `covering` is the batches that cover the day, newest first; `pool` the batches whose accepted files say what
// AGIG holds for that model's lines.
function judge({ covering, pool, day, now, filesByBatch, rowsByBatch, cutoffWarningMinutes }) {
  const latest = covering.find((batch) => !SET_ASIDE.includes(batch.status)) ?? null;
  const accepted = covering.find((batch) => batch.status === 'ACCEPTED') ?? null;
  const inFlight = covering.find((batch) => IN_FLIGHT.includes(batch.status)) ?? null;
  const initial = initialCutoff(day);
  const renomination = renominationCutoff(day);
  const held = [...acceptedLines(pool, filesByBatch, rowsByBatch, day).values()];
  let colour;
  let label;
  if (latest && NEEDS_ATTENTION.includes(latest.status)) [colour, label] = ['red', STATUS_LABELS[latest.status]];
  else if (inFlight) [colour, label] = ['blue', 'Sent, waiting for AGIG'];
  else if (latest && accepted && latest.id === accepted.id) [colour, label] = ['green', 'Accepted'];
  else if (now > renomination && latest && PENDING.includes(latest.status)) [colour, label] = ['red', held.length ? 'Cutoff passed, newer numbers never sent' : 'Cutoff passed, nothing accepted'];
  else if (latest && PENDING.includes(latest.status)) [colour, label] = ['amber', accepted ? 'Newer numbers not sent yet' : 'Published, not sent yet'];
  else if (!held.length && now > renomination) [colour, label] = ['red', 'Cutoff passed, nothing accepted'];
  else if (held.length) [colour, label] = ['green', 'Accepted'];
  else if (now > initial) [colour, label] = ['amber', 'Nothing accepted, renominations only'];
  else if (initial.getTime() - now.getTime() < cutoffWarningMinutes * 60_000) [colour, label] = ['amber', 'Cutoff close, nothing accepted'];
  else [colour, label] = ['none', 'Nothing sent yet'];
  return { colour, label, latest, accepted, held };
}

// Lines two models both nominate for the day, from each model's latest batch. Eve's models nominate separate lines
// (18 November 2026); AGIG keeps whichever file arrives later for a line, so one model would overwrite another.
function overlapsOf(latestByModel, rowsByBatch, day) {
  const owner = new Map();
  const found = new Map();
  for (const [modelId, batch] of latestByModel) {
    for (const row of rowsByBatch.get(batch.id) ?? []) {
      if (row.gasDay !== day) continue;
      const key = lineKey(row);
      if (!owner.has(key)) owner.set(key, modelId);
      else if (owner.get(key) !== modelId) {
        const overlap = found.get(key) ?? { contract: row.contract, nomType: row.nomType, designation: row.designation, models: [owner.get(key)] };
        if (!overlap.models.includes(modelId)) overlap.models.push(modelId);
        found.set(key, overlap);
      }
    }
  }
  return [...found.values()];
}

const byModelId = (a, b) => (a.modelId === null) - (b.modelId === null) || String(a.modelId).localeCompare(String(b.modelId));

// The Gas Day board, D to D+31. With several models (Eve: more than six, each sending its own files, on lines of
// their own), each Gas Day is judged model by model, and the day is as bad as its worst model. `model` narrows the
// board to one model, judged as the whole board was before there were models.
export async function gasDayBoard(app, { model = null } = {}) {
  const now = app.clock();
  const today = awstToday(now);
  const first = addDays(today, -BOARD_DAYS.before);
  const last = addDays(today, BOARD_DAYS.after);
  const { environment, cutoffWarningMinutes } = app.settings;
  // Accepted batches from before the window still say what AGIG holds for a day in it.
  const batches = await app.store.listBatches({ from: first, to: last, environment, limit: 1000 });
  const ids = batches.map((batch) => batch.id);
  const [files, rows, contracts, knownModels] = await Promise.all([
    app.store.listFiles({ batchIds: ids }),
    app.store.listRows(ids),
    app.store.listContracts(),
    app.store.listModels({ environment }),
  ]);
  const filesByBatch = latestFiles(files);
  const rowsByBatch = new Map();
  for (const row of rows) rowsByBatch.set(row.batchId, [...(rowsByBatch.get(row.batchId) ?? []), row]);
  const activeSince = new Date(now.getTime() - ACTIVE_MODEL_DAYS * 86_400_000).toISOString();
  const models = knownModels.map(({ modelId, lastLoadedAt }) => ({ modelId, lastLoadedAt, active: lastLoadedAt >= activeSince }));
  const poolOf = new Map();
  const poolFor = (modelId) => {
    if (!poolOf.has(modelId)) poolOf.set(modelId, batches.filter((batch) => modelOf(batch) === modelId));
    return poolOf.get(modelId);
  };
  const forDay = { now, filesByBatch, rowsByBatch, cutoffWarningMinutes };
  const outletOf = (batch, day) => totals((rowsByBatch.get(batch.id) ?? []).filter((row) => row.gasDay === day)).outletTJ;

  const days = [];
  for (let offset = -BOARD_DAYS.before; offset <= BOARD_DAYS.after; offset += 1) {
    const day = addDays(today, offset);
    const covering = batches.filter((batch) => batch.gasDayFrom <= day && day <= batch.gasDayTo);
    const scope = model ? covering.filter((batch) => modelOf(batch) === model) : covering;
    const whole = judge({ ...forDay, day, covering: scope, pool: model ? poolFor(model) : batches });
    const active = contracts.some((contract) => contract.isActive && isValidOn(contract, day, 'startDate', 'endDate'));
    let { colour, label } = whole;

    // Model by model, when the board shows them all.
    const groups = new Map();
    if (!model) for (const batch of covering) groups.set(modelOf(batch), [...(groups.get(modelOf(batch)) ?? []), batch]);
    const perModel = [...groups].map(([modelId, own]) => {
      const judged = judge({ ...forDay, day, covering: own, pool: poolFor(modelId) });
      return {
        modelId,
        colour: judged.colour,
        label: judged.label,
        latest: judged.latest ? { batchId: judged.latest.id, status: judged.latest.status, statusLabel: STATUS_LABELS[judged.latest.status], outletTJ: outletOf(judged.latest, day) } : null,
        held: { lines: judged.held.length, ...totals(judged.held) },
        latestBatch: judged.latest,
      };
    }).sort(byModelId);
    const overlaps = overlapsOf(perModel.filter((item) => item.latestBatch).map((item) => [item.modelId, item.latestBatch]), rowsByBatch, day);
    const counts = { green: 0, blue: 0, amber: 0, red: 0, none: 0 };
    for (const item of perModel) counts[item.colour] += 1;
    const nothingLoaded = model ? [] : models.filter((item) => item.active && !groups.has(item.modelId)).map((item) => item.modelId);

    if (!active || daysBetween(today, day) > ADVANCE_DAYS) [colour, label] = ['grey', 'No active contract'];
    else if (perModel.length > 1 || overlaps.length) {
      colour = perModel.reduce((worst, item) => (COLOUR_RANK[item.colour] > COLOUR_RANK[worst] ? item.colour : worst), 'green');
      if (overlaps.length && COLOUR_RANK[colour] < COLOUR_RANK.amber) colour = 'amber';
      const parts = Object.entries(counts).filter(([, n]) => n).map(([tone, n]) => `${n} ${tone === 'red' && n === 1 ? 'needs attention' : COUNT_WORDS[tone]}`);
      label = `${perModel.length} models: ${parts.join(', ')}${overlaps.length ? `; ${overlaps.length} line${overlaps.length === 1 ? '' : 's'} nominated by two models` : ''}`;
    }

    const latestFile = whole.latest ? filesByBatch.get(whole.latest.id) ?? null : null;
    const acceptedFile = whole.accepted ? filesByBatch.get(whole.accepted.id) ?? null : null;
    const latestRows = whole.latest ? (rowsByBatch.get(whole.latest.id) ?? []).filter((row) => row.gasDay === day) : [];
    days.push({
      gasDay: day,
      offset,
      colour,
      label,
      initialCutoff: initialCutoff(day).toISOString(),
      renominationCutoff: renominationCutoff(day).toISOString(),
      latest: whole.latest ? { batchId: whole.latest.id, modelId: modelOf(whole.latest), status: whole.latest.status, statusLabel: STATUS_LABELS[whole.latest.status], createdAt: whole.latest.createdAt, createdBy: whole.latest.createdBy, fileName: latestFile?.fileName ?? null, ...totals(latestRows) } : null,
      accepted: whole.accepted ? { batchId: whole.accepted.id, modelId: modelOf(whole.accepted), fileName: acceptedFile?.fileName ?? null, sentAt: acceptedFile?.uploadedAt ?? null } : null,
      held: { lines: whole.held.length, ...totals(whole.held) },
      models: perModel.map(({ latestBatch, ...item }) => item),
      counts,
      nothingLoaded,
      overlaps,
    });
  }
  return { today, now: now.toISOString(), environment, cutoffWarningMinutes, model, models, days };
}
