// The platform's answer to a database that is starting after a cost-saving pause.
//
// server.js adds this script to every page it serves, so every applet gets it whatever it is built
// with, and so will one that does not exist yet. It wraps window.fetch. When the API says the
// database is starting, it covers the page with a message and a spinner, asks again until the
// database is up, and hands the applet the real response. The applet never sees the 503, so it
// needs no code of its own. Applets only need to call the API with fetch.

const STATE_HEADER = 'X-Database-State';

const DEFAULTS = {
  retryMs: 3_000, // between attempts, unless the API says otherwise
  slowAfterMs: 2 * 60_000, // when to admit it is taking longer than usual
  giveUpMs: 5 * 60_000, // when to stop and let the page show its own error
};

const TITLE = 'Please wait';
const FALLBACK_MESSAGE = 'The database is starting up after a cost-saving pause. This usually takes about a minute.';
const HINT = 'This page will carry on by itself. There is no need to refresh.';
const SLOW = 'This is taking longer than usual. It is still trying.';
const GAVE_UP = 'The database is taking longer than expected to start. Please try again in a few minutes.';

export function installDatabaseWake({ window: page = globalThis.window, timers, ...options } = {}) {
  if (!page || typeof page.fetch !== 'function' || page.__emgDatabaseWake) return null;
  const nativeFetch = page.fetch.bind(page);
  const wake = createDatabaseWake({
    fetch: nativeFetch,
    location: page.location,
    document: page.document,
    timers: timers ?? browserTimers(page),
    ...options,
  });
  page.fetch = wake.fetch;
  page.__emgDatabaseWake = wake;
  return wake;
}

function browserTimers(page) {
  return {
    setTimeout: (...args) => page.setTimeout(...args),
    clearTimeout: (...args) => page.clearTimeout(...args),
    setInterval: (...args) => page.setInterval(...args),
    clearInterval: (...args) => page.clearInterval(...args),
  };
}

export function createDatabaseWake({
  fetch,
  location,
  document,
  timers,
  now = Date.now,
  retryMs = DEFAULTS.retryMs,
  slowAfterMs = DEFAULTS.slowAfterMs,
  giveUpMs = DEFAULTS.giveUpMs,
}) {
  const overlay = createOverlay({ document, timers, now, slowAfterMs });

  async function wakingFetch(input, init) {
    if (!isApiRequest(input, location)) return fetch(input, init);
    const again = replayer(fetch, input, init);
    const first = await fetch(input, init);
    if (!again || !isStarting(first)) return first;
    return wait(first, again, signalOf(input, init));
  }

  // The API refused the connection before a statement ran, so sending it again is safe whatever its method.
  async function wait(first, again, signal) {
    const started = now();
    const hold = overlay.hold(await messageOf(first));
    try {
      let latest = first;
      while (isStarting(latest)) {
        if (now() - started >= giveUpMs) {
          discard(latest);
          return gaveUp();
        }
        await pause(timers, retryAfterMs(latest, retryMs), signal);
        discard(latest);
        latest = await again();
      }
      return latest;
    } finally {
      hold.release();
    }
  }

  return { fetch: wakingFetch, overlay };
}

function isStarting(response) {
  return response.status === 503 && response.headers.get(STATE_HEADER) === 'starting';
}

function isApiRequest(input, location) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  let url;
  try {
    url = new URL(raw, location.href);
  } catch {
    return false;
  }
  return url.origin === location.origin && (url.pathname === '/api' || url.pathname.startsWith('/api/'));
}

// Returns a function that sends the same request again, or null when it cannot be sent twice.
function replayer(fetch, input, init) {
  if (typeof Request !== 'undefined' && input instanceof Request) {
    if (input.bodyUsed) return null;
    if (input.body === null) return () => fetch(new Request(input), init);
    const copy = input.clone();
    return () => fetch(copy.clone(), init);
  }
  if (typeof ReadableStream !== 'undefined' && init?.body instanceof ReadableStream) return null;
  return () => fetch(input, init);
}

function signalOf(input, init) {
  return init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
}

async function messageOf(response) {
  try {
    const body = await response.clone().json();
    return typeof body?.error === 'string' && body.error ? body.error : FALLBACK_MESSAGE;
  } catch {
    return FALLBACK_MESSAGE;
  }
}

function retryAfterMs(response, fallback) {
  const seconds = Number(response.headers.get('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.max(seconds * 1000, 1_000), 15_000) : fallback;
}

// A page that waited this long gets a plain 503 to show its own way, worded for what happened.
function gaveUp() {
  return new Response(JSON.stringify({ error: GAVE_UP, code: 'database-starting' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

function discard(response) {
  try {
    response.body?.cancel?.().catch(() => {});
  } catch {
    // An unread body is only a courtesy to free.
  }
}

function pause(timers, ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      timers.clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = timers.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortReason(signal) {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

// One overlay however many requests are waiting. It goes when the last of them is done.
export function createOverlay({ document, timers, now, slowAfterMs }) {
  let holds = 0;
  let open = null;

  return {
    hold(message) {
      holds += 1;
      if (holds === 1) open = safely(() => show(document, timers, now, slowAfterMs, message));
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          holds -= 1;
          if (holds === 0) {
            safely(() => open?.close());
            open = null;
          }
        },
      };
    },
    get visible() {
      return open !== null;
    },
  };
}

// The wait must still work if the screen cannot be drawn, so nothing here may break the request.
function safely(work) {
  try {
    return work();
  } catch (error) {
    console.error(error);
    return null;
  }
}

function show(document, timers, now, slowAfterMs, message) {
  const root = element(document, 'div', 'db-wake');
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'db-wake-title');
  root.setAttribute('aria-describedby', 'db-wake-message');
  root.setAttribute('tabindex', '-1');

  const panel = element(document, 'div', 'db-wake__panel');
  const spinner = element(document, 'span', 'db-wake__spinner');
  spinner.setAttribute('aria-hidden', 'true');
  const title = element(document, 'h2', 'db-wake__title', TITLE);
  title.setAttribute('id', 'db-wake-title');
  const text = element(document, 'p', 'db-wake__message', message);
  text.setAttribute('id', 'db-wake-message');
  const hint = element(document, 'p', 'db-wake__hint', HINT);
  const elapsed = element(document, 'p', 'db-wake__elapsed');
  elapsed.setAttribute('aria-hidden', 'true');
  const slow = element(document, 'p', 'db-wake__slow', SLOW);
  slow.hidden = true;
  panel.append(spinner, title, text, hint, elapsed, slow);
  root.append(panel);

  const parent = document.body ?? document.documentElement;
  const behind = [...parent.children].filter((child) => !child.inert);
  const focused = document.activeElement;
  for (const child of behind) child.inert = true;
  parent.append(root);
  root.focus?.();

  const started = now();
  const tick = () => {
    const waited = now() - started;
    elapsed.textContent = `Waiting ${clock(waited)}`;
    if (waited >= slowAfterMs) slow.hidden = false;
  };
  tick();
  const interval = timers.setInterval(tick, 1_000);

  return {
    close() {
      timers.clearInterval(interval);
      root.remove();
      for (const child of behind) child.inert = false;
      if (focused?.isConnected && typeof focused.focus === 'function') focused.focus();
    },
  };
}

function element(document, tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clock(ms) {
  const seconds = Math.floor(ms / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

installDatabaseWake();
