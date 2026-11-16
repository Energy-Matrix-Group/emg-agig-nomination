const PRUNE_AT = 10_000;

// Counts failures per key in a fixed window that starts at the first failure.
// State lives in this process, so a restart or a second instance starts from zero.
export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const windows = new Map();

  function current(key) {
    const window = windows.get(key);
    if (window && window.resetAt > now()) return window;
    windows.delete(key);
    return null;
  }

  function prune() {
    const time = now();
    for (const [key, window] of windows) if (window.resetAt <= time) windows.delete(key);
  }

  return {
    // Seconds until the key may try again, or 0 when it is not blocked.
    retryAfter(key) {
      const window = current(key);
      if (!window || window.count < limit) return 0;
      return Math.max(1, Math.ceil((window.resetAt - now()) / 1000));
    },
    fail(key) {
      if (windows.size >= PRUNE_AT) prune();
      const window = current(key);
      if (window) window.count += 1;
      else windows.set(key, { count: 1, resetAt: now() + windowMs });
    },
    reset(key) {
      windows.delete(key);
    },
  };
}

// The first X-Forwarded-For entry is the browser as the proxies saw it. A client can forge it, so
// limits keyed on it only slow honest mistakes and simple scripts; per-account and total limits hold regardless.
export function clientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}
