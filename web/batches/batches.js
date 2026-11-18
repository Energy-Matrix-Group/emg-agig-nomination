import { api, API, badge, button, el, fill, gasDay, linkRow, modelId, showMessage, startPage, statusBadge, table, took, when } from '/shared.js';

// Submissions: every batch the worker loaded, newest first, with the workbook model it came from, its lines, totals, what the checks found, AGIG's
// errors and where its file got to. A row opens the batch and its lines.

const VIEWS = [['', 'All'], ['attention', 'Needs attention'], ['waiting', 'Waiting for AGIG']];
const STATUSES = ['', 'IMPORTED', 'VALIDATION_FAILED', 'VALIDATED', 'APPROVED', 'BUILT', 'UPLOADING', 'UPLOADED', 'UPLOAD_UNCERTAIN', 'ACCEPTED', 'REJECTED', 'NO_RESPONSE', 'DUPLICATE', 'SUPERSEDED', 'CANCELLED'];
const content = document.querySelector('[data-content]');
const query = new URLSearchParams(window.location.search);
const state = { view: query.get('view') ?? '', gasDay: query.get('gasDay') ?? '', model: query.get('model') ?? '', status: query.get('status') ?? '' };
const results = el('div');
const views = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Show' });
const dayInput = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'yyyy-mm-dd', maxlength: '10', value: state.gasDay, 'aria-label': 'Gas Day, yyyy-mm-dd', onchange: (event) => {
  const value = event.target.value.trim();
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    showMessage('Type the Gas Day as yyyy-mm-dd, for example 2026-11-17.');
    return;
  }
  showMessage('');
  state.gasDay = value;
  load();
} });
// Each workbook model sends its own batches (Eve, 18 November 2026): the list can show one model's.
const model = el('select', { onchange: (event) => { state.model = event.target.value; load(); } }, el('option', { value: '' }, 'Any model'));
const status = el('select', { onchange: (event) => { state.status = event.target.value; load(); } },
  STATUSES.map((value) => el('option', { value, selected: value === state.status }, value ? value.replaceAll('_', ' ').toLowerCase() : 'Any status')));

const page = await startPage('batches');
if (page) {
  fill(content,
    el('div', { class: 'filters' }, views, el('label', {}, 'Gas Day', dayInput), el('label', {}, 'Model', model), el('label', {}, 'Status', status),
      button('Clear', () => { Object.assign(state, { view: '', gasDay: '', model: '', status: '' }); dayInput.value = ''; model.value = ''; status.value = ''; load(); }, { quiet: true, small: true })),
    results,
  );
  await Promise.all([fillModels(), load()]);
}

// The models that have loaded a batch here, for the Model filter (and the one in the address, if it has none yet).
async function fillModels() {
  const result = await api(`${API}/models`);
  const ids = result.ok ? result.data.models.map((item) => item.modelId) : [];
  if (state.model && !ids.includes(state.model)) ids.push(state.model);
  model.append(...ids.map((id) => el('option', { value: id, selected: id === state.model }, id)));
}

// What the worker's checks found and AGIG's error lines, side by side in one cell.
function problems(batch) {
  const parts = [];
  if (batch.issueErrors) parts.push(badge(`${batch.issueErrors} error${batch.issueErrors === 1 ? '' : 's'}`, 'bad'));
  if (batch.issueWarnings) parts.push(badge(`${batch.issueWarnings} warning${batch.issueWarnings === 1 ? '' : 's'}`, 'warn'));
  if (batch.agigErrors) parts.push(badge(`AGIG ${batch.agigErrors}`, 'bad'));
  return parts.length ? parts.flatMap((part, at) => (at ? [' ', part] : [part])) : el('span', { class: 'muted' }, '—');
}

function dash(text) {
  return text || el('span', { class: 'muted' }, '—');
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
    el('p', { class: 'muted small' }, `${batches.length} batch${batches.length === 1 ? '' : 'es'}${state.model ? ` from ${state.model}` : ''}${state.gasDay ? ` covering ${gasDay(state.gasDay)}` : ''}.`),
    table(
      ['Batch', 'Model', 'Gas Day', 'Status', { label: 'Lines', numeric: true }, { label: 'TJ out', numeric: true }, 'Problems', 'Loaded', 'By', 'Sent', 'Answered', { label: 'Took', numeric: true }],
      batches.map((batch) => linkRow(`/batch/?id=${batch.id}`, [
        el('td', {}, el('a', { href: `/batch/?id=${batch.id}` }, String(batch.id))),
        el('td', {}, modelId(batch.modelId)),
        el('td', {}, batch.gasDayFrom === batch.gasDayTo ? gasDay(batch.gasDayFrom) : `${gasDay(batch.gasDayFrom)} to ${gasDay(batch.gasDayTo)}`),
        el('td', {}, statusBadge(batch)),
        el('td', { class: 'num' }, String(batch.lines)),
        el('td', { class: 'num' }, batch.outletTJ),
        el('td', {}, problems(batch)),
        el('td', { class: 'num' }, when(batch.createdAt)),
        el('td', { title: batch.createdBy }, String(batch.createdBy).split('@')[0]),
        el('td', { class: 'num', title: batch.file?.fileName ?? '' }, dash(when(batch.file?.uploadedAt))),
        el('td', { class: 'num' }, dash(when(batch.file?.respondedAt))),
        el('td', { class: 'num' }, dash(took(batch.file?.uploadedAt, batch.file?.respondedAt))),
      ], { class: `batch-row batch-row--${batch.status.toLowerCase()}` })),
      { empty: 'No batches match.', className: 'batch-list' },
    ),
  );
}
