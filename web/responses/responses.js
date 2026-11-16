import { act, api, API, badge, button, el, fill, panel, readFileText, showMessage, startPage, table, when } from '/shared.js';

// AGIG's answers: every response, matched or not, and the way in for one the mailbox did not read. The design's
// "Responses" page, with usp_LinkResponse as a button.

const content = document.querySelector('[data-content]');

const STATE_TONE = { MATCHED: 'good', MANUAL: 'good', UNMATCHED: 'warn', UNPARSEABLE: 'bad' };

const page = await startPage('responses');
if (page) await draw();

async function draw() {
  const result = await api(`${API}/responses`);
  if (!result.ok) {
    showMessage(result.data.error);
    return;
  }
  fill(content,
    page.session.canOperate ? uploadPanel() : null,
    page.session.mailbox ? null : el('p', { class: 'emg-callout emg-callout--info' }, 'The response mailbox is not set up, so AGIG\'s answers are recorded here by hand: save the CSV attached to AGIG\'s email and upload it.'),
    table(['Received', 'From', 'File', 'Answer', 'Matched', { label: 'Errors', numeric: true }, ''],
      result.data.responses.map((response) => el('tr', {},
        el('td', { class: 'small nowrap' }, when(response.receivedAt)),
        el('td', { class: 'small' }, response.messageId.startsWith('upload:') ? 'Uploaded by hand' : response.sender ?? ''),
        el('td', { class: 'mono small' }, response.parsedFileName ?? '(could not be read)'),
        el('td', {}, response.parsedStatus ? badge(response.parsedStatus, response.parsedStatus === 'Success' ? 'good' : 'bad') : ''),
        el('td', { class: 'nowrap' }, badge(response.matchState.toLowerCase(), STATE_TONE[response.matchState]), response.batchId ? [' ', el('a', { href: `/batch/?id=${response.batchId}` }, `Batch ${response.batchId}`)] : ''),
        el('td', { class: 'num' }, String(response.errorCount)),
        el('td', { class: 'nowrap' },
          el('a', { href: `${API}/responses/${response.id}/file` }, 'Download'),
          page.session.canOperate && response.matchState === 'UNMATCHED' ? [' ', linkButton(response)] : ''),
      )), { empty: 'No answers from AGIG yet.' }),
  );
}

function uploadPanel() {
  const input = el('input', { type: 'file', accept: '.csv,text/csv,.txt', required: true });
  const send = button('Record this answer', null, { type: 'submit' });
  return panel('Upload an answer from AGIG', el('form', { class: 'form-grid', onsubmit: async (event) => {
    event.preventDefault();
    const [file] = input.files;
    if (!file) return;
    const text = await readFileText(file);
    const result = await act(send, () => api(`${API}/responses`, { method: 'POST', body: { fileName: file.name, text } }));
    if (!result.ok) return;
    const outcome = result.data;
    const words = outcome.problem ? `Recorded, but it could not be read: ${outcome.problem}`
      : outcome.unmatched ? 'Recorded, but it names a file this app did not send. Link it below if it is one of ours.'
        : outcome.repeated ? 'Recorded. That file already had an answer, so nothing changed.'
          : `Batch ${outcome.batchId} is now ${outcome.status === 'ACCEPTED' ? 'accepted' : 'rejected'}.`;
    showMessage(words, { ok: Boolean(outcome.status === 'ACCEPTED') });
    input.value = '';
    await draw();
  } }, el('label', { class: 'wide' }, 'The CSV attached to AGIG\'s email (SHNOM_Success_… or SHNOM_Failure_…)', input), send));
}

function linkButton(response) {
  const link = button('Link to a file', async () => {
    const fileName = window.prompt('The name of our SHNOM file this answer is about:', response.parsedFileName ?? '');
    if (!fileName) return;
    const result = await act(link, () => api(`${API}/responses/${response.id}/link`, { method: 'POST', body: { fileName } }));
    if (result.ok) {
      showMessage(`Linked: batch ${result.data.batchId} is now ${result.data.status === 'ACCEPTED' ? 'accepted' : 'rejected'}.`, { ok: true });
      await draw();
    }
  }, { quiet: true, small: true });
  return link;
}
