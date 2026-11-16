import { act, api, API, badge, button, el, fill, panel, showMessage, startPage, statusBadge, table, when } from '/shared.js';

// One batch: where it is, what to do next, its lines with AGIG's errors pinned to them, how it changes what AGIG
// held, and its history. The design's "Batch detail" and "Change view" pages, with the actions that were stored
// procedures in SSMS (approve, cancel, send anyway, mark uploaded, settle).

const content = document.querySelector('[data-content]');
const id = Number(new URLSearchParams(window.location.search).get('id'));

const page = await startPage('batches');
if (page) await draw();

async function draw() {
  if (!Number.isInteger(id) || id < 1) {
    showMessage('Open a batch from the Submissions page.');
    fill(content, );
    return;
  }
  const result = await api(`${API}/batches/${id}`);
  if (!result.ok) {
    showMessage(result.data.error);
    fill(content, );
    return;
  }
  const detail = result.data;
  const { batch } = detail;
  document.title = `Batch ${batch.id} — AGIG Nominations — EMG`;
  document.querySelector('[data-title]').textContent = `Batch ${batch.id}`;
  document.querySelector('[data-lede]').replaceChildren(statusBadge(batch), ` ${batch.gasDayFrom === batch.gasDayTo ? `Gas Day ${batch.gasDayFrom}` : `Gas Days ${batch.gasDayFrom} to ${batch.gasDayTo}`}, ${detail.rows.length} lines, ${batch.environment}.`);

  fill(content,
    nextStep(detail),
    el('ol', { class: 'timeline', 'aria-label': 'What has happened' }, detail.timeline.map((step) => el('li', { class: step.at ? 'done' : null },
      el('strong', {}, step.step), el('span', {}, step.at ? when(step.at) : 'Not yet'), step.by ? el('span', {}, step.by) : null))),
    actions(detail),
    facts(detail),
    detail.issues.length ? panel('Warnings confirmed when it was published', el('ul', { class: 'issues' }, detail.issues.map((issue) => el('li', {}, `${issue.rule}: ${issue.message}`)))) : null,
    detail.unpinnedErrors.length ? panel('AGIG errors not tied to a line', el('ul', { class: 'issues' }, detail.unpinnedErrors.map((error) => el('li', { class: 'check-error' }, `Line ${error.lineNumber}: ${error.errorCode} ${error.meaning ?? error.errorDescription ?? ''}`)))) : null,
    panel('Lines', rowsTable(detail)),
    panel('Change from what AGIG held', detail.changes.length ? changesTable(detail.changes) : el('p', { class: 'muted' }, 'No change: AGIG already held these numbers.')),
    detail.responses.length ? panel('AGIG\'s answers', responsesTable(detail.responses)) : null,
    detail.audit.length ? panel('History', table(['When', 'Who', 'What', 'Detail'], detail.audit.map((entry) => el('tr', {},
      el('td', { class: 'small nowrap' }, when(entry.at)), el('td', { class: 'small' }, entry.actor), el('td', { class: 'small' }, entry.action), el('td', { class: 'small' }, entry.detail ?? ''))))) : null,
  );
}

function nextStep({ batch, file }) {
  const words = {
    VALIDATED: ['warn', 'Waiting for approval. Approve it to make the SHNOM file.'],
    APPROVED: ['warn', 'Approved. The file is made as soon as the participant name (NOM_PARTICIPANT) is set.'],
    BUILT: ['warn', page.session.delivery === 'agent'
      ? 'Ready to send. The upload agent on the office VM will collect it within a minute or two.'
      : 'Ready to send. Download the file, upload it to AGIG\'s SFTP with WinSCP from the office VM, then press Mark as uploaded.'],
    UPLOADING: ['info', 'The upload agent is sending it now.'],
    UPLOADED: ['info', `Sent ${when(file?.uploadedAt)}. Waiting for AGIG's answer by email.`],
    UPLOAD_UNCERTAIN: ['bad', 'The upload may or may not have reached AGIG. Check AGIG\'s folder or the TBS portal, then settle it below. It is never sent again by itself.'],
    NO_RESPONSE: ['bad', 'AGIG has not answered in time. It is not assumed accepted: check the TBS portal, then settle it below.'],
    REJECTED: ['bad', 'AGIG rejected it. Its errors are shown against each line. Fix the lines and publish again: the new batch replaces this one.'],
    ACCEPTED: ['good', 'AGIG accepted it.'],
    DUPLICATE: ['note', 'These are the numbers AGIG already holds, so it was not sent. Send it anyway if it must go again.'],
    SUPERSEDED: ['note', 'A newer batch replaced this one before it was sent.'],
    CANCELLED: ['note', 'Cancelled before it was sent.'],
  }[batch.status];
  if (!words) return null;
  const [tone, text] = words;
  return el('p', { class: tone === 'bad' ? 'message' : `emg-callout emg-callout--${tone}` }, text);
}

function actions({ batch, file, actions: can }) {
  const post = (path, payload) => api(`${API}/batches/${batch.id}/${path}`, { method: 'POST', body: payload });
  const run = (trigger, path, payload, confirmText) => async () => {
    if (confirmText && !window.confirm(confirmText)) return;
    const result = await act(trigger.button, () => post(path, payload));
    if (result.ok) {
      await draw();
      const notes = result.data.warnings ?? [];
      showMessage(notes.length ? notes.join(' ') : 'Done.', { ok: !notes.length });
    }
  };
  const buttons = [];
  const add = (label, path, { payload, confirmText, quiet } = {}) => {
    const holder = {};
    holder.button = button(label, run(holder, path, payload, confirmText), { quiet });
    buttons.push(holder.button);
  };
  if (can.download && file) buttons.push(el('a', { class: 'emg-btn emg-btn--quiet', href: `${API}/batches/${batch.id}/file`, download: file.fileName }, 'Download the SHNOM file'));
  if (can.approve) add('Approve and make the file', 'approve');
  if (can.markUploaded) add('Mark as uploaded', 'uploaded', { confirmText: `Have you uploaded ${file.fileName} to AGIG's SFTP? The response timer starts now.` });
  if (can.sendAnyway) add('Send anyway', 'send-anyway', { confirmText: 'AGIG already holds these numbers. Send them again?' });
  if (can.resolve) {
    add('AGIG accepted it', 'resolve', { payload: { outcome: 'accepted', note: 'Checked in the TBS portal' }, confirmText: 'Mark this batch accepted? Only if the TBS portal shows it was.' });
    add('AGIG rejected it, or never got it', 'resolve', { payload: { outcome: 'rejected' }, quiet: true, confirmText: 'Mark this batch rejected? Publish the lines again afterwards.' });
    if (batch.status === 'UPLOAD_UNCERTAIN') add('It did not arrive: send it again', 'resolve', { payload: { outcome: 'send-again' }, quiet: true, confirmText: 'Only if you are sure AGIG does not have it. Send it again?' });
  }
  if (can.cancel) add('Cancel this batch', 'cancel', { quiet: true, confirmText: 'Cancel this batch? It will not be sent.' });
  return buttons.length ? el('div', { class: 'toolbar' }, buttons) : null;
}

function facts({ batch, file, supersededBy }) {
  const item = (label, ...value) => [el('dt', {}, label), el('dd', {}, ...value)];
  return el('dl', { class: 'facts' },
    item('Published by', batch.createdBy, el('br'), el('span', { class: 'muted small' }, when(batch.createdAt))),
    item('Approved by', batch.approvedBy ?? '—'),
    item('From', batch.sourceFile),
    item('File', file ? el('span', { class: 'mono small' }, file.fileName) : '—'),
    file ? item('File status', file.status.replaceAll('_', ' ').toLowerCase(), file.lastError ? el('span', { class: 'muted small' }, ` (${file.lastError})`) : '') : null,
    file ? item('SHA-256', el('span', { class: 'mono small' }, file.sha256)) : null,
    batch.supersedesBatchId ? item('Replaces', el('a', { href: `/batch/?id=${batch.supersedesBatchId}` }, `Batch ${batch.supersedesBatchId}`)) : null,
    supersededBy.length ? item('Replaced by', ...supersededBy.map((other) => el('a', { href: `/batch/?id=${other}` }, `Batch ${other} `))) : null,
  );
}

function rowsTable({ rows }) {
  return table(
    ['Line', 'Gas Day', 'Contract', 'Nom Type', 'Service', 'Designation', 'Location', { label: 'TJ', numeric: true }, 'Note', 'AGIG'],
    rows.map((row) => el('tr', { class: row.agigErrors.length ? 'has-error' : null },
      el('td', { class: 'muted' }, String(row.csvLineNumber)),
      el('td', { class: 'nowrap' }, row.gasDay),
      el('td', {}, row.contract),
      el('td', {}, row.nomType),
      el('td', {}, row.serviceType ?? ''),
      el('td', { class: 'mono' }, row.designation),
      el('td', { class: 'small' }, row.designationLocation ?? ''),
      el('td', { class: 'num' }, row.quantityTJ),
      el('td', { class: 'small muted' }, row.note ?? ''),
      el('td', {}, row.agigErrors.length
        ? el('ul', { class: 'error-list' }, row.agigErrors.map((error) => el('li', {}, `${error.errorCode} ${error.meaning ?? error.errorDescription ?? ''}`)))
        : row.issues.length ? badge('Warning', 'warn') : ''),
    )),
    { className: 'batch-rows' },
  );
}

function changesTable(changes) {
  return table(
    ['Gas Day', 'Contract', 'Nom Type', 'Designation', { label: 'AGIG held', numeric: true }, { label: 'This batch', numeric: true }, { label: 'Change', numeric: true }],
    changes.map((change) => el('tr', {},
      el('td', {}, change.gasDay), el('td', {}, change.contract), el('td', {}, change.nomType), el('td', { class: 'mono' }, change.designation),
      el('td', { class: 'num' }, change.before ?? '—'), el('td', { class: 'num' }, change.after ?? 'removed'),
      el('td', { class: 'num' }, change.change.startsWith('-') ? change.change : `+${change.change}`))),
  );
}

function responsesTable(responses) {
  return table(['Received', 'Status', 'How', 'Errors', ''], responses.map((response) => el('tr', {},
    el('td', { class: 'small nowrap' }, when(response.receivedAt)),
    el('td', {}, badge(response.parsedStatus ?? 'Unread', response.parsedStatus === 'Success' ? 'good' : 'bad')),
    el('td', { class: 'small' }, response.matchState.toLowerCase(), response.messageId.startsWith('upload:') ? ', uploaded by hand' : ', from the mailbox'),
    el('td', { class: 'small' }, response.errors.map((error) => `${error.lineNumber}: ${error.errorCode}`).join('; ')),
    el('td', {}, el('a', { href: `${API}/responses/${response.id}/file` }, 'Download')),
  )));
}
