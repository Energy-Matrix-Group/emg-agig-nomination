import { badge, dayLabel, el, fill, panel, showMessage, startPage, statusBadge, table, when, api, API } from '/shared.js';

// One batch, its lines first: each line as it went to AGIG, with what the worker's checks found and AGIG's errors
// pinned to it. Then the totals for each Gas Day, the timeline, how it changes what AGIG held (the design's
// "Change view"), the file and AGIG's answers. Nothing to do here: the app only watches.

const content = document.querySelector('[data-content]');
const id = Number(new URLSearchParams(window.location.search).get('id'));
let detail = null;
let onlyProblems = false;

const WHERE_IT_IS = {
  IMPORTED: ['note', 'The worker has loaded it and is checking it.'],
  VALIDATION_FAILED: ['bad', 'It failed the worker\'s checks, so it was not sent. The problems are against each line below. Fix them in the workbook and publish again.'],
  VALIDATED: ['note', 'Checked, waiting for approval.'],
  APPROVED: ['note', 'Approved. The worker makes the file next.'],
  BUILT: ['note', 'The file is made and waiting to be sent.'],
  UPLOADING: ['info', 'The worker is sending it now.'],
  UPLOADED: ['info', 'Sent. Waiting for AGIG\'s answer by email.'],
  UPLOAD_UNCERTAIN: ['bad', 'The upload may or may not have reached AGIG. Check AGIG\'s folder or the TBS portal.'],
  NO_RESPONSE: ['bad', 'AGIG has not answered in time. It is not assumed accepted: check the TBS portal.'],
  REJECTED: ['bad', 'AGIG rejected it. Its errors are against each line below. Fix them in the workbook and publish again: the new batch replaces this one.'],
  ACCEPTED: ['good', 'AGIG accepted it.'],
  DUPLICATE: ['note', 'These are the numbers AGIG already holds, so it was not sent.'],
  SUPERSEDED: ['note', 'A newer batch replaced this one before it was sent.'],
  CANCELLED: ['note', 'Cancelled before it was sent.'],
};

const page = await startPage('batches');
if (page) await draw();


async function draw() {
  if (!Number.isInteger(id) || id < 1) {
    showMessage('Open a batch from the Submissions page.');
    content.replaceChildren();
    return;
  }
  const result = await api(`${API}/batches/${id}`);
  if (!result.ok) {
    showMessage(result.data.error);
    content.replaceChildren();
    return;
  }
  detail = result.data;
  const { batch } = detail;
  document.title = `Batch ${batch.id} — AGIG Nominations — EMG`;
  document.querySelector('[data-title]').textContent = `Batch ${batch.id}`;
  document.querySelector('[data-lede]').replaceChildren(statusBadge(batch), ` ${batch.gasDayFrom === batch.gasDayTo ? dayLabel(batch.gasDayFrom) : `${dayLabel(batch.gasDayFrom)} to ${dayLabel(batch.gasDayTo)}`} · ${detail.rows.length} lines · ${batch.environment}`);
  const [tone, words] = WHERE_IT_IS[batch.status] ?? ['note', ''];
  const problems = detail.rows.filter((row) => row.issues.length || row.agigErrors.length).length;

  fill(content,
    el('div', { class: 'toolbar' }, el('a', { class: 'emg-btn emg-btn--quiet emg-btn--sm', href: `/batches/?gasDay=${batch.gasDayFrom}` }, '← Submissions'), el('span', { class: 'spacer' }),
      detail.file ? el('a', { class: 'emg-btn emg-btn--quiet emg-btn--sm', href: `${API}/batches/${batch.id}/file`, download: detail.file.fileName }, 'Download the SHNOM file') : null),
    words ? el('p', { class: tone === 'bad' ? 'message' : `emg-callout emg-callout--${tone}` }, words) : null,
    facts(detail),
    el('section', { class: 'panel' },
      el('div', { class: 'emg-section-head' },
        el('h2', { class: 'section-label' }, 'Lines'),
        problems ? el('label', { class: 'inline-check' }, el('input', { type: 'checkbox', checked: onlyProblems, onchange: (event) => { onlyProblems = event.target.checked; drawRows(); } }), `Only the ${problems} line${problems === 1 ? '' : 's'} with a problem`) : null),
      el('div', { dataset: { rows: '' } })),
    detail.days.length > 1 || detail.issues.length || detail.unpinnedErrors.length ? panel('Totals and the batch as a whole',
      table(['Gas Day', { label: 'Lines', numeric: true }, { label: 'TJ in', numeric: true }, { label: 'TJ out', numeric: true }],
        detail.days.map((day) => el('tr', {}, el('td', {}, dayLabel(day.gasDay)), el('td', { class: 'num' }, String(day.lines)), el('td', { class: 'num' }, day.inletTJ), el('td', { class: 'num' }, day.outletTJ)))),
      detail.issues.length ? el('ul', { class: 'issues' }, detail.issues.map((issue) => el('li', { class: issue.severity === 'Error' ? 'check-error' : 'check-warning' }, `${issue.rule}: ${issue.message}`))) : null,
      detail.unpinnedErrors.length ? el('ul', { class: 'issues' }, detail.unpinnedErrors.map((error) => el('li', { class: 'check-error' }, `AGIG, line ${error.lineNumber}: ${error.errorCode} ${error.meaning ?? error.errorDescription ?? ''}`))) : null) : null,
    panel('What happened', el('ol', { class: 'timeline' }, detail.timeline.map((step) => el('li', { class: step.at ? 'done' : null },
      el('strong', {}, step.step), el('span', {}, step.at ? when(step.at) : 'Not yet'), step.by ? el('span', {}, step.by) : null)))),
    panel('Change from what AGIG held', detail.changes.length ? changesTable(detail.changes) : el('p', { class: 'muted' }, 'No change: AGIG already held these numbers.')),
    detail.responses.length ? panel('AGIG\'s answers', responsesTable(detail.responses)) : null,
  );
  drawRows();
}

function facts({ batch, file, supersededBy }) {
  const item = (label, ...value) => el('div', {}, el('dt', {}, label), el('dd', {}, ...value));
  return el('dl', { class: 'facts' },
    item('Loaded', when(batch.createdAt), el('br'), el('span', { class: 'muted small' }, batch.createdBy)),
    item('Approved', batch.approvedAt ? when(batch.approvedAt) : '—', batch.approvedBy ? [el('br'), el('span', { class: 'muted small' }, batch.approvedBy)] : ''),
    item('From the workbook snapshot', el('span', { class: 'mono small' }, batch.sourceFile)),
    item('File', file ? el('span', { class: 'mono small' }, file.fileName) : '—', file?.lastError ? [el('br'), el('span', { class: 'muted small' }, file.lastError)] : ''),
    batch.supersedesBatchId ? item('Replaces', el('a', { href: `/batch/?id=${batch.supersedesBatchId}` }, `Batch ${batch.supersedesBatchId}`)) : null,
    supersededBy.length ? item('Replaced by', ...supersededBy.map((other) => el('a', { href: `/batch/?id=${other}` }, `Batch ${other} `))) : null,
  );
}

function drawRows() {
  const rows = detail.rows.filter((row) => !onlyProblems || row.issues.length || row.agigErrors.length);
  const manyDays = detail.days.length > 1; // one Gas Day: it is in the heading, not on every line
  document.querySelector('[data-rows]').replaceChildren(table(
    ['Line', ...(manyDays ? ['Gas Day'] : []), 'Contract', 'Nom Type', 'Service', 'Designation', 'Location', { label: 'TJ', numeric: true }, 'Problems'],
    rows.map((row) => el('tr', { class: row.agigErrors.length || row.issues.some((issue) => issue.severity === 'Error') ? 'has-error' : row.issues.length ? 'has-warning' : null },
      el('td', { class: 'muted' }, String(row.csvLineNumber)),
      manyDays ? el('td', { class: 'nowrap' }, dayLabel(row.gasDay)) : null,
      el('td', {}, row.contract),
      el('td', {}, row.nomType),
      el('td', {}, row.serviceType ?? ''),
      el('td', { class: 'mono' }, row.designation),
      el('td', { class: 'small' }, row.designationLocation ?? ''),
      el('td', { class: 'num' }, row.quantityTJ),
      el('td', { class: 'small problems' },
        row.agigErrors.map((error) => el('div', { class: 'check-error' }, el('strong', {}, `AGIG ${error.errorCode}`), ` ${error.meaning ?? error.errorDescription ?? ''}`)),
        row.issues.map((issue) => el('div', { class: issue.severity === 'Error' ? 'check-error' : 'check-warning' }, el('strong', {}, `Check ${issue.rule}`), ` ${issue.message.replace(/^Line \d+: /, '')}`))),
    )),
    { className: 'batch-rows', empty: 'No line has a problem.' },
  ));
}

function changesTable(changes) {
  return table(
    ['Gas Day', 'Contract', 'Nom Type', 'Designation', { label: 'AGIG held', numeric: true }, { label: 'This batch', numeric: true }, { label: 'Change', numeric: true }],
    changes.map((change) => el('tr', {},
      el('td', {}, dayLabel(change.gasDay)), el('td', {}, change.contract), el('td', {}, change.nomType), el('td', { class: 'mono' }, change.designation),
      el('td', { class: 'num' }, change.before ?? '—'), el('td', { class: 'num' }, change.after ?? 'removed'),
      el('td', { class: 'num' }, change.change.startsWith('-') ? change.change : `+${change.change}`))),
  );
}

function responsesTable(responses) {
  return table(['Received', 'Answer', 'Errors', ''], responses.map((response) => el('tr', {},
    el('td', { class: 'small nowrap' }, when(response.receivedAt)),
    el('td', {}, badge(response.parsedStatus ?? 'Could not be read', response.parsedStatus === 'Success' ? 'good' : 'bad')),
    el('td', { class: 'small' }, response.errors.map((error) => `line ${error.lineNumber}: ${error.errorCode}`).join('; ') || '—'),
    el('td', {}, el('a', { href: `${API}/responses/${response.id}/file` }, 'Download')),
  )));
}
