import { act, api, API, badge, button, el, fill, panel, relative, showMessage, startPage, table, when } from '/shared.js';

// System and alerts: what needs someone now (the open alerts, which the ops team acknowledges and clears), where
// the files are, and the alerts closed lately. The worker raises the alerts; this page only settles them.

const SEVERITY_TONE = { Critical: 'bad', Warning: 'warn', Info: 'info' };
const SEVERITY_ORDER = { Critical: 0, Warning: 1, Info: 2 };
const FILE_STATUS = { BUILT: 'Made, not sent', UPLOADING: 'Uploading', UPLOADED: 'Waiting for AGIG', UPLOAD_UNCERTAIN: 'Upload uncertain', NO_RESPONSE: 'No answer in time', RESPONDED: 'Answered' };
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
  const critical = system.alerts.filter((alert) => alert.severity === 'Critical').length;
  fill(content,
    el('div', { class: 'emg-kpis' },
      kpi('Open alerts', String(system.alerts.length), critical ? `${critical} critical` : system.alerts.length ? 'None critical' : 'Nothing needs you'),
      kpi('With AGIG', String(system.withAgig.length), system.withAgig.length ? 'Sent, no answer yet' : 'Nothing waiting on AGIG'),
      kpi('Last sent', system.lastSent ? relative(system.lastSent.uploadedAt) : 'Never', system.lastSent ? `Batch ${system.lastSent.batchId} · ${when(system.lastSent.uploadedAt)}` : ''),
      kpi('Last answer', system.lastAnswered ? relative(system.lastAnswered.respondedAt) : 'Never', system.lastAnswered ? `Batch ${system.lastAnswered.batchId} · ${when(system.lastAnswered.respondedAt)}` : ''),
    ),
    panel('Open alerts', alertsTable(system.alerts)),
    system.withAgig.length || system.waiting.length ? panel('Files on their way', filesTable([...system.withAgig, ...system.waiting])) : null,
    system.closedAlerts.length ? panel('Closed lately', table(['Raised', 'Severity', 'Alert', 'Closed'], system.closedAlerts.map((alert) => el('tr', { class: 'muted' },
      el('td', { class: 'small nowrap' }, when(alert.raisedAt)),
      el('td', {}, badge(alert.severity, 'closed')),
      el('td', { class: 'small' }, alert.message),
      el('td', { class: 'small nowrap' }, when(alert.clearedAt)))))) : null,
    el('p', { class: 'muted small' }, `Environment ${system.environment}. ${system.storage === 'memory-fallback' ? 'The database could not be used: the app is showing nothing real.' : ''}`),
  );
}

function kpi(label, value, note) {
  return el('div', { class: 'emg-kpi' }, el('div', { class: 'emg-kpi__label' }, label), el('div', { class: 'emg-kpi__value' }, value), el('div', { class: 'emg-kpi__note' }, note));
}

function alertsTable(alerts) {
  const sorted = [...alerts].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.id - a.id);
  return table(['Severity', 'Alert', 'Raised', 'Who is on it', ''], sorted.map((alert) => el('tr', {},
    el('td', {}, badge(alert.severity, SEVERITY_TONE[alert.severity])),
    el('td', {}, alert.message, alert.entityType === 'Batch' && alert.entityId ? [' ', el('a', { href: `/batch/?id=${alert.entityId}` }, `Batch ${alert.entityId}`)] : ''),
    el('td', { class: 'small nowrap' }, when(alert.raisedAt)),
    el('td', { class: 'small' }, alert.acknowledgedBy ?? el('span', { class: 'muted' }, 'Nobody yet')),
    el('td', { class: 'nowrap' }, page.session.canActOnAlerts ? [
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

function filesTable(files) {
  return table(['File', 'Batch', 'Where it is', 'Made', 'Sent'], files.map((file) => el('tr', {},
    el('td', { class: 'mono small' }, file.fileName),
    el('td', {}, el('a', { href: `/batch/?id=${file.batchId}` }, `Batch ${file.batchId}`)),
    el('td', {}, badge(FILE_STATUS[file.status] ?? file.status, ['UPLOAD_UNCERTAIN', 'NO_RESPONSE'].includes(file.status) ? 'bad' : file.status === 'BUILT' ? 'warn' : 'info')),
    el('td', { class: 'small nowrap' }, when(file.builtAt)),
    el('td', { class: 'small nowrap' }, file.uploadedAt ? `${when(file.uploadedAt)} (${relative(file.uploadedAt)})` : '—'),
  )));
}
