import { appIcon, uiIcon } from './icons.js';
import { becauseText, linkHref, tagOf, whenText } from './bell-view.js';

// The bell's tip card and one row of its list, as bell.js draws them and as the portal's Admin Settings previews a notice.
// Everything is text: no markup is ever built from what the API sends.
//   portalUrl                    where a link to a page of the portal goes ('' on the portal itself)
//   onFollow(event, id, unread)  a link inside was pressed
//   onRead(id)                   a row with no link was pressed
//   onPutAway(tip)               the tip's cross was pressed

const SVG = 'http://www.w3.org/2000/svg';
const CROSS = ['M6 6l12 12', 'M18 6L6 18'];
const LOCK = ['M7.5 11V8a4.5 4.5 0 0 1 8.7-1.6', 'M5 11h14v9.5H5z', 'M12 14.5v2.5'];
export const BELL = ['M6 16.5V11a6 6 0 0 1 12 0v5.5l1.6 2.2H4.4z', 'M10 21h4'];
export { CROSS };

// An element with text only: el('p', { class: 'x', onClick }, 'words', child).
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'class') node.className = value;
    else if (name.startsWith('on')) node.addEventListener(name.slice(2).toLowerCase(), value);
    else node.setAttribute(name, value === true ? '' : value);
  }
  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

export function tipCard(tip, { portalUrl = '', onFollow = () => {}, onPutAway = () => {} } = {}) {
  const href = tip.link ? linkHref(tip.link.href, portalUrl) : null;
  return el('article', { class: 'notify-tip', 'aria-labelledby': 'notify-tip-title' },
    el('p', { class: 'notify-tip__eyebrow' }, 'Did you know?'),
    el('h3', { id: 'notify-tip-title' }, tip.title),
    el('p', {}, tip.body),
    href ? el('a', { class: 'notify-tip__link', href, onClick: (event) => onFollow(event, `notice:${tip.id}`, tip.unread) }, tip.link.label, uiIcon('arrow')) : null,
    el('button', { type: 'button', class: 'notify-tip__away', 'aria-label': 'Put this tip away', title: 'Put this tip away', onClick: () => onPutAway(tip) }, stroke(CROSS)));
}

export function itemRow(item, { portalUrl = '', onFollow = () => {}, onRead = () => {} } = {}) {
  const tag = tagOf(item);
  const why = becauseText(item);
  const href = item.link ? linkHref(item.link.href, portalUrl) : null;
  const content = [
    item.unread ? el('span', { class: 'notify-item__dot', role: 'img', 'aria-label': 'Unread' }) : null,
    el('span', { class: 'notify-item__tile', 'aria-hidden': 'true' }, iconFor(item)),
    el('span', {},
      el('span', { class: 'notify-item__meta' }, el('span', { class: 'notify-item__tag' }, tag.text), el('time', { datetime: item.at }, whenText(item.at))),
      el('span', { class: 'notify-item__title' }, item.title),
      el('span', { class: 'notify-item__body' }, item.body),
      el('span', { class: 'notify-item__foot' },
        href ? el('span', { class: 'notify-item__cta' }, item.link.label, uiIcon('arrow')) : null,
        why ? el('span', { class: 'notify-item__why' }, why) : null)),
  ];
  const classes = `notify-item notify-tone--${tag.tone}${item.unread ? ' notify-item--unread' : ''}`;
  if (href) return el('a', { class: classes, href, onClick: (event) => onFollow(event, item.id, item.unread) }, ...content);
  return el('button', { type: 'button', class: classes, onClick: () => onRead(item.id) }, ...content);
}

function iconFor(item) {
  if (item.app) return appIcon(item.app.icon || item.app.id);
  if (item.scope === 'everyone') return uiIcon('spark');
  if (item.kind === 'role') return uiIcon('users');
  return stroke(LOCK);
}

// A line drawing in the platform's style: 24 by 24, a 1.6 stroke in the text's colour.
export function stroke(paths) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of paths) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
