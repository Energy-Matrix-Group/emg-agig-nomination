import { api, API, button, el, fill, showMessage, startPage, statusBadge, table, when } from '/shared.js';

// Submissions: every batch, newest first, with how far it got. The design's "Submissions timeline" page.

const content = document.querySelector('[data-content]');
const STATUSES = ['', 'VALIDATED', 'APPROVED', 'BUILT', 'UPLOADING', 'UPLOADED', 'UPLOAD_UNCERTAIN', 'ACCEPTED', 'REJECTED', 'NO_RESPONSE', 'DUPLICATE', 'SUPERSEDED', 'CANCELLED'];
const query = new URLSearchParams(window.location.search);
const gasDay = el('input', { type: 'date', value: query.get('gasDay') ?? '' });
const status = el('select', {}, STATUSES.map((value) => el('option', { value, selected: value === (query.get('status') ?? '') }, value ? value.replaceAll('_', ' ').toLowerCase() : 'Any status')));
const results = el('div');

const page = await startPage('batches');
if (page) {
  fill(content,
    el('form', { class: 'filters', onsubmit: (event) => { event.preventDefault(); load(); } },
      el('label', {}, 'Gas Day', gasDay), el('label', {}, 'Status', status), button('Show', null, { type: 'submit' })),
    results,
  );
  await load();
}

function minutesBetween(from, to) {
  if (!from || !to) return '';
  const minutes = Math.round((new Date(to) - new Date(from)) / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

async function load() {
  const params = new URLSearchParams();
  if (gasDay.value) params.set('gasDay', gasDay.value);
  if (status.value) params.set('status', status.value);
  window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
  const result = await api(`${API}/batches?${params}`);
  if (!result.ok) {
    showMessage(result.data.error);
    return;
  }
  results.replaceChildren(table(
    ['Batch', 'Gas Days', 'Status', 'Published', 'File', 'Sent', 'Answered', 'Publish to answer'],
    result.data.batches.map((batch) => el('tr', {},
      el('td', {}, el('a', { href: `/batch/?id=${batch.id}` }, String(batch.id))),
      el('td', { class: 'nowrap' }, batch.gasDayFrom === batch.gasDayTo ? batch.gasDayFrom : `${batch.gasDayFrom} to ${batch.gasDayTo}`),
      el('td', {}, statusBadge(batch)),
      el('td', { class: 'small' }, when(batch.createdAt), el('br'), el('span', { class: 'muted' }, batch.createdBy)),
      el('td', { class: 'mono small' }, batch.file?.fileName ?? ''),
      el('td', { class: 'small nowrap' }, when(batch.file?.uploadedAt)),
      el('td', { class: 'small nowrap' }, when(batch.file?.respondedAt)),
      el('td', { class: 'small nowrap' }, minutesBetween(batch.createdAt, batch.file?.respondedAt)),
    )),
    { empty: 'No batches match.' },
  ));
}
