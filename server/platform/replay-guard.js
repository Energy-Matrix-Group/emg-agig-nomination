// Remembers which sign-in tokens have been used, until they would have expired anyway.
// The memory is this process only. A restart forgets it, which is safe because a token lives 60 seconds
// and only reaches an app inside a form post. With more than one instance, each keeps its own list.
export function createReplayGuard({ now = Date.now } = {}) {
  const used = new Map();
  return {
    // True the first time an id is claimed, false for every repeat until the token has expired.
    claim(id, expiresAtSeconds) {
      const time = now();
      for (const [key, until] of used) if (until <= time) used.delete(key);
      if (used.has(id)) return false;
      used.set(id, expiresAtSeconds * 1000);
      return true;
    },
    size: () => used.size,
  };
}
