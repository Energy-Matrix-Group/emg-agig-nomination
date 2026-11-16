import { createHash } from 'node:crypto';
import { actorOf, requireOperator } from './access.js';
import { raise } from './alerts.js';
import { audit } from './batches.js';
import { settleAlerts } from './delivery.js';
import { httpError } from '../platform/kit.js';
import { parseResponse, subjectStatus } from './shnom.js';

// AGIG's answers. Each SHNOM file gets an email whose CSV attachment says Success or Failure, with the error lines
// on a failure. The Filename row ties it to the file sent. The mailbox job (mailbox.js) records each email; an
// operator can also upload the attachment on the Responses page. Both come through recordResponse().

const REFERENCE_CODES = new Set(['504', '505', '506', '507', '512', '519', '520']);
const MAX_RESPONSE_TEXT = 200_000;

// `incoming` is { messageId, receivedAt, sender, subject, attachmentName, text }. Recording the same message twice
// changes nothing (the message id is unique).
export async function recordResponse(app, incoming) {
  const existing = await app.store.findResponseByMessageId(incoming.messageId);
  if (existing) return { response: existing, duplicate: true };

  const text = String(incoming.text ?? '').replace(/^﻿/, '').slice(0, MAX_RESPONSE_TEXT);
  const base = {
    messageId: incoming.messageId,
    receivedAt: incoming.receivedAt ?? app.clock(),
    sender: incoming.sender?.slice(0, 200) ?? null,
    subject: String(incoming.subject ?? '').slice(0, 300) || '(no subject)',
    attachmentName: incoming.attachmentName?.slice(0, 200) ?? null,
    rawCsv: text || null,
  };
  const parsed = text ? parseResponse(text) : { problem: 'It has no CSV attachment.' };
  if (parsed.problem) {
    const response = await app.store.recordResponse({ response: { ...base, matchState: 'UNPARSEABLE' } });
    await raise(app, 'RESPONSE_REVIEW', 'Warning', `A response could not be read: ${parsed.problem} (${base.subject})`, 'Response', response.id);
    return { response, problem: parsed.problem };
  }
  const fields = { parsedFileName: parsed.fileName, parsedStatus: parsed.status, responseTimestamp: parsed.fileTimestamp };
  const fromSubject = subjectStatus(base.subject);
  const file = await app.store.findFileByName(parsed.fileName);
  if (!file) {
    const response = await app.store.recordResponse({ response: { ...base, ...fields, matchState: 'UNMATCHED' } });
    await raise(app, 'RESPONSE_REVIEW', 'Warning', `AGIG answered about ${parsed.fileName}, which this app did not send. Link it on the Responses page if it is one of ours.`, 'Response', response.id);
    return { response, unmatched: true };
  }
  return applyToFile(app, { file, parsed, warnSubject: fromSubject && fromSubject !== parsed.status, store: (change) => app.store.recordResponse({ response: { ...base, ...fields, fileId: file.id, matchState: 'MATCHED' }, ...change }) });
}

// An unmatched response that is one of ours after all (a renamed file, say): an operator links it to a file.
export async function linkResponse(app, user, responseId, body) {
  requireOperator(user);
  const response = await app.store.getResponse(responseId);
  if (!response) throw httpError(404, 'There is no such response.');
  if (response.matchState !== 'UNMATCHED') throw httpError(409, 'Only a response that was read but not matched can be linked.');
  const fileName = typeof body?.fileName === 'string' ? body.fileName.trim() : '';
  const file = fileName ? await app.store.findFileByName(fileName) : null;
  if (!file) throw httpError(404, 'There is no file of ours with that name.');
  const parsed = parseResponse(response.rawCsv ?? '');
  if (parsed.problem) throw httpError(409, `The response cannot be read: ${parsed.problem}`);
  const outcome = await applyToFile(app, {
    file, parsed, warnSubject: false,
    store: (change) => app.store.linkResponse({ responseId, patch: { fileId: file.id, matchState: 'MANUAL' }, ...change }),
  });
  await app.store.clearAlerts({ type: 'RESPONSE_REVIEW', entityType: 'Response', entityId: responseId });
  await audit(app, user, 'response.link', responseId, file.fileName, 'Response');
  return outcome;
}

// The file and its batch become RESPONDED and ACCEPTED or REJECTED, and each error line is pinned to its row by
// line number (line 1 is the header). A second answer for a file that already has one is kept, and changes nothing.
async function applyToFile(app, { file, parsed, warnSubject, store }) {
  const batch = await app.store.getBatch(file.batchId);
  const rows = await app.store.listRows([file.batchId]);
  const rowByLine = new Map(rows.map((row) => [row.csvLineNumber, row.id]));
  const errors = parsed.errors.map((error) => ({ ...error, batchRowId: rowByLine.get(error.lineNumber) ?? null }));
  // A file already has an answer once AGIG has sent one. One settled by hand (after checking the TBS portal) has
  // not: AGIG's first real answer still decides it, with an alert when it says otherwise.
  const earlier = (await app.store.listResponses({ fileIds: [file.id], limit: 5 })).filter((other) => ['MATCHED', 'MANUAL'].includes(other.matchState));
  const settled = earlier.length > 0;
  const byHand = !settled && ['ACCEPTED', 'REJECTED'].includes(batch.status);
  const accepted = parsed.status === 'Success';
  const now = app.clock();
  const response = await store({
    errors,
    file: settled ? null : { id: file.id, patch: { status: 'RESPONDED', respondedAt: now } },
    batch: settled ? null : { id: batch.id, patch: { status: accepted ? 'ACCEPTED' : 'REJECTED' } },
  });

  if (settled) {
    await raise(app, 'RESPONSE_REVIEW', 'Info', `A second answer arrived for ${file.fileName}. The first one stands.`, 'Response', response.id);
    return { response, repeated: true };
  }
  await settleAlerts(app, batch.id, batch, accepted);
  if (byHand && (batch.status === 'ACCEPTED') !== accepted) {
    await raise(app, 'RESPONSE_REVIEW', 'Critical', `AGIG's answer for ${file.fileName} is ${parsed.status}, but batch ${batch.id} had been settled by hand as ${batch.status.toLowerCase()}. AGIG's answer now stands.`, 'Response', response.id);
  }
  if (!accepted) {
    const codes = [...new Set(errors.map((error) => error.errorCode))];
    await raise(app, 'REJECTED', 'Critical', `AGIG rejected batch ${batch.id} (${file.fileName}): ${codes.length ? `errors ${codes.join(', ')}` : 'no reasons given'}. Fix the lines and publish again.`, 'Batch', batch.id);
    if (codes.includes('501')) await raise(app, 'TEMPLATE', 'Critical', `AGIG answered 501 for ${file.fileName}: its file format may have changed. Check ref.FileTemplate against AGIG's template.`);
    if (codes.some((code) => REFERENCE_CODES.has(code))) await raise(app, 'REFERENCE', 'Warning', `AGIG refused points, contracts or service types in ${file.fileName} (${codes.filter((code) => REFERENCE_CODES.has(code)).join(', ')}). The reference data may not match AGIG's.`);
  }
  if (warnSubject) await raise(app, 'RESPONSE_REVIEW', 'Warning', `The email subject and the attachment disagree for ${file.fileName}. The attachment was used.`, 'Response', response.id);
  return { response, batchId: batch.id, status: accepted ? 'ACCEPTED' : 'REJECTED' };
}

// A response uploaded on the Responses page: the attachment saved from AGIG's email.
export async function uploadResponse(app, user, body) {
  requireOperator(user);
  const text = typeof body?.text === 'string' ? body.text : '';
  if (!text.trim()) throw httpError(400, 'Choose the CSV attached to AGIG\'s email.');
  if (text.length > MAX_RESPONSE_TEXT) throw httpError(413, 'That file is too large to be an AGIG response.');
  const name = typeof body.fileName === 'string' ? body.fileName.trim().slice(0, 200) : 'response.csv';
  const digest = createHash('sha256').update(text).digest('hex');
  const outcome = await recordResponse(app, {
    messageId: `upload:${digest}`,
    receivedAt: app.clock(),
    sender: `upload:${actorOf(user)}`.slice(0, 200),
    subject: `Uploaded by ${actorOf(user)}: ${name}`,
    attachmentName: name,
    text,
  });
  if (outcome.duplicate) throw httpError(409, `That response is already recorded (response ${outcome.response.id}).`);
  await audit(app, user, 'response.upload', outcome.response.id, name, 'Response');
  return outcome;
}
