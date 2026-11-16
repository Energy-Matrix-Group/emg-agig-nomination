import { api } from './api.js';
import { appIcon, initials, uiIcon } from './icons.js';
import { bootDone } from './loader.js';
import { themeToggle } from './theme.js';

// The portal's address, learned from /api/me. It is never a build-time constant, so moving the portal
// means changing one setting on the server.
let portalUrl = '';

// Where "All applications" and the logo go: the portal's application list.
export function homeHref() {
  return portalUrl ? `${portalUrl}/apps` : '/apps';
}

export async function requireUser() {
  const result = await api('/api/me');
  // An app never gets here with a 401: api() has already sent the page to the portal. The portal's own
  // pages have no handoff to send people to, so they go to its sign-in page.
  if (result.status === 401) {
    window.location.assign('/');
    return null;
  }
  if (!result.ok) {
    bootDone();
    return { error: result.data.error || 'Cannot load your session.' };
  }
  portalUrl = typeof result.data.portalUrl === 'string' ? result.data.portalUrl : '';
  return { user: result.data.user, portalUrl };
}

// With no app, the sidebar lists every application the user may open (the portal's own pages).
// Inside an app, the sidebar belongs to that app and offers a way back to the portal.
//   links  [{ label, href, icon, current, badge }], or { heading } to start a group
//   sub    an optional line under the app's name in the sidebar
export async function mountChrome(user, { app = null, links = [], apps = null, sub = '' } = {}) {
  mountTop();
  mountFooter(user);
  const brand = document.querySelector('.app-nav__brand');
  if (brand && app) brand.setAttribute('href', homeHref());
  if (app) mountAppNav(app, links, sub);
  else await mountPortalNav(apps);
  bootDone();
}

// The logo, the theme switch and, on a small screen, the menu button that opens the sidebar.
function mountTop() {
  const nav = document.querySelector('.app-nav');
  const brand = nav?.querySelector(':scope > .app-nav__brand');
  if (!nav || !brand) return;
  const top = document.createElement('div');
  top.className = 'app-nav__top';
  const tools = document.createElement('div');
  tools.className = 'app-nav__tools';
  const menu = document.createElement('button');
  menu.type = 'button';
  menu.className = 'icon-button nav-menu';
  menu.setAttribute('aria-expanded', 'false');
  menu.setAttribute('aria-label', 'Open the menu');
  menu.append(uiIcon('menu'));
  const setOpen = (open) => {
    nav.toggleAttribute('data-open', open);
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close the menu' : 'Open the menu');
    menu.replaceChildren(uiIcon(open ? 'close' : 'menu'));
  };
  menu.addEventListener('click', () => setOpen(!nav.hasAttribute('data-open')));
  // A link that only changes the address after # keeps the page, so the menu closes by itself.
  nav.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a') && nav.hasAttribute('data-open')) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && nav.hasAttribute('data-open')) setOpen(false);
  });
  tools.append(themeToggle(), menu);
  brand.before(top);
  top.append(brand, tools);
}

function mountFooter(user) {
  const footer = document.querySelector('[data-header]');
  if (!footer) return;
  footer.replaceChildren();
  if (user) {
    const person = document.createElement('div');
    person.className = 'nav-user';
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = initials(user.displayName);
    const text = document.createElement('span');
    text.className = 'nav-user__text';
    const name = document.createElement('span');
    name.className = 'nav-user__name';
    name.textContent = user.displayName ?? '';
    const email = document.createElement('span');
    email.className = 'nav-user__email';
    email.textContent = user.email ?? '';
    text.append(name, email);
    person.append(avatar, text);
    footer.append(person);
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'nav-signout';
  button.textContent = 'Sign out';
  button.addEventListener('click', async () => {
    button.disabled = true;
    // The app clears its own cookie and says where the portal ends the rest.
    const result = await api('/api/logout', { method: 'POST' });
    window.location.assign(result.data.logoutUrl || homeHref());
  });
  footer.append(button);
}

async function mountPortalNav(apps) {
  const nav = document.querySelector('[data-nav-links]');
  if (!nav) return;
  const result = Array.isArray(apps) ? { ok: true, data: { apps } } : await api('/api/apps');
  const links = [];
  if (result.ok && Array.isArray(result.data.apps)) {
    for (const app of result.data.apps) links.push(navLink({ label: app.name, href: app.href, icon: app.icon || app.id }));
  }
  nav.replaceChildren(...links);
}

function mountAppNav(app, links, sub) {
  const nav = document.querySelector('[data-nav-links]');
  const label = document.querySelector('.app-nav__label');
  if (label) {
    label.replaceChildren();
    const glyph = document.createElement('span');
    glyph.className = 'app-nav__label-icon';
    glyph.append(appIcon(app.id));
    const name = document.createElement('span');
    name.textContent = app.name;
    if (sub) {
      const line = document.createElement('span');
      line.className = 'app-nav__sub';
      line.textContent = sub;
      name.append(line);
    }
    label.append(glyph, name);
    label.before(closeLink(app));
  }
  if (nav) nav.replaceChildren(...links.map((link) => (link.heading ? navHeading(link.heading) : navLink(link))));
}

function closeLink(app) {
  const link = document.createElement('a');
  link.className = 'nav-close';
  link.href = homeHref();
  link.dataset.closeApplet = '';
  link.setAttribute('aria-label', `Close ${app.name} and return to all applications`);
  const text = document.createElement('span');
  text.textContent = 'All applications';
  link.append(text);
  return link;
}

function navHeading(text) {
  const heading = document.createElement('small');
  heading.className = 'nav-group';
  heading.textContent = text;
  return heading;
}

function navLink({ label, href, icon, current, badge }) {
  const link = document.createElement('a');
  link.className = 'nav-link';
  link.href = href;
  if (icon) {
    const glyph = document.createElement('span');
    glyph.className = 'nav-link__icon';
    glyph.append(appIcon(icon));
    link.append(glyph);
  }
  const text = document.createElement('span');
  text.textContent = label;
  link.append(text);
  if (badge) {
    const tag = document.createElement('span');
    tag.className = 'nav-link__badge';
    tag.textContent = badge;
    link.append(tag);
  }
  if (current ?? isCurrent(href)) link.setAttribute('aria-current', 'page');
  return link;
}

function isCurrent(href) {
  const path = withSlash(window.location.pathname);
  const target = withSlash(href);
  return path === target || path.startsWith(target);
}

function withSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}
