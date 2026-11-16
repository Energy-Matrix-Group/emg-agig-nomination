import { actorOf, requireOperator } from './access.js';
import { clear, gasDayEntity, raise } from './alerts.js';
import { audit, batchOr404, newerBatch } from './batches.js';
import { httpError } from '../platform/kit.js';
import { IN_FLIGHT } from './statuses.js';
import { initialCutoff, renominationCutoff } from './time.js';

// Getting a built file to AGIG's SFTP, and settling a file whose fate is unknown.
//
// AGIG only accepts SFTP connections from the office's registered IP address, and the private key it issued
// stays on the office VM. So this app, which runs on DigitalOcean, never connects to AGIG itself. A file goes:
//   - by hand: download it, upload it with WinSCP from the VM, then press "Mark as uploaded"; or
//   - by the upload agent on the VM (scripts/agent/Send-Nominations.ps1), which asks this app for the next
//     file with a service token (NOM_AGENT_TOKEN), uploads it, and reports back.
// Either way the app records when it went, and the response timer starts.

export async function liveFile(app, batchId) {
  const files = await app.store.listFiles({ batchIds: [batchId] });
  return files.filter((file) => file.status !== 'FAILED').at(-1) ?? null;
}

// Files with AGIG and no answer yet. AGIG processes files in the order they arrive, so the design sends one at a
// time per environment.
export async function filesInFlight(app) {
  const files = await app.store.listFiles({ status: IN_FLIGHT });
  if (!files.length) return [];
  const batches = await app.store.listBatches({ ids: files.map((file) => file.batchId), environment: app.settings.environment });
  const here = new Set(batches.map((batch) => batch.id));
  return files.filter((file) => here.has(file.batchId));
}

// Whether the upload agent is at work: it is set up and has asked for work in the last 10 minutes. While it is, a
// built file is its to send, so nobody also uploads it by hand (AGIG would get it twice).
const AGENT_ACTIVE_MS = 10 * 60_000;

export function agentActive(app) {
  return app.settings.agentEnabled && Boolean(app.runtime.agentSeenAt) && app.clock() - app.runtime.agentSeenAt < AGENT_ACTIVE_MS;
}

// A file is past its time once the 20:00 cutoff of its first Gas Day has gone: AGIG rejects such a file (502).
export const pastCutoff = (app, batch) => app.clock() > renominationCutoff(batch.gasDayFrom);

const MANUAL_FROM = ['BUILT', 'UPLOAD_UNCERTAIN'];

export async function markUploaded(app, user, id) {
  requireOperator(user);
  const batch = await batchOr404(app, id);
  const file = await liveFile(app, id);
  if (!file || !MANUAL_FROM.includes(file.status) || !MANUAL_FROM.includes(batch.status)) {
    throw httpError(409, `Batch ${id} has no file waiting to be sent by hand.`);
  }
  if (batch.status === 'BUILT' && agentActive(app)) {
    throw httpError(409, 'The upload agent on the office VM is sending files and will send this one. Upload it by hand only if the agent stops.');
  }
  const others = (await filesInFlight(app)).filter((other) => other.id !== file.id);
  const now = app.clock();
  if (!await app.store.updateFile(file.id, { status: 'UPLOADED', uploadedAt: now }, { from: MANUAL_FROM })) throw httpError(409, 'The file changed just now. Look again.');
  await app.store.updateBatch(id, { status: 'UPLOADED' }, { from: MANUAL_FROM });
  await clear(app, 'UPLOAD_UNCERTAIN', 'Batch', id);
  await clear(app, 'LATE', 'Batch', id);
  await audit(app, user, 'batch.mark-uploaded', id, file.fileName);
  const warnings = [];
  if (others.length) warnings.push(`${others.map((other) => other.fileName).join(', ')} is still waiting for AGIG's answer. AGIG processes files in the order they arrive.`);
  if (pastCutoff(app, batch)) warnings.push(`The 20:00 cutoff for ${batch.gasDayFrom} has passed: if AGIG received the file after it, AGIG rejects those lines (502).`);
  return { batch: await app.store.getBatch(id), warnings };
}

// Sets aside a built batch that must not go: a newer batch replaced it.
async function setAside(app, batch, file, note) {
  if (!await app.store.updateBatch(batch.id, { status: 'SUPERSEDED' }, { from: ['BUILT', 'UPLOADING'] })) return false;
  if (file) await app.store.updateFile(file.id, { status: 'FAILED', lastError: note });
  return true;
}

// For a file with no answer, or an upload that may not have arrived, once someone has checked with AGIG or in
// the TBS portal: it was accepted, it was rejected (or never arrived), or (for an uncertain upload) send it again.
const OUTCOMES = ['accepted', 'rejected', 'send-again'];

export async function resolve(app, user, id, body) {
  requireOperator(user);
  const outcome = body?.outcome;
  if (!OUTCOMES.includes(outcome)) throw httpError(400, `Say what happened: outcome must be one of ${OUTCOMES.join(', ')}.`);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  const batch = await batchOr404(app, id);
  const from = outcome === 'send-again' ? ['UPLOAD_UNCERTAIN', 'NO_RESPONSE'] : ['NO_RESPONSE', 'UPLOAD_UNCERTAIN'];
  if (!from.includes(batch.status)) throw httpError(409, `Batch ${id} is ${batch.status.toLowerCase()}: only a file with no answer or an uncertain upload is settled by hand.`);
  const file = await liveFile(app, id);
  const now = app.clock();
  const by = actorOf(user);
  if (outcome === 'accepted') {
    if (file) await app.store.updateFile(file.id, { status: 'RESPONDED', respondedAt: now, lastError: `Marked accepted by ${by}${note ? `: ${note}` : ''}` });
    await app.store.updateBatch(id, { status: 'ACCEPTED' }, { from });
    await settleAlerts(app, id, batch, true);
  } else if (outcome === 'rejected') {
    if (file) await app.store.updateFile(file.id, { status: 'FAILED', lastError: `Marked rejected by ${by}${note ? `: ${note}` : ''}` });
    await app.store.updateBatch(id, { status: 'REJECTED' }, { from });
    await settleAlerts(app, id, batch, false);
  } else {
    const newer = await newerBatch(app, batch);
    if (newer) throw httpError(409, `Batch ${newer.id}, published later for these Gas Days, has the newer numbers, so this file is not sent again. Settle this one as rejected.`);
    if (file) await app.store.updateFile(file.id, { status: 'BUILT', uploadedAt: null, lastError: `Sent again by ${by}${note ? `: ${note}` : ''}` });
    await app.store.updateBatch(id, { status: 'BUILT' }, { from });
    await settleAlerts(app, id, batch, false);
  }
  await audit(app, user, `batch.resolve-${outcome}`, id, note || null);
  return { batch: await app.store.getBatch(id) };
}

// Alerts about a batch that is settled now. Once accepted, the cutoff and stale alerts for its days go too.
export async function settleAlerts(app, id, batch, accepted) {
  await clear(app, 'NO_RESPONSE', 'Batch', id);
  await clear(app, 'UPLOAD_UNCERTAIN', 'Batch', id);
  await clear(app, 'UPLOAD_FAILED', 'Batch', id);
  if (!accepted) return;
  for (let day = batch.gasDayFrom; day <= batch.gasDayTo; day = nextDay(day)) {
    await clear(app, 'CUTOFF', 'GasDay', gasDayEntity(day));
    await clear(app, 'STALE', 'GasDay', gasDayEntity(day));
  }
}

function nextDay(day) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// The upload agent asks for the next file. It gets the oldest built file that may still go, unless another is
// still with AGIG (one in flight at a time); then only a file whose first initial cutoff is within the cutoff
// warning goes, since waiting could miss it. A file past its 20:00 cutoff is never handed out (the watchdog
// raises an alert for it), and one that a newer batch replaced is set aside, so old numbers never follow new ones.
// Claiming moves the batch, then the file, to UPLOADING, so it is handed out once, and a cancel cannot slip in.
export async function claimNext(app) {
  const now = app.clock();
  app.runtime.agentSeenAt = now;
  const inFlight = await filesInFlight(app);
  const candidates = [];
  for (const file of await app.store.listFiles({ status: 'BUILT' })) {
    const batch = await app.store.getBatch(file.batchId);
    if (!batch || batch.environment !== app.settings.environment || batch.status !== 'BUILT' || pastCutoff(app, batch)) continue;
    const newer = await newerBatch(app, batch);
    if (newer) {
      await setAside(app, batch, file, `Not sent: batch ${newer.id} replaced it.`);
      continue;
    }
    const urgent = initialCutoff(batch.gasDayFrom).getTime() - now.getTime() < app.settings.cutoffWarningMinutes * 60_000;
    candidates.push({ file, batch, urgent });
  }
  const pick = inFlight.length ? candidates.find((candidate) => candidate.urgent) : candidates[0];
  if (!pick) return candidates.length && inFlight.length ? { file: null, waitingFor: inFlight[0].fileName } : { file: null };
  if (!await app.store.updateBatch(pick.batch.id, { status: 'UPLOADING' }, { from: ['BUILT'] })) return { file: null };
  if (!await app.store.updateFile(pick.file.id, { status: 'UPLOADING', attempts: '+1' }, { from: ['BUILT'] })) {
    await app.store.updateBatch(pick.batch.id, { status: 'BUILT' }, { from: ['UPLOADING'] });
    return { file: null };
  }
  app.runtime.uploadingSince.set(pick.file.id, now);
  const full = await app.store.getFile(pick.file.id, { body: true });
  return {
    file: { id: full.id, batchId: pick.batch.id, fileName: full.fileName, sha256: full.sha256, size: full.body.length, body: full.body.toString('base64') },
    environment: app.settings.environment,
  };
}

// What the agent says happened: uploaded (with the size it found on AGIG's server), not sent (the connection
// failed before the upload started, so it is safe to try again), or uncertain (it failed during the upload: the
// file may or may not have arrived, so it is never sent again on its own).
export async function agentResult(app, fileId, body) {
  app.runtime.agentSeenAt = app.clock();
  const file = await app.store.getFile(fileId, { body: true });
  if (!file) throw httpError(404, 'There is no such file.');
  if (file.status !== 'UPLOADING') throw httpError(409, `${file.fileName} is not being uploaded.`);
  const error = typeof body?.error === 'string' ? body.error.trim().slice(0, 1000) : null;
  const batchId = file.batchId;
  app.runtime.uploadingSince.delete(fileId);
  if (body?.outcome === 'uploaded') {
    const remoteSize = Number.isInteger(body.remoteSize) ? body.remoteSize : null;
    if (remoteSize !== file.body.length) {
      await app.store.updateFile(fileId, { status: 'UPLOAD_UNCERTAIN', remoteSize, lastError: `AGIG's copy is ${remoteSize ?? 'of unknown size'}, not ${file.body.length} bytes.` }, { from: ['UPLOADING'] });
      await app.store.updateBatch(batchId, { status: 'UPLOAD_UNCERTAIN' }, { from: ['UPLOADING'] });
      await raise(app, 'UPLOAD_UNCERTAIN', 'Critical', `${file.fileName}: the copy on AGIG's server is not the size sent. Check it, then settle batch ${batchId}.`, 'Batch', batchId);
      return { recorded: 'uncertain' };
    }
    await app.store.updateFile(fileId, { status: 'UPLOADED', uploadedAt: app.clock(), remoteSize, lastError: null }, { from: ['UPLOADING'] });
    await app.store.updateBatch(batchId, { status: 'UPLOADED' }, { from: ['UPLOADING'] });
    await clear(app, 'UPLOAD_FAILED', 'Batch', batchId);
    return { recorded: 'uploaded' };
  }
  if (body?.outcome === 'not-sent') {
    // A newer batch published while this one was being tried has the newer numbers: this one must not go now.
    const batch = await app.store.getBatch(batchId);
    const newer = batch ? await newerBatch(app, batch) : null;
    if (newer && await setAside(app, batch, file, `Not sent: batch ${newer.id} replaced it.`)) return { recorded: 'superseded' };
    await app.store.updateFile(fileId, { status: 'BUILT', lastError: error ?? 'The agent could not connect.' }, { from: ['UPLOADING'] });
    await app.store.updateBatch(batchId, { status: 'BUILT' }, { from: ['UPLOADING'] });
    if (file.attempts >= 3) await raise(app, 'UPLOAD_FAILED', 'Critical', `${file.fileName} could not be sent after ${file.attempts} tries: ${error ?? 'no reason given'}`, 'Batch', batchId);
    return { recorded: 'not-sent' };
  }
  if (body?.outcome === 'uncertain') {
    await app.store.updateFile(fileId, { status: 'UPLOAD_UNCERTAIN', lastError: error ?? 'The upload failed part way.' }, { from: ['UPLOADING'] });
    await app.store.updateBatch(batchId, { status: 'UPLOAD_UNCERTAIN' }, { from: ['UPLOADING'] });
    await raise(app, 'UPLOAD_UNCERTAIN', 'Critical', `${file.fileName} may or may not have reached AGIG (${error ?? 'no reason given'}). Check, then settle batch ${batchId}.`, 'Batch', batchId);
    return { recorded: 'uncertain' };
  }
  throw httpError(400, 'outcome must be uploaded, not-sent or uncertain.');
}
