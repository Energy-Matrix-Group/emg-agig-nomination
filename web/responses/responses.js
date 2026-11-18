import { api, API, badge, el, fill, linkRow, modelId, showMessage, startPage, table, when } from '/shared.js';

// AGIG's answers: every response the worker recorded from AGIG's emails, matched to the file it is about, with
// the attachment to download as it arrived. A row opens the batch.

const STATE_TONE = { MATCHED: 'good', MANUAL: 'good', UNMATCHED: 'warn', UNPARSEABLE: 'bad' };
const STATE_WORDS = { MATCHED: 'Matched', MANUAL: 'Matched by hand', UNMATCHED: 'Not one of ours', UNPARSEABLE: 'Could not be read' };
const content = document.querySelector('[data-content]');

const page = await startPage('responses');
if (page) await draw();

async function draw() {
  const result = await api(`${API}/responses`);
  if (!result.ok) {
    showMessage(result.data.error);
    return;
  }
  const row = (response) => {
    const cells = [
      el('td', { class: 'small nowrap' }, when(response.receivedAt)),
      el('td', { class: 'mono small' }, response.parsedFileName ?? '(could not be read)'),
      el('td', {}, response.parsedStatus ? badge(response.parsedStatus, response.parsedStatus === 'Success' ? 'good' : 'bad') : ''),
      el('td', { class: 'nowrap' }, badge(STATE_WORDS[response.matchState] ?? response.matchState, STATE_TONE[response.matchState]), response.batchId ? [' ', el('a', { href: `/batch/?id=${response.batchId}` }, `Batch ${response.batchId}`)] : ''),
      el('td', { class: 'nowrap' }, response.batchId ? modelId(response.modelId) : ''),
      el('td', { class: 'num' }, String(response.errorCount)),
      el('td', { class: 'small' }, response.sender ?? ''),
      el('td', {}, el('a', { href: `${API}/responses/${response.id}/file` }, 'Download')),
    ];
    return response.batchId ? linkRow(`/batch/?id=${response.batchId}`, cells) : el('tr', {}, cells);
  };
  fill(content, table(['Received', 'File', 'Answer', 'Matched', 'Model', { label: 'Errors', numeric: true }, 'From', ''], result.data.responses.map(row), { empty: 'No answers from AGIG yet.' }));
}
