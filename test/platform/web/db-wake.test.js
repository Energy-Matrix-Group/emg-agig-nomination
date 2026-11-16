import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabaseWake, installDatabaseWake } from '../../../web/platform/db-wake.js';

const PAGE = { href: 'http://web.test/apps/ticketing/', origin: 'http://web.test' };
const MESSAGE = 'The database is starting up after a cost-saving pause. This usually takes about a minute.';

// A page as small as the wait screen needs: elements that can be nested, hidden, made inert and focused.
class FakeElement {
  constructor(document, tag) {
    Object.assign(this, { document, tag, children: [], attributes: {}, className: '', textContent: '', hidden: false, inert: false, parentNode: null });
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  focus() {
    this.document.activeElement = this;
  }

  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === this.document.body;
  }

  find(className) {
    if (this.className === className) return this;
    for (const child of this.children) {
      const found = child.find(className);
      if (found) return found;
    }
    return null;
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement(this, 'body');
    this.documentElement = new FakeElement(this, 'html');
    this.activeElement = null;
  }

  createElement(tag) {
    return new FakeElement(this, tag);
  }
}

// Time only moves when a test moves it, so waits of minutes take no time and are exact.
function fakeClock() {
  let time = 0;
  let next = 1;
  const timers = new Map();
  const clock = {
    now: () => time,
    setTimeout: (run, ms) => { timers.set(next, { at: time + ms, run }); return next++; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (run, ms) => { timers.set(next, { at: time + ms, run, every: ms }); return next++; },
    clearInterval: (id) => timers.delete(id),
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        time = timer.at;
        if (timer.every) timer.at += timer.every;
        else timers.delete(id);
        timer.run();
        await settle();
      }
      time = end;
      await settle();
    },
  };
  return clock;
}

async function settle() {
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

const starting = ({ retryAfter = '3', message = MESSAGE } = {}) => () => new Response(
  JSON.stringify({ error: message, code: 'database-starting' }),
  { status: 503, headers: { 'Content-Type': 'application/json', 'X-Database-State': 'starting', ...(retryAfter ? { 'Retry-After': retryAfter } : {}) } },
);
const ok = (body = { ok: true }) => () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const respond = (status, body = {}) => () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// steps[n] answers the nth call; the last one keeps answering.
function harness(steps, options = {}) {
  const document = new FakeDocument();
  const app = new FakeElement(document, 'div');
  const button = new FakeElement(document, 'button');
  app.append(button);
  document.body.append(app);
  button.focus();
  const clock = fakeClock();
  const calls = [];
  const fetch = async (input, init) => {
    calls.push({ input, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    const result = await step(input, init);
    if (result instanceof Error) throw result;
    return result;
  };
  const wake = createDatabaseWake({ fetch, location: PAGE, document, timers: clock, now: clock.now, ...options });
  const screens = () => document.body.children.filter((child) => child.className === 'db-wake');
  return { wake, document, app, button, clock, calls, screens, screen: () => screens()[0] };
}

test('requests that are not for the API go straight through', async () => {
  const { wake, calls, screens } = harness([starting()]);
  for (const target of ['/apps/ticketing/assets/main.js', 'https://elsewhere.example/api/me', '/apis/me']) {
    const response = await wake.fetch(target);
    assert.equal(response.status, 503, target);
  }
  assert.equal(calls.length, 3);
  assert.equal(screens().length, 0);
});

test('ordinary answers are left alone, including a 503 the API did not mean as a wait', async () => {
  const cases = [ok(), respond(401, { error: 'Sign in required' }), respond(500, { error: 'Something went wrong.' }), respond(503, { error: 'Busy' })];
  for (const answer of cases) {
    const { wake, calls, screens } = harness([answer]);
    const response = await wake.fetch('/api/me');
    assert.equal(calls.length, 1);
    assert.equal(screens().length, 0);
    assert.ok([200, 401, 500, 503].includes(response.status));
  }
});

test('the page is covered while the database starts, then gets the real answer', async () => {
  const { wake, app, button, clock, calls, screen, screens, document } = harness([starting(), starting(), ok({ user: 'Mat' })]);
  const init = { method: 'POST', credentials: 'include', body: '{"email":"a@b.c"}' };
  const pending = wake.fetch('/api/login', init);
  await settle();

  const cover = screen();
  assert.ok(cover, 'the wait screen is up');
  assert.equal(cover.attributes.role, 'alertdialog');
  assert.equal(cover.attributes['aria-modal'], 'true');
  assert.equal(cover.find('db-wake__title').textContent, 'Please wait');
  assert.equal(cover.find('db-wake__message').textContent, MESSAGE);
  assert.match(cover.find('db-wake__hint').textContent, /carry on by itself/);
  assert.equal(cover.find('db-wake__spinner').attributes['aria-hidden'], 'true');
  assert.equal(app.inert, true, 'the page behind cannot be reached');
  assert.equal(document.activeElement, cover, 'focus moves to the message');

  await clock.advance(3_000);
  assert.equal(calls.length, 2);
  assert.equal(screens().length, 1);
  await clock.advance(3_000);

  const response = await pending;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user: 'Mat' });
  assert.equal(screens().length, 0);
  assert.equal(app.inert, false);
  assert.equal(document.activeElement, button, 'focus goes back where it was');
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.input, '/api/login');
    assert.equal(call.init, init);
  }
});

test('it asks again as often as the API says, within reason', async () => {
  const cases = [['7', 7_000], [undefined, 3_000], ['0', 3_000], ['120', 15_000], ['0.2', 1_000]];
  for (const [retryAfter, expected] of cases) {
    const { wake, clock, calls } = harness([starting({ retryAfter }), ok()]);
    const pending = wake.fetch('/api/me');
    await settle();
    await clock.advance(expected - 1);
    assert.equal(calls.length, 1, `${retryAfter}: too early`);
    await clock.advance(1);
    assert.equal(calls.length, 2, `${retryAfter}: on time`);
    assert.equal((await pending).status, 200);
  }
});

test('requests waiting together share one screen, which stays until the last is done', async () => {
  const { wake, clock, screens } = harness([starting(), starting(), ok(), starting(), ok()]);
  const first = wake.fetch('/api/me');
  const second = wake.fetch('/api/apps');
  await settle();
  assert.equal(screens().length, 1);

  await clock.advance(3_000);
  assert.equal(screens().length, 1, 'one request is done, the other is not');
  await clock.advance(3_000);
  assert.deepEqual([(await first).status, (await second).status], [200, 200]);
  assert.equal(screens().length, 0);
});

test('a request the page cancels stops waiting and takes the screen down', async () => {
  const { wake, clock, calls, screens } = harness([starting()]);
  const controller = new AbortController();
  const pending = wake.fetch('/api/me', { signal: controller.signal });
  const outcome = pending.then(() => null, (error) => error);
  await settle();
  assert.equal(screens().length, 1);

  controller.abort();
  const error = await outcome;
  assert.equal(error.name, 'AbortError');
  assert.equal(screens().length, 0);
  await clock.advance(60_000);
  assert.equal(calls.length, 1, 'nothing is sent after the cancel');
});

test('after the wait is used up the page gets a plain 503 that says so', async () => {
  const { wake, clock, calls, screens } = harness([starting()], { giveUpMs: 10_000 });
  const pending = wake.fetch('/api/me');
  await settle();
  await clock.advance(12_000);

  const response = await pending;
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('X-Database-State'), null, 'the page is not told to wait again');
  const body = await response.json();
  assert.match(body.error, /taking longer than expected to start/);
  assert.equal(screens().length, 0);
  assert.equal(calls.length, 5);
});

test('it admits when it is slow and shows how long it has been waiting', async () => {
  const { wake, clock, screen } = harness([starting()], { slowAfterMs: 30_000, giveUpMs: 600_000 });
  wake.fetch('/api/me');
  await settle();
  const cover = screen();
  assert.equal(cover.find('db-wake__elapsed').textContent, 'Waiting 0:00');
  assert.equal(cover.find('db-wake__slow').hidden, true);

  await clock.advance(29_000);
  assert.equal(cover.find('db-wake__elapsed').textContent, 'Waiting 0:29');
  assert.equal(cover.find('db-wake__slow').hidden, true);
  await clock.advance(36_000);
  assert.equal(cover.find('db-wake__elapsed').textContent, 'Waiting 1:05');
  assert.equal(cover.find('db-wake__slow').hidden, false);
  assert.equal(cover.find('db-wake__elapsed').attributes['aria-hidden'], 'true', 'the ticking clock is not read out');
});

test('a Request object is sent again with its body', async () => {
  const bodies = [];
  const record = (answer) => async (input) => {
    bodies.push(await input.text());
    return answer();
  };
  const { wake, clock } = harness([record(starting()), record(ok())]);
  const request = new Request('http://web.test/api/ticketing/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"subject":"Printer"}',
  });
  const pending = wake.fetch(request);
  await settle();
  await clock.advance(3_000);
  assert.equal((await pending).status, 200);
  assert.deepEqual(bodies, ['{"subject":"Printer"}', '{"subject":"Printer"}']);
});

test('a bodyless Request object is sent again too', async () => {
  const { wake, clock, calls } = harness([starting(), ok()]);
  const pending = wake.fetch(new Request('http://web.test/api/apps'));
  await settle();
  await clock.advance(3_000);
  assert.equal((await pending).status, 200);
  assert.equal(calls.length, 2);
});

test('a body that can only be read once is not waited for', async () => {
  const { wake, calls, screens } = harness([starting(), ok()]);
  const body = new ReadableStream({ start(controller) { controller.close(); } });
  const response = await wake.fetch('/api/upload', { method: 'POST', body, duplex: 'half' });
  assert.equal(response.status, 503);
  assert.equal(calls.length, 1);
  assert.equal(screens().length, 0);
});

test('the words come from the API and are shown as text, never as markup', async () => {
  const markup = '<img src=x onerror="alert(1)"> waking up';
  const { wake, screen } = harness([starting({ message: markup })]);
  wake.fetch('/api/me');
  await settle();
  const message = screen().find('db-wake__message');
  assert.equal(message.textContent, markup);
  assert.equal(message.children.length, 0);
});

test('without usable words from the API, it says what it knows', async () => {
  const answers = [
    () => new Response('not json', { status: 503, headers: { 'X-Database-State': 'starting' } }),
    () => new Response('{"error":42}', { status: 503, headers: { 'X-Database-State': 'starting' } }),
    () => new Response('{}', { status: 503, headers: { 'X-Database-State': 'starting' } }),
  ];
  for (const answer of answers) {
    const { wake, screen } = harness([answer]);
    wake.fetch('/api/me');
    await settle();
    assert.equal(screen().find('db-wake__message').textContent, MESSAGE);
  }
});

test('a network failure while waiting reaches the page as it would have anyway', async () => {
  const { wake, clock, screens } = harness([starting(), () => new TypeError('Failed to fetch')]);
  const pending = wake.fetch('/api/me');
  const outcome = pending.then(() => null, (error) => error);
  await settle();
  await clock.advance(3_000);
  const error = await outcome;
  assert.equal(error.message, 'Failed to fetch');
  assert.equal(screens().length, 0);
});

test('a different answer while waiting ends the wait and is handed over', async () => {
  const { wake, clock, screens } = harness([starting(), respond(401, { error: 'Sign in required' })]);
  const pending = wake.fetch('/api/me');
  await settle();
  await clock.advance(3_000);
  const response = await pending;
  assert.equal(response.status, 401);
  assert.equal(screens().length, 0);
});

test('a wait screen that cannot be drawn does not stop the wait', async () => {
  const { wake, document, clock } = harness([starting(), ok()]);
  document.createElement = () => {
    throw new Error('no DOM today');
  };
  const original = console.error;
  console.error = () => {};
  try {
    const pending = wake.fetch('/api/me');
    await settle();
    await clock.advance(3_000);
    assert.equal((await pending).status, 200);
  } finally {
    console.error = original;
  }
});

test('installing wraps the page fetch once', async () => {
  const seen = [];
  const original = async (input) => {
    seen.push(input);
    return ok()();
  };
  const document = new FakeDocument();
  const page = { fetch: original, location: PAGE, document };
  const wake = installDatabaseWake({ window: page, timers: fakeClock() });
  assert.ok(wake);
  assert.notEqual(page.fetch, original);
  assert.equal(page.__emgDatabaseWake, wake);
  assert.equal(installDatabaseWake({ window: page }), null, 'a second copy of the script does nothing');
  assert.equal(installDatabaseWake({ window: null }), null);
  assert.equal(installDatabaseWake({ window: {} }), null);

  assert.equal((await page.fetch('/api/me')).status, 200);
  assert.deepEqual(seen, ['/api/me']);
});
