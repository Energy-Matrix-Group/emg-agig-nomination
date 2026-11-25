const SVG_NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  ticketing: [
    'M4 8.5h16v3.2a2.2 2.2 0 0 0 0 4.1v3.2H4v-3.2a2.2 2.2 0 0 0 0-4.1V8.5z',
    'M12 8.5v10.5',
  ],
  documentation: [
    'M7 3.5h7.2L19 8.2V20.5H7z',
    'M14 3.5v5h5',
    'M10 13h6',
    'M10 16.5h6',
  ],
  devboard: [
    'M4 4.5h4.6V19H4z',
    'M9.7 4.5h4.6V13H9.7z',
    'M15.4 4.5H20V16h-4.6z',
  ],
  'poc-studio': [
    'M9.5 19V9a2.5 2.5 0 0 1 5 0V17a4.5 4.5 0 0 1-9 0V8a6.5 6.5 0 0 1 13 0v8',
  ],
  'admin-settings': [
    'M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z',
    'M12 3.2v2.1',
    'M12 18.7v2.1',
    'M3.2 12h2.1',
    'M18.7 12h2.1',
    'M5.8 5.8l1.5 1.5',
    'M16.7 16.7l1.5 1.5',
    'M18.2 5.8l-1.5 1.5',
    'M7.3 16.7l-1.5 1.5',
  ],
  portal: [
    'M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z',
    'M12 3.2v2.1',
    'M12 18.7v2.1',
    'M3.2 12h2.1',
    'M18.7 12h2.1',
    'M5.8 5.8l1.5 1.5',
    'M16.7 16.7l1.5 1.5',
    'M18.2 5.8l-1.5 1.5',
    'M7.3 16.7l-1.5 1.5',
  ],
  operations: [
    'M4 7h9',
    'M17 7h3',
    'M13 5v4',
    'M4 17h3',
    'M11 17h9',
    'M7 15v4',
    'M4 12h5',
    'M13 12h7',
    'M9 10v4',
  ],
  accounts: [
    'M3.5 7h17v10h-17z',
    'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    'M6.5 10v4',
    'M17.5 10v4',
  ],
  'retail-gas': [
    'M12 3c1 3.5 4.5 5.2 4.5 9.2a4.5 4.5 0 0 1-9 0c0-1.8.8-3 1.8-4 .2 1.2.8 2 1.7 2.4C11 8.5 11 5.5 12 3z',
  ],
  'retail-electricity': [
    'M13 3L5.5 13.5H11L10 21l7.5-10.5H12z',
  ],
  'gas-retail-billing': [
    'M6 3.5h12v16.5l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z',
    'M12 6.5c.6 1.9 2.5 2.9 2.5 5.1a2.5 2.5 0 0 1-5 0c0-1 .4-1.6.9-2.2.1.7.5 1.1 1 1.3-.1-1.5-.1-3 .6-4.2z',
    'M9 16h6',
  ],
  'wholesale-gas': [
    'M6 6.5c0-1.4 2.7-2.5 6-2.5s6 1.1 6 2.5v11c0 1.4-2.7 2.5-6 2.5s-6-1.1-6-2.5z',
    'M6 6.5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5',
    'M6 12c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5',
  ],
  'wholesale-gas-management': [
    'M4 19V5',
    'M4 19h16',
    'M7 15l3.5-4 3 2.5L19 8',
  ],
  'national-energy-markets': [
    'M3.5 19.5h17',
    'M3.5 12.5h3.6l2.1-5.5 3.4 10 2.4-6.5 1.6 2h3.9',
  ],
  crm: [
    'M9 5.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    'M3.5 19.5a5.5 5.5 0 0 1 11 0',
    'M15.5 5.7a3 3 0 0 1 0 5.6',
    'M17 14.2a5.5 5.5 0 0 1 3.5 5.3',
  ],
  compliance: [
    'M12 4v16',
    'M8.5 20h7',
    'M5 7.5h14',
    'M5 7.5L2.5 13a2.5 2.5 0 0 0 5 0z',
    'M19 7.5L16.5 13a2.5 2.5 0 0 0 5 0z',
  ],
  'operations-incident-register': [
    'M9 4.5H6.5v16h11v-16H15',
    'M9 3.5h6v3H9z',
    'M9.2 13.4l2 2 3.8-4.2',
  ],
  'jira-dashboard': [
    'M3 20.5h18',
    'M5 20.5V12h3.5v8.5',
    'M10.25 20.5V4.5h3.5v16',
    'M15.5 20.5V9H19v11.5',
    'M12 7.5v1.5',
    'M12 11.5V13',
  ],
  'operations-models': [
    'M3.5 4.5h17v15h-17z',
    'M3.5 9h17',
    'M8.5 9v10.5',
    'M11 16.5l2.5-3 2.2 1.6 3-3.6',
  ],
  projects: [
    'M3.5 4h10v4h-10z',
    'M7.5 10h10v4h-10z',
    'M17.5 15l3 3-3 3-3-3z',
  ],
  'contract-insights': [
    'M6 3.5h8.5L18.5 7.5v13H6z',
    'M14.5 3.5v4h4',
    'M9.5 17.5v-3',
    'M12.25 17.5v-5',
    'M15 17.5v-7',
  ],
  'agig-nomination': [
    'M2.5 7.5v9',
    'M11 7.5v9',
    'M2.5 9.5H11',
    'M2.5 14.5H11',
    'M5.5 12h2.5',
    'M13.5 4.5H18l3 3v12h-7.5z',
    'M15.4 13.4l1.6 1.6 2.5-2.9',
  ],
  template: [
    'M12 3.5L3.5 8 12 12.5 20.5 8z',
    'M3.5 12L12 16.5 20.5 12',
    'M3.5 16L12 20.5 20.5 16',
  ],
  applications: [
    'M4 4h6.5v6.5H4z',
    'M13.5 4H20v6.5h-6.5z',
    'M4 13.5h6.5V20H4z',
    'M13.5 13.5H20V20h-6.5z',
  ],
};

// Small interface icons: the theme switch, the menu, arrows.
const UI = {
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M12 2.5v2', 'M12 19.5v2', 'M2.5 12h2', 'M19.5 12h2',
    'M5.3 5.3l1.4 1.4', 'M17.3 17.3l1.4 1.4', 'M18.7 5.3l-1.4 1.4', 'M6.7 17.3l-1.4 1.4',
  ],
  moon: ['M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  arrow: ['M4 12h15', 'M13 6l6 6-6 6'],
  check: ['M5 12.5l4.2 4.2L19 7'],
  spark: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', 'M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z'],
  bolt: ['M13 3L5.5 13.5H11L10 21l7.5-10.5H12z'],
  planned: ['M12 4.5l7.5 7.5-7.5 7.5L4.5 12z', 'M12 9.5l2.5 2.5-2.5 2.5-2.5-2.5z'],
  overview: ['M4 4h7v7H4z', 'M13 4h7v4h-7z', 'M13 10h7v10h-7z', 'M4 13h7v7H4z'],
  users: [
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    'M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6',
    'M16 4.3a3.5 3.5 0 0 1 0 6.4',
    'M18.5 14.4c1.8.8 3 2.7 3 5.6',
  ],
};

// An app's icon by its id. The interface icons below can be asked for by name too, so a sidebar link can
// use one ({ icon: 'planned' }).
export function appIcon(id) {
  return strokeIcon(PATHS[id] ?? UI[id] ?? PATHS.applications);
}

export function uiIcon(name) {
  return strokeIcon(UI[name] ?? UI.spark);
}

function strokeIcon(paths) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
