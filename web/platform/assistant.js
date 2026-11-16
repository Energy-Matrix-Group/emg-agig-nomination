// Joules, the portal's helper, in the corner of every page of an app (from template 1.5.0).
//
// The server adds this script to every page an app serves (server/platform/static.js), as it adds the wait screen, so an
// app does nothing to have him. He is drawn by the portal, in a frame of its own: the portal's page /clip/frame/, which only
// this app's registered address may show. His chat, the cards that ask the person yes or no, and the person's portal
// session all stay in the portal, so this page never sees the conversation and nothing on it can press his buttons.
//
// The frame covers the window but is cut (clip-path) to the shape Joules takes up, which the frame reports, so everywhere
// else this page is clicked as if he were not there. All that passes between them is that shape (and whether he is standing
// in the corner, when the page keeps room for him at its end: data-emg-assistant, chrome.css), the theme, and the id of the
// person signed in here, so he shows only when the portal's session is the same person's.
//
// He does not show on a page nobody is signed in to (a public page), inside a frame, on the portal itself, or when the
// portal's page decides against it: signed out there, someone else signed in there, the app not registered or off, or the
// person has hidden him in this app. Then the frame goes, and the page is exactly as it was.
//
// A page that shows a Joules of its own for a while, such as a guided tour he narrates, asks this one to step aside so only one
// is ever on screen (from template 1.6.0): stepAside(true) as it starts and stepAside(false) when it ends. The frame stays
// where it is, chat and all, unseen and taking no clicks, and comes back exactly as it was. Nothing about it is sent to the
// portal. The page keeps the answer on <html> (data-emg-assistant-aside), so a frame that arrives while it is set steps
// aside at once.

export const SOURCE = 'emg-joules';
export const FRAME_PATH = '/clip/frame/';
export const TITLE = 'Joules, the EMG helper';
// Nothing of the frame shows, or takes a click, until it says where Joules is.
export const HIDDEN = 'inset(50%)';
const APP_ID = /^[a-z][a-z0-9-]{0,39}$/;
// The portal's page answers a hello at once. One that has not answered this long after loading never will (the portal refused
// it, or nobody is signed in there), so the frame goes.
export const ANSWER_MS = 20_000;
const MAX_RECTS = 8;
// Above the app's own bars, menus and banners; below the top layer, so a modal dialog still covers him.
const LAYER = '2147483000';
// Set on <html> while the page shows a Joules of its own (stepAside); the event tells a frame already on the page.
export const ASIDE = 'data-emg-assistant-aside';
export const ASIDE_EVENT = 'emg-assistant-aside';
// What the portal's page may do: run, keep its own origin (its cookie and storage), take the chat form, open a link in a
// new tab, and move this page only when the person clicks a link in it. Nothing else.
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation';

// The frame's address, from what /api/me says: { origin, src }, or null when he should not be here.
//   portalUrl, appId  from /api/me        here  this page's origin        theme  'light' or 'dark'
export function frameAddress({ portalUrl, appId, here, theme }) {
  if (typeof portalUrl !== 'string' || typeof appId !== 'string' || !APP_ID.test(appId)) return null;
  let portal;
  try {
    portal = new URL(portalUrl);
  } catch {
    return null;
  }
  if (portal.protocol !== 'https:' && portal.protocol !== 'http:') return null;
  if (portal.origin === here) return null; // the portal's own pages draw him themselves
  const query = new URLSearchParams({ app: appId, theme: theme === 'dark' ? 'dark' : 'light' });
  return { origin: portal.origin, src: `${portal.origin}${FRAME_PATH}?${query}` };
}

// The clip-path for the shape the frame reported: { rects: [[x, y, width, height], ...] } in the frame's own pixels, which
// are this window's. A rectangle that is not four finite numbers with some size is ignored; nothing left hides the frame.
// Each is drawn the same way round, so where they overlap they add up rather than cancel.
export function clipPathFor(shape) {
  const rects = Array.isArray(shape?.rects) ? shape.rects.slice(0, MAX_RECTS) : [];
  const parts = [];
  for (const rect of rects) {
    if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) continue;
    const [x, y, width, height] = rect.map(Math.round);
    if (width <= 0 || height <= 0) continue;
    parts.push(`M${x} ${y}H${x + width}V${y + height}H${x}Z`);
  }
  return parts.length ? `path("${parts.join('')}")` : HIDDEN;
}

// A message from the frame, or null for anything else: it must come from the frame's own window, from the portal's
// origin, and be one of ours. A shape says too whether he is standing in the corner (`room`), rather than sent away.
export function readMessage(event, { frameWindow, origin }) {
  if (!event || event.source !== frameWindow || event.origin !== origin) return null;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.source !== SOURCE) return null;
  if (data.type === 'shape') return { type: 'shape', clipPath: clipPathFor(data), room: data.room === true };
  if (data.type === 'gone') return { type: 'gone' };
  return null;
}

// Asks Joules in the corner to step aside (true) while the page shows a Joules of its own, or to come back (false).
export function stepAside(on, { document: doc = globalThis.document } = {}) {
  const root = doc?.documentElement;
  if (!root) return;
  root.toggleAttribute(ASIDE, Boolean(on));
  doc.dispatchEvent(new CustomEvent(ASIDE_EVENT, { detail: { aside: Boolean(on) } }));
}

// The theme this page is showing, as theme.js decides it (without loading theme.js, which brings the icons with it).
export function themeOf(page) {
  const chosen = page.document?.documentElement?.dataset?.theme;
  if (chosen === 'light' || chosen === 'dark') return chosen;
  return typeof page.matchMedia === 'function' && page.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Puts the frame on the page. Answers a controller ({ frame, remove }), or null when he does not belong here.
export async function startAssistant({ window: page = globalThis.window } = {}) {
  if (!page?.document || typeof page.fetch !== 'function' || page.__emgAssistant) return null;
  if (page.top !== page.self) return null; // a page inside a frame: if he is anywhere, he is on the page around it
  page.__emgAssistant = true;
  let me = null;
  try {
    const response = await page.fetch('/api/me', { credentials: 'include', headers: { Accept: 'application/json' } });
    if (response.ok) me = await response.json();
  } catch {
    me = null;
  }
  const user = typeof me?.user?.id === 'string' ? me.user.id : null;
  const where = user ? frameAddress({ portalUrl: me.portalUrl, appId: me.appId, here: page.location.origin, theme: themeOf(page) }) : null;
  if (!where) return null;
  return mountFrame({ page, ...where, user });
}

function mountFrame({ page, origin, src, user }) {
  const doc = page.document;
  const frame = doc.createElement('iframe');
  frame.title = TITLE;
  frame.setAttribute('sandbox', SANDBOX);
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('data-emg-assistant', '');
  let theme = themeOf(page);
  Object.assign(frame.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '100%',
    height: '100%',
    margin: '0',
    padding: '0',
    border: '0',
    background: 'transparent',
    // The same as the page inside it, or the browser paints the frame opaque.
    colorScheme: theme,
    zIndex: LAYER,
    clipPath: HIDDEN,
  });
  frame.src = src;

  const post = (message) => frame.contentWindow?.postMessage({ source: SOURCE, ...message }, origin);

  // A phone's keyboard covers the bottom of the window without resizing it: the frame shrinks to what can still be seen,
  // so Joules and his chat stay above it. Zoomed in, the frame keeps to the whole window.
  const fit = () => {
    const view = page.visualViewport;
    const plain = view && Math.abs(view.scale - 1) < 0.01;
    frame.style.top = plain ? `${Math.round(view.offsetTop)}px` : '0';
    frame.style.height = plain ? `${Math.round(view.height)}px` : '100%';
  };

  const retheme = () => {
    const next = themeOf(page);
    if (next === theme) return;
    theme = next;
    frame.style.colorScheme = theme;
    post({ type: 'theme', theme });
  };
  const scheme = typeof page.matchMedia === 'function' ? page.matchMedia('(prefers-color-scheme: dark)') : null;
  // Unseen, and taking no clicks, while the page shows a Joules of its own.
  const aside = () => {
    frame.style.visibility = doc.documentElement.hasAttribute(ASIDE) ? 'hidden' : '';
  };

  let waiting = 0;
  const onMessage = (event) => {
    const message = readMessage(event, { frameWindow: frame.contentWindow, origin });
    if (message) page.clearTimeout(waiting);
    if (message?.type === 'shape') {
      frame.style.clipPath = message.clipPath;
      doc.documentElement.toggleAttribute('data-emg-assistant', message.room);
    } else if (message?.type === 'gone') remove();
  };

  function remove() {
    page.clearTimeout(waiting);
    page.removeEventListener('message', onMessage);
    page.visualViewport?.removeEventListener('resize', fit);
    page.visualViewport?.removeEventListener('scroll', fit);
    doc.removeEventListener('emg-theme', retheme);
    doc.removeEventListener(ASIDE_EVENT, aside);
    scheme?.removeEventListener?.('change', retheme);
    doc.documentElement.removeAttribute('data-emg-assistant');
    frame.remove();
  }

  page.addEventListener('message', onMessage);
  // Every load of the frame is told who is signed in here and the theme; it says nothing until it has been.
  frame.addEventListener('load', () => {
    post({ type: 'hello', user, theme });
    page.clearTimeout(waiting);
    waiting = page.setTimeout(remove, ANSWER_MS);
  });
  page.visualViewport?.addEventListener('resize', fit);
  page.visualViewport?.addEventListener('scroll', fit);
  doc.addEventListener('emg-theme', retheme);
  doc.addEventListener(ASIDE_EVENT, aside);
  scheme?.addEventListener?.('change', retheme);
  aside();
  fit();
  (doc.body ?? doc.documentElement).append(frame);
  return { frame, remove };
}

if (typeof window !== 'undefined' && window.document) startAssistant().catch(() => {});
