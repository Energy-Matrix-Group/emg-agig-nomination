import { api, API, badge, button, dayLabel, el, fill, linkRow, short, showMessage, startPage, statusBadge, table } from '/shared.js';

// Submissions: every batch the worker loaded, newest first, with its lines, totals, what the checks found, AGIG's
// errors and where its file got to. A row opens the batch and its lines.

const VIEWS = [['', 'All'], ['attention', 'Needs attention'], ['waiting', 'Waiting for AGIG']];
const STATUSES = ['', 'IMPORTED', 'VALIDATION_FAILED', 'VALIDATED', 'APPROVED', 'BUILT', 'UPLOADING', 'UPLOADED', 'UPLOAD_UNCERTAIN', 'ACCEPTED', 'REJECTED', 'NO_RESPONSE', 'DUPLICATE', 'SUPERSEDED', 'CANCELLED'];
const content = document.querySelector('[data-content]');
const query = new URLSearchParams(window.location.search);
const state = { view: query.get('view') ?? '', gasDay: query.get('gasDay') ?? '', status: query.get('status') ?? '' };
const results = el('div');
const views = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Show' });
const gasDay = el('input', { type: 'date', value: state.gasDay, onchange: (event) => { state.gasDay = event.target.value; load(); } });
const status = el('select', { onchange: (event) => { state.status = event.target.value; load(); } },
  STATUSES.map((value) => el('option', { value, selected: value === state.status }, value ? value.replaceAll('_', ' ').toLowerCase() : 'Any status')));

const page = await startPage('batches');
if (page) {
  fill(content,
    el('div', { class: 'filters' }, views, el('label', {}, 'Gas Day', gasDay), el('label', {}, 'Status', status),
      button('Clear', () => { Object.assign(state, { view: '', gasDay: '', status: '' }); gasDay.value = ''; status.value = ''; load(); }, { quiet: true, small: true })),
    results,
  );
  await load();
}

function took(from, to) {
  if (!from || !to) return '';
  const minutes = Math.round((new Date(to) - new Date(from)) / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

// Where the file got to: sent when, answered when, and how long AGIG took.
function withAgig(file) {
  if (!file) return el('span', { class: 'muted' }, 'No file');
  if (!file.uploadedAt) return el('span', { class: 'muted' }, 'Not sent');
  return [`Sent ${short(file.uploadedAt)}`, el('br'), file.respondedAt
    ? el('span', { class: 'muted' }, `Answered in ${took(file.uploadedAt, file.respondedAt)}`)
    : el('span', { class: 'muted' }, 'No answer yet')];
}

function count(number, tone, word) {
  return number ? badge(`${number} ${word}`, tone) : '';
}

async function load() {
  views.replaceChildren(...VIEWS.map(([value, label]) => el('button', {
    type: 'button', class: value === state.view ? 'is-on' : null, 'aria-pressed': String(value === state.view),
    onclick: () => { state.view = value; load(); },
  }, label)));
  const params = new URLSearchParams(Object.entries(state).filter(([, value]) => value));
  window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
  const result = await api(`${API}/batches?${params}`);
  if (!result.ok) {
    showMessage(result.data.error);
    return;
  }
  const { batches } = result.data;
  fill(results,
    el('p', { class: 'muted small' }, `${batches.length} batch${batches.length === 1 ? '' : 'es'}${state.gasDay ? ` covering ${dayLabel(state.gasDay)}` : ''}.`),
    table(
      ['Batch', 'Gas Days', 'Status', { label: 'Lines', numeric: true }, { label: 'TJ out', numeric: true }, 'Checks', 'AGIG', 'Loaded', 'With AGIG'],
      batches.map((batch) => linkRow(`/batch/?id=${batch.id}`, [
        el('td', {}, el('a', { href: `/batch/?id=${batch.id}` }, String(batch.id))),
        el('td', { class: 'nowrap' }, batch.gasDayFrom === batch.gasDayTo ? dayLabel(batch.gasDayFrom) : `${dayLabel(batch.gasDayFrom)} – ${dayLabel(batch.gasDayTo)}`),
        el('td', {}, statusBadge(batch)),
        el('td', { class: 'num' }, String(batch.lines)),
        el('td', { class: 'num' }, batch.outletTJ),
        el('td', { class: 'nowrap' }, count(batch.issueErrors, 'bad', batch.issueErrors === 1 ? 'error' : 'errors'), ' ', count(batch.issueWarnings, 'warn', batch.issueWarnings === 1 ? 'warning' : 'warnings'), batch.issueErrors || batch.issueWarnings ? '' : el('span', { class: 'muted' }, 'Clean')),
        el('td', { class: 'nowrap' }, batch.agigErrors ? badge(`${batch.agigErrors} error${batch.agigErrors === 1 ? '' : 's'}`, 'bad') : batch.status === 'ACCEPTED' ? badge('Accepted', 'good') : ''),
        el('td', { class: 'small nowrap' }, short(batch.createdAt), el('br'), el('span', { class: 'muted' }, String(batch.createdBy).split('@')[0])),
        el('td', { class: 'small nowrap', title: batch.file?.fileName ?? '' }, withAgig(batch.file)),
      ], { class: `batch-row batch-row--${batch.status.toLowerCase()}` })),
      { empty: 'No batches match.', className: 'batch-list' },
    ),
  );
}
