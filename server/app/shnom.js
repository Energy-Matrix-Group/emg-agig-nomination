import { createHash } from 'node:crypto';
import { csvLine, parseDelimited } from './csv.js';
import { fileTimestamp } from './time.js';

// The two files that cross to AGIG: the SHNOM nomination we send (Appendix B) and the response AGIG emails back
// (Appendix I).

// SHNOM_<ParticipantName>_<yyyymmddhhmmss>.csv, with the time in AWST.
export function shnomFileName(participant, now) {
  return `SHNOM_${participant}_${fileTimestamp(now)}.csv`;
}

// The exact bytes of a SHNOM file: AGIG's header (from ref.FileTemplate, so a template change is one row), then a
// row per line in the order they were entered. Dates are yyyy-mm-dd, quantities have three decimals, a blank is
// an empty field (never NULL or 0), lines end CRLF, and the text is UTF-8 without a byte order mark. (CRLF and
// no BOM are what the design assumed; it is one of the questions for AGIG.)
export function buildShnom(rows, header) {
  const lines = [csvLine(header)];
  for (const row of rows) {
    lines.push(csvLine([
      row.gasDay, row.shipper, row.pipeline, row.contract, row.nomType, row.marketer ?? '', row.serviceType ?? '',
      row.subServiceType ?? '', row.designation, row.designationLocation ?? '', row.quantityTJ,
    ]));
  }
  return Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

// AGIG's response attachment: a key/value block (Filename, File Timestamp, Participant_Name, File Type, Status),
// then on a failure a "Line Number, Error Code, Error Description" header and a row per line in error, then End.
// Several errors on one line are joined with |, codes and descriptions alike: "6, 100|102, Invalid Gas Day|...".
// The keys are found by name, so a reordered block still reads. Without End the attachment is treated as cut short.
//
// Answers { fileName, fileTimestamp, participant, fileType, status: 'Success' | 'Failure', errors } or
// { problem } in words.
export function parseResponse(text) {
  const rows = parseDelimited(text, ',').map((row) => row.map((cell) => cell.trim())).filter((row) => row.some(Boolean));
  const head = {};
  let at = 0;
  for (; at < rows.length; at += 1) {
    const key = rows[at][0].toLowerCase();
    if (key === 'line number' || key === 'end') break;
    if (rows[at].length > 1) head[key.replace(/[\s_]+/g, ' ')] = rows[at].slice(1).join(',').trim();
  }
  if (!head.filename) return { problem: 'It has no Filename row.' };
  const status = { success: 'Success', failure: 'Failure', failed: 'Failure' }[String(head.status ?? '').toLowerCase()];
  if (!status) return { problem: `Its Status "${String(head.status ?? '').slice(0, 20)}" is neither Success nor Failure.` };

  const errors = [];
  let ended = false;
  if (rows[at]?.[0].toLowerCase() === 'line number') at += 1;
  for (; at < rows.length; at += 1) {
    const row = rows[at];
    if (row[0].toLowerCase() === 'end') {
      ended = true;
      break;
    }
    const lineNumber = Number(row[0]);
    if (!Number.isInteger(lineNumber) || lineNumber < 0) return { problem: `"${row[0].slice(0, 20)}" is not a line number.` };
    const codes = String(row[1] ?? '').split('|').map((code) => code.trim());
    const descriptions = row.slice(2).join(',').split('|').map((description) => description.trim());
    codes.forEach((code, index) => {
      if (code) errors.push({ lineNumber, errorCode: code.slice(0, 5), errorDescription: (descriptions[index] ?? '').slice(0, 300) || null });
    });
  }
  if (!ended) return { problem: 'It has no End row, so it may have been cut short.' };
  return {
    fileName: head.filename.slice(0, 120),
    fileTimestamp: head['file timestamp']?.slice(0, 14) ?? null,
    participant: head['participant name'] ?? null,
    fileType: head['file type'] ?? null,
    status,
    errors,
  };
}

// The subject AGIG gives the email: [SHNOM – Success] or [SHNOM – Failure], with an en dash.
export function subjectStatus(subject) {
  const match = /\[\s*SHNOM\s*[–—-]\s*(Success|Failure)\s*\]/i.exec(String(subject ?? ''));
  return match ? (match[1].toLowerCase() === 'success' ? 'Success' : 'Failure') : null;
}
