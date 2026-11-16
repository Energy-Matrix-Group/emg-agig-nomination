import { act, api, API, badge, button, el, fill, panel, relative, showMessage, startPage, table, when } from '/shared.js';

// System and alerts: the open alerts, how files reach AGIG, the response mailbox, the SFTP key and the background
// jobs. The design's "System health" page, with ops.usp_AckAlert as buttons.

const SEVERITY_TONE = { Critical: 'bad', Warning: 'warn', Info: 'info' };
const content = document.querySelector('[data-content]');

const page = await startPage('system');
if (page) {
  await draw();
  setInterval(draw, 60_000);
}

async function draw() {
  const result = await api(`${API}/system`);
  if (!result.ok) {
    showMessage(result.data.error);
    return;
  }
  const system = result.data;
  fill(content,
    panel(`Open alerts (${system.alerts.length})`, alertsTable(system.alerts)),
    el('div', { class: 'emg-kpis' },
      kpi('Environment', system.environment, system.environment === 'PROD' ? 'AGIG\'s live TBS' : 'AGIG\'s test system'),
      kpi('Last sent', system.delivery.lastSent ? relative(system.delivery.lastSent.at) : 'Never', system.delivery.lastSent?.fileName ?? ''),
      kpi('Last answer', system.delivery.lastAnswered ? relative(system.delivery.lastAnswered.at) : 'Never', system.delivery.lastAnswered?.fileName ?? ''),
      kpi('SFTP key', system.keyExpires ? `${system.keyDaysLeft} days` : 'Not set', system.keyExpires ? `Expires ${system.keyExpires}` : 'Set NOM_SFTP_KEY_EXPIRES'),
    ),
    panel('Getting files to AGIG', deliveryFacts(system)),
    panel('AGIG\'s answers by email', mailboxFacts(system)),
    panel('Settings', settingsFacts(system)),
    panel('Recent changes', table(['When', 'Who', 'What', 'Detail'], system.audit.map((entry) => el('tr', {},
      el('td', { class: 'small nowrap' }, when(entry.at)), el('td', { class: 'small' }, entry.actor), el('td', { class: 'small' }, entry.action),
      el('td', { class: 'small' }, entry.entityType === 'Batch' && entry.entityId ? el('a', { href: `/batch/?id=${entry.entityId}` }, `Batch ${entry.entityId}`) : '', ' ', entry.detail ?? ''))), { empty: 'Nothing has changed yet.' })),
  );
}

function kpi(label, value, note) {
  return el('div', { class: 'emg-kpi' }, el('div', { class: 'emg-kpi__label' }, label), el('div', { class: 'emg-kpi__value' }, value), el('div', { class: 'emg-kpi__note' }, note));
}

function alertsTable(alerts) {
  return table(['Raised', 'Severity', 'Alert', 'Status', ''], alerts.map((alert) => el('tr', {},
    el('td', { class: 'small nowrap' }, when(alert.raisedAt)),
    el('td', {}, badge(alert.severity, SEVERITY_TONE[alert.severity])),
    el('td', {}, alert.message, alert.entityType === 'Batch' ? [' ', el('a', { href: `/batch/?id=${alert.entityId}` }, `Batch ${alert.entityId}`)] : ''),
    el('td', { class: 'small' }, alert.acknowledgedBy ? `${alert.acknowledgedBy} is on it` : 'New'),
    el('td', { class: 'nowrap' }, page.session.canOperate ? [
      alert.acknowledgedBy ? '' : alertButton(alert, 'acknowledge', 'I am on it'),
      ' ', alertButton(alert, 'clear', 'Clear'),
    ] : ''),
  )), { empty: 'No open alerts. Nothing needs you.' });
}

function alertButton(alert, action, label) {
  const trigger = button(label, async () => {
    const result = await act(trigger, () => api(`${API}/alerts/${alert.id}/${action}`, { method: 'POST' }));
    if (result.ok) await draw();
  }, { quiet: action === 'clear', small: true });
  return trigger;
}

function facts(rows) {
  return el('dl', { class: 'facts' }, rows.filter(Boolean).map(([label, ...value]) => [el('dt', {}, label), el('dd', {}, ...value)]));
}

function deliveryFacts({ delivery }) {
  return el('div', { class: 'emg-stack' },
    facts([
      ['How', delivery.mode === 'agent' ? 'The upload agent on the office VM collects each file and sends it over SFTP.' : 'By hand: download the file, upload it with WinSCP from the office VM, then press Mark as uploaded.'],
      delivery.mode === 'agent' ? ['Agent last asked for work', delivery.agentSeenAt ? `${when(delivery.agentSeenAt)} (${relative(delivery.agentSeenAt)})` : 'Not since the app started'] : null,
      ['With AGIG, no answer yet', delivery.inFlight.length ? delivery.inFlight.map((file) => el('div', {}, el('a', { href: `/batch/?id=${file.batchId}` }, file.fileName), ` sent ${relative(file.uploadedAt)}`)) : 'None'],
      ['Waiting to be sent', delivery.waiting.length ? delivery.waiting.map((file) => el('div', {}, el('a', { href: `/batch/?id=${file.batchId}` }, file.fileName), ` (${file.status.replaceAll('_', ' ').toLowerCase()})`)) : 'None'],
    ]));
}

function mailboxFacts({ mailbox }) {
  if (!mailbox.configured) {
    return el('p', { class: 'muted' }, 'Not set up. Upload AGIG\'s answers on the AGIG responses page, or set the NOM_MAIL_* settings so they are read by themselves.');
  }
  const check = button('Check the mailbox now', async () => {
    const result = await act(check, () => api(`${API}/mailbox/check`, { method: 'POST' }));
    if (result.ok) {
      showMessage('Checking. This page looks again in a few seconds.', { ok: true });
      setTimeout(draw, 5000);
    }
  }, { quiet: true, small: true });
  return el('div', { class: 'emg-stack' }, facts([
    ['Mailbox', mailbox.mailbox],
    ['Last read', mailbox.lastOkAt ? `${when(mailbox.lastOkAt)} (${relative(mailbox.lastOkAt)})` : 'Not yet'],
    ['Answers recorded since the app started', String(mailbox.recorded ?? 0)],
    mailbox.lastError ? ['Last problem', el('span', { class: 'check-error' }, mailbox.lastError)] : null,
  ]), page.session.canOperate ? el('div', {}, check) : null);
}

function settingsFacts(system) {
  return facts([
    ['Participant name', system.participant ?? el('span', { class: 'check-error' }, 'Not set (NOM_PARTICIPANT)')],
    ['Approval', system.autoApprove ? 'Publishing is the approval' : 'An operator approves each batch'],
    ['No answer after', `${system.responseTimeoutMinutes} minutes`],
    ['Cutoff warning', `${system.cutoffWarningMinutes} minutes before`],
    ['Alerts to Teams', system.teams ? 'On' : 'Off (NOM_TEAMS_WEBHOOK_URL)'],
    ['Storage', system.storage === 'sql' ? 'The app\'s SQL database' : system.storage === 'memory' ? 'Memory (local work only)' : 'Memory: the database could not be used'],
    ['Background jobs', Object.keys(system.jobs).length
      ? Object.entries(system.jobs).map(([name, job]) => el('div', {}, `${name}: `, job.lastError ? el('span', { class: 'check-error' }, job.lastError) : `fine, ${relative(job.lastOkAt)}`))
      : 'Starting'],
  ]);
}
