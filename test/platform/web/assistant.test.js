import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANSWER_MS, ASIDE, clipPathFor, frameAddress, HIDDEN, readMessage, SOURCE, startAssistant, stepAside, themeOf, TITLE } from '../../../web/platform/assistant.js';

const PORTAL = 'https://portal.example.test';
const HERE = 'https://ticketing.example.test';

// Just enough of a browser window for the frame: elements with attributes and styles, events, fetch and postMessage.
class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((one) => one !== listener));
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  dispatchEvent(event) {
    this.dispatch(event.type, event);
    return true;
  }
}

class FakeElement extends FakeTarget {
  constructor(tag) {
    super();
    Object.assign(this, { tag, attributes: {}, style: {}, children: [], parent: null, dataset: {} });
    if (tag === 'iframe') {
      this.posted = [];
      this.contentWindow = { postMessage: (message, origin) => this.posted.push({ message, origin }) };
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  hasAttribute(name) {
    return name in this.attributes;
  }

  toggleAttribute(name, on) {
    if (on) this.attributes[name] = '';
    else delete this.attributes[name];
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }

  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
}

function fakeWindow({ me = { user: { id: 'u-1' }, portalUrl: PORTAL, appId: 'ticketing' }, status = 200, origin = HERE, dark = false, framed = false, theme, viewport } = {}) {
  const page = new FakeTarget();
  const document = new FakeTarget();
  document.documentElement = new FakeElement('html');
  if (theme) document.documentElement.dataset.theme = theme;
  document.body = new FakeElement('body');
  document.createElement = (tag) => new FakeElement(tag);
  const scheme = new FakeTarget();
  scheme.matches = dark;
  page.requests = [];
  page.timers = new Map();
  let next = 0;
  Object.assign(page, {
    setTimeout: (run, ms) => {
      next += 1;
      page.timers.set(next, { run, ms });
      return next;
    },
    clearTimeout: (id) => page.timers.delete(id),
    document,
    location: { origin },
    matchMedia: () => scheme,
    scheme,
    visualViewport: viewport ? Object.assign(new FakeTarget(), viewport) : undefined,
    fetch: async (path, init) => {
      page.requests.push({ path, init });
      if (status === 0) throw new TypeError('Failed to fetch');
      return { ok: status >= 200 && status < 300, status, json: async () => me };
    },
  });
  page.self = page;
  page.top = framed ? {} : page;
  return page;
}

const frameOf = (page) => page.document.body.children.find((child) => child.tag === 'iframe');

test('the frame is the portal\'s page for this app, with the theme, and only on an app', () => {
  assert.deepEqual(frameAddress({ portalUrl: PORTAL, appId: 'ticketing', here: HERE, theme: 'dark' }), {
    origin: PORTAL,
    src: `${PORTAL}/clip/frame/?app=ticketing&theme=dark`,
  });
  assert.equal(frameAddress({ portalUrl: `${PORTAL}/`, appId: 'ticketing', here: HERE, theme: 'odd' }).src, `${PORTAL}/clip/frame/?app=ticketing&theme=light`);
  assert.equal(frameAddress({ portalUrl: PORTAL, appId: 'ticketing', here: PORTAL }), null, 'the portal draws him itself');
  for (const appId of [undefined, '', 'Ticketing', '../x', 'a b', 'x'.repeat(41)]) {
    assert.equal(frameAddress({ portalUrl: PORTAL, appId, here: HERE }), null, String(appId));
  }
  for (const portalUrl of [undefined, '', 'not an address', 'javascript:alert(1)', 'data:text/html,x']) {
    assert.equal(frameAddress({ portalUrl, appId: 'ticketing', here: HERE }), null, String(portalUrl));
  }
});

test('the frame is cut to the shape Joules takes up, and to nothing without one', () => {
  assert.equal(clipPathFor({ rects: [[10, 20, 30, 40]] }), 'path("M10 20H40V60H10Z")');
  assert.equal(clipPathFor({ rects: [[0.4, 0.6, 9.5, 9.4], [100, 100, 50, 50]] }), 'path("M0 1H10V10H0ZM100 100H150V150H100Z")');
  for (const shape of [undefined, null, {}, { rects: [] }, { rects: 'x' }, { rects: [[1, 2, 3]] }, { rects: [[1, 2, 0, 5]] }, { rects: [[1, 2, 3, Number.NaN]] }, { rects: [['1', 2, 3, 4]] }, { whole: true }]) {
    assert.equal(clipPathFor(shape), HIDDEN, JSON.stringify(shape));
  }
  const many = Array.from({ length: 20 }, (_, index) => [index, 0, 1, 1]);
  assert.equal(clipPathFor({ rects: many }).split('Z').length - 1, 8, 'at most eight pieces');
});

test('only the frame\'s own window, from the portal, is listened to', () => {
  const frameWindow = {};
  const from = (overrides) => readMessage({ source: frameWindow, origin: PORTAL, data: { source: SOURCE, type: 'gone' }, ...overrides }, { frameWindow, origin: PORTAL });
  assert.deepEqual(from({}), { type: 'gone' });
  assert.deepEqual(from({ data: { source: SOURCE, type: 'shape', rects: [[1, 2, 3, 4]] } }), { type: 'shape', clipPath: 'path("M1 2H4V6H1Z")', room: false });
  assert.equal(from({ data: { source: SOURCE, type: 'shape', rects: [], room: true } }).room, true);
  assert.equal(from({ data: { source: SOURCE, type: 'shape', rects: [], room: 'yes' } }).room, false);
  assert.equal(from({ source: {} }), null, 'another window');
  assert.equal(from({ origin: HERE }), null, 'another origin');
  assert.equal(from({ data: { type: 'gone' } }), null, 'not ours');
  assert.equal(from({ data: 'gone' }), null);
  assert.equal(from({ data: { source: SOURCE, type: 'navigate', to: 'https://elsewhere.test' } }), null, 'nothing else is understood');
});

test('the theme is the page\'s chosen one, or the system\'s', () => {
  assert.equal(themeOf(fakeWindow({ theme: 'dark' })), 'dark');
  assert.equal(themeOf(fakeWindow({ theme: 'light', dark: true })), 'light');
  assert.equal(themeOf(fakeWindow({ dark: true })), 'dark');
  assert.equal(themeOf(fakeWindow()), 'light');
});

test('on an app page with someone signed in, the frame goes on, hidden until it says where he is', async () => {
  const page = fakeWindow({ viewport: { scale: 1, offsetTop: 0, height: 700 } });
  const mounted = await startAssistant({ window: page });
  assert.ok(mounted);
  assert.equal(page.requests[0].path, '/api/me');
  const frame = frameOf(page);
  assert.equal(frame, mounted.frame);
  assert.equal(frame.src, `${PORTAL}/clip/frame/?app=ticketing&theme=light`);
  assert.equal(frame.title, TITLE);
  assert.match(frame.attributes.sandbox, /allow-scripts/);
  assert.match(frame.attributes.sandbox, /allow-top-navigation-by-user-activation/);
  assert.doesNotMatch(frame.attributes.sandbox, /allow-top-navigation(?!-by-user-activation)/, 'it moves this page only when the person clicks');
  assert.equal(frame.attributes.referrerpolicy, 'no-referrer');
  assert.equal(frame.style.clipPath, HIDDEN);
  assert.equal(frame.style.position, 'fixed');
  assert.equal(frame.style.colorScheme, 'light');
  assert.equal(frame.style.height, '700px');

  // It says nothing to the frame until the frame has loaded, and then only to the portal.
  assert.equal(frame.posted.length, 0);
  frame.dispatch('load');
  assert.deepEqual(frame.posted, [{ message: { source: SOURCE, type: 'hello', user: 'u-1', theme: 'light' }, origin: PORTAL }]);
  assert.deepEqual([...page.timers.values()].map((timer) => timer.ms), [ANSWER_MS], 'it waits for an answer');

  page.dispatch('message', { source: frame.contentWindow, origin: PORTAL, data: { source: SOURCE, type: 'shape', rects: [[5, 6, 7, 8]], room: true } });
  assert.equal(frame.style.clipPath, 'path("M5 6H12V14H5Z")');
  assert.equal(page.timers.size, 0, 'and has it');
  assert.ok('data-emg-assistant' in page.document.documentElement.attributes, 'the page keeps room for him at its end');
  page.dispatch('message', { source: frame.contentWindow, origin: HERE, data: { source: SOURCE, type: 'shape', rects: [[0, 0, 9999, 9999]] } });
  assert.equal(frame.style.clipPath, 'path("M5 6H12V14H5Z")', 'a message from anywhere else changes nothing');

  // A change of theme on this page reaches him.
  page.document.documentElement.dataset.theme = 'dark';
  page.document.dispatch('emg-theme');
  assert.equal(frame.style.colorScheme, 'dark');
  assert.deepEqual(frame.posted.at(-1), { message: { source: SOURCE, type: 'theme', theme: 'dark' }, origin: PORTAL });

  // A phone's keyboard: the frame keeps to what can be seen.
  Object.assign(page.visualViewport, { offsetTop: 40, height: 380 });
  page.visualViewport.dispatch('resize');
  assert.equal(frame.style.top, '40px');
  assert.equal(frame.style.height, '380px');

  // Sent away to a small button, he needs no room.
  page.dispatch('message', { source: frame.contentWindow, origin: PORTAL, data: { source: SOURCE, type: 'shape', rects: [[5, 6, 7, 8]] } });
  assert.equal('data-emg-assistant' in page.document.documentElement.attributes, false);

  page.dispatch('message', { source: frame.contentWindow, origin: PORTAL, data: { source: SOURCE, type: 'shape', rects: [[5, 6, 7, 8]], room: true } });
  page.dispatch('message', { source: frame.contentWindow, origin: PORTAL, data: { source: SOURCE, type: 'gone' } });
  assert.equal(frameOf(page), undefined, 'gone means gone');
  assert.equal('data-emg-assistant' in page.document.documentElement.attributes, false, 'and the page has its own end back');
  assert.equal(page.listeners.get('message').length, 0);
});

test('a page with a Joules of its own (a guided tour) asks this one to step aside, and he comes back as he was', async () => {
  const page = fakeWindow();
  const mounted = await startAssistant({ window: page });
  const frame = mounted.frame;
  frame.dispatch('load');
  page.dispatch('message', { source: frame.contentWindow, origin: PORTAL, data: { source: SOURCE, type: 'shape', rects: [[5, 6, 7, 8]], room: true } });
  assert.equal(frame.style.visibility, '');

  const posted = frame.posted.length;
  stepAside(true, { document: page.document });
  assert.equal(frame.style.visibility, 'hidden', 'unseen, and taking no clicks');
  assert.ok(ASIDE in page.document.documentElement.attributes);
  assert.equal(frame.style.clipPath, 'path("M5 6H12V14H5Z")', 'he keeps his place');
  assert.equal(frameOf(page), frame, 'and stays on the page, chat and all');
  assert.equal(frame.posted.length, posted, 'nothing about it is sent to the portal');

  stepAside(false, { document: page.document });
  assert.equal(frame.style.visibility, '');
  assert.equal(ASIDE in page.document.documentElement.attributes, false);

  // A frame that arrives while the page has asked steps aside at once.
  const later = fakeWindow();
  stepAside(true, { document: later.document });
  const arriving = await startAssistant({ window: later });
  assert.equal(arriving.frame.style.visibility, 'hidden');
  arriving.remove();
  assert.equal((later.document.listeners.get('emg-assistant-aside') ?? []).length, 0, 'a frame taken away stops listening');
});

test('a frame that never answers (the portal refused it, or nobody is signed in there) is taken away', async () => {
  const page = fakeWindow();
  await startAssistant({ window: page });
  const frame = frameOf(page);
  frame.dispatch('load');
  const [timer] = page.timers.values();
  timer.run();
  assert.equal(frameOf(page), undefined);
  assert.equal(page.listeners.get('message').length, 0);
});

test('he stays away from a page nobody is signed in to, the portal, a page inside a frame, and a second start', async () => {
  for (const [name, options] of Object.entries({
    'signed out': { status: 401 },
    'no server': { status: 0 },
    'on the portal': { origin: PORTAL },
    'inside a frame': { framed: true },
    'no portal address': { me: { user: { id: 'u-1' }, appId: 'ticketing' } },
    'an older platform with no app id': { me: { user: { id: 'u-1' }, portalUrl: PORTAL } },
    'no person': { me: { portalUrl: PORTAL, appId: 'ticketing' } },
  })) {
    const page = fakeWindow(options);
    assert.equal(await startAssistant({ window: page }), null, name);
    assert.equal(frameOf(page), undefined, name);
  }
  const page = fakeWindow();
  assert.ok(await startAssistant({ window: page }));
  assert.equal(await startAssistant({ window: page }), null);
  assert.equal(page.document.body.children.length, 1);
});
