import { api } from '/platform/api.js';
import { appIcon } from '/platform/icons.js';
import { mountChrome, requireUser } from '/platform/shell.js';

// What every page of AGIG Nominations shares: the shell and its links, the environment banner, and small helpers
// for building the page. Everything from the API is put on the page with textContent (el() below), never as markup.
// The app only watches what the nomination worker writes; the one thing a page can change is an alert.

export const ID = document.body.dataset.app; // set in each page's HTML: the one place a page names the app
export const API = `/api/${ID}`;

const PAGES = [
  { key: 'board', label: 'Gas Day board', href: '/', icon: 'overview' },
  { key: 'batches', label: 'Submissions', href: '/batches/', icon: 'devboard' },
  { key: 'responses', label: 'AGIG responses', href: '/responses/', icon: 'documentation' },
  { key: 'system', label: 'System and alerts', href: '/system/', icon: 'admin-settings' },
  { key: 'reference', label: 'Reference data', href: '/reference/', icon: 'wholesale-gas' },
];

// el('p', { class: 'x', onclick }, 'text', child): an element with attributes, listeners and children.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// Puts children in a node, leaving out the null, false and undefined that conditional parts give
// (replaceChildren would print them as text).
export function fill(node, ...children) {
  node.replaceChildren(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

export function showMessage(text, { ok = false } = {}) {
  const message = document.querySelector('[data-message]');
  if (!message) return;
  message.hidden = !text;
  message.className = ok ? 'message ok' : 'message';
  message.textContent = text ?? '';
  if (text) message.scrollIntoView({ block: 'nearest' });
}

// A message for the next page, such as "Published batch 12", kept for one page load in this tab.
export function flash(text) {
  try { sessionStorage.setItem('agig-nomination-flash', text); } catch { /* storage may be off: the page still works */ }
}

function takeFlash() {
  try {
    const text = sessionStorage.getItem('agig-nomination-flash');
    sessionStorage.removeItem('agig-nomination-flash');
    return text;
  } catch {
    return null;
  }
}

// Signs the page in, draws the shell with this app's links, and answers { user, session, app }, or null when the
// page cannot go on (the message says why).
export async function startPage(current) {
  const me = await requireUser();
  if (!me) return null;
  if (me.error) {
    await mountChrome(null);
    showMessage(me.error);
    return null;
  }
  const [appResult, sessionResult] = await Promise.all([api(`/api/apps/${ID}`), api(`${API}/session`)]);
  if (!appResult.ok || !sessionResult.ok) {
    await mountChrome(me.user);
    showMessage((appResult.ok ? sessionResult : appResult).data.error || 'Cannot load this app.');
    return null;
  }
  const session = sessionResult.data;
  const app = appResult.data.app;
  const links = PAGES.map((page) => ({
    label: page.label, href: page.href, icon: page.icon, current: page.key === current,
    badge: page.key === 'system' && session.openAlerts ? String(session.openAlerts) : undefined,
  }));
  await mountChrome(me.user, { app, links, sub: session.environment === 'PROD' ? 'Production' : 'Non-production (NP)' });
  const icon = document.querySelector('[data-page-icon]');
  if (icon) icon.append(appIcon(PAGES.find((page) => page.key === current)?.icon ?? app.id));
  environmentBanner(session);
  const note = takeFlash();
  if (note) showMessage(note, { ok: true });
  return { user: me.user, session, app };
}

function environmentBanner(session) {
  const canvas = document.querySelector('.canvas');
  if (!canvas) return;
  const banner = session.environment === 'PROD'
    ? el('p', { class: 'env-banner env-banner--prod', role: 'note' }, 'PRODUCTION: files go to AGIG\'s live TBS.')
    : el('p', { class: 'env-banner', role: 'note' }, 'Non-production (NP): files go to AGIG\'s test system.');
  canvas.prepend(banner);
}

// Dates and times: yyyy-mm-dd hh:mm:ss in Perth time (AWST), a Gas Day as yyyy-mm-dd (format.js).
export { gasDay, relative, took, when } from '/format.js';

export const STATUS_TONE = {
  VALIDATED: 'warn', APPROVED: 'warn', BUILT: 'warn', UPLOADING: 'info', UPLOADED: 'info', UPLOAD_UNCERTAIN: 'bad',
  ACCEPTED: 'good', REJECTED: 'bad', NO_RESPONSE: 'bad', DUPLICATE: 'navy', SUPERSEDED: 'closed', CANCELLED: 'closed',
  IMPORTED: 'warn', VALIDATION_FAILED: 'bad',
};

export function badge(text, tone = 'navy') {
  return el('span', { class: tone === 'closed' ? 'emg-badge pill-closed' : `emg-badge emg-badge--${tone}` }, text);
}

export const statusBadge = (batch) => badge(batch.statusLabel ?? batch.status, STATUS_TONE[batch.status] ?? 'navy');

export function table(headers, rows, { empty = 'Nothing here yet.', className = '' } = {}) {
  if (!rows.length) return el('div', { class: 'emg-empty' }, el('strong', {}, empty));
  return el('div', { class: `table-wrap ${className}` },
    el('table', {},
      el('thead', {}, el('tr', {}, headers.map((header) => el('th', { scope: 'col', class: header.numeric ? 'num' : null }, header.label ?? header)))),
      el('tbody', {}, rows)));
}

// A table row that opens a page when clicked anywhere on it. Its first cell should hold a real link to the same
// page, which is what a keyboard or a screen reader uses.
export function linkRow(href, cells, props = {}) {
  return el('tr', { ...props, class: [props.class, 'link-row'].filter(Boolean).join(' '), onclick: (event) => {
    if (event.target instanceof Element && event.target.closest('a, button')) return;
    window.location.assign(href);
  } }, cells);
}

export function panel(title, ...children) {
  return el('section', { class: 'panel' }, el('h2', { class: 'section-label' }, title), ...children);
}

export function button(label, onclick, { quiet = false, small = false, disabled = false, type = 'button' } = {}) {
  return el('button', { type, class: [quiet ? 'button-quiet' : '', small ? 'button-small' : ''].join(' ').trim() || null, onclick, disabled }, label);
}

// Runs an action from a button: disables it while it runs, and shows the error or the warnings it answers.
export async function act(trigger, run) {
  trigger.disabled = true;
  try {
    const result = await run();
    if (!result.ok) showMessage(result.data.error || 'That did not work.');
    return result;
  } finally {
    trigger.disabled = false;
  }
}

// A file chosen in the browser, read as text (a CSV saved from Excel, or AGIG's response attachment).
export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export { api };
