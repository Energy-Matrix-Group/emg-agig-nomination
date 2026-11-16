import { api, API, badge, dayLabel, el, fill, panel, relative, showMessage, startPage, statusBadge, timeOnly, when } from '/shared.js';

// The Gas Day board: one card per Gas Day from yesterday to a week ahead, coloured as the design set out, with
// a countdown to each cutoff. It asks again every minute, and the countdowns move every 30 seconds.

const COLOUR_WORDS = { green: 'good', blue: 'info', amber: 'warn', red: 'bad', grey: 'closed', none: 'navy' };
const content = document.querySelector('[data-content]');

let board = null;
const observer = new MutationObserver(() => tick());
observer.observe(content, { childList: true });

const page = await startPage('board');
if (page) {
  await draw();
  setInterval(draw, 60_000);
  setInterval(tick, 30_000);
}

async function draw() {
  const [boardResult, alertsResult] = await Promise.all([api(`${API}/board`), api(`${API}/alerts`)]);
  if (!boardResult.ok) {
    showMessage(boardResult.data.error);
    return;
  }
  board = boardResult.data;
  const alerts = alertsResult.ok ? alertsResult.data.alerts : [];
  const today = board.days.find((day) => day.offset === 0);
  const tomorrow = board.days.find((day) => day.offset === 1);
  fill(content,
    el('div', { class: 'emg-kpis' },
      kpi('Tomorrow', tomorrow ? tomorrow.label : '', tomorrow ? `Initial cutoff ${timeOnly(tomorrow.initialCutoff)} today` : ''),
      kpi('Today', today ? today.label : '', today ? `Renominations until ${timeOnly(today.renominationCutoff)}` : ''),
      kpi('Open alerts', String(alerts.length), alerts.length ? alerts[0].message.slice(0, 80) : 'Nothing needs you'),
    ),
    alerts.length ? alertPanel(alerts) : null,
    el('div', { class: 'days' }, board.days.map(card)),
    el('p', { class: 'muted small' }, `Times are Perth time (AWST). Updated ${when(board.now)}.`),
  );
  if (page.session.canOperate) {
    content.prepend(el('div', { class: 'toolbar' }, el('a', { class: 'emg-btn', href: '/nominate/' }, 'New nomination'), el('span', { class: 'spacer' })));
  }
}

function kpi(label, value, note) {
  const text = !/^\d+$/.test(value);
  return el('div', { class: 'emg-kpi' }, el('div', { class: 'emg-kpi__label' }, label), el('div', { class: text ? 'emg-kpi__value emg-kpi__value--text' : 'emg-kpi__value' }, value), el('div', { class: 'emg-kpi__note' }, note));
}

function alertPanel(alerts) {
  return panel('Open alerts',
    el('ul', { class: 'issues' }, alerts.slice(0, 5).map((alert) => el('li', {},
      badge(alert.severity, alert.severity === 'Critical' ? 'bad' : alert.severity === 'Warning' ? 'warn' : 'info'), ' ', alert.message))),
    el('a', { href: '/system/' }, alerts.length > 5 ? `All ${alerts.length} alerts` : 'Alerts and system'));
}

function card(day) {
  const latest = day.latest;
  const accepted = day.accepted;
  const node = el('article', { class: `day day--${day.colour}`, 'aria-label': `Gas Day ${day.gasDay}: ${day.label}` },
    el('div', { class: 'day__head' },
      el('span', { class: 'day__date' }, dayLabel(day.gasDay)),
      el('span', { class: 'day__when' }, day.offset === 0 ? 'Today' : day.offset === 1 ? 'Tomorrow' : day.offset === -1 ? 'Yesterday' : `D+${day.offset}`)),
    badge(day.label, COLOUR_WORDS[day.colour]),
    el('dl', {},
      el('dt', {}, `Initial ${timeOnly(day.initialCutoff)}`), el('dd', { dataset: { countdown: day.initialCutoff } }),
      el('dt', {}, `Renomination ${timeOnly(day.renominationCutoff)}`), el('dd', { dataset: { countdown: day.renominationCutoff } }),
      el('dt', {}, 'AGIG holds (out)'), el('dd', {}, day.held.lines ? `${day.held.outletTJ} TJ` : 'Nothing'),
      latest ? [el('dt', {}, 'Latest published (out)'), el('dd', {}, `${latest.outletTJ} TJ`)] : null,
    ),
    latest ? el('div', {}, el('a', { href: `/batch/?id=${latest.batchId}` }, `Batch ${latest.batchId}`), ' ', statusBadge({ status: latest.status, statusLabel: latest.statusLabel })) : null,
    accepted && accepted.batchId !== latest?.batchId ? el('div', { class: 'muted small' }, 'Accepted: ', el('a', { href: `/batch/?id=${accepted.batchId}` }, `batch ${accepted.batchId}`)) : null,
  );
  return node;
}

function tick() {
  const now = Date.now();
  for (const cell of document.querySelectorAll('[data-countdown]')) {
    const at = new Date(cell.dataset.countdown).getTime();
    cell.textContent = at > now ? relative(cell.dataset.countdown, now) : 'passed';
    cell.classList.toggle('passed', at <= now);
  }
}
