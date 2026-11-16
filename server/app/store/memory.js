// In-memory stand-in for the SQL store, with the same async interface.
// Every function is async even though nothing here waits, so callers always await.
export function createMemoryStore() {
  const visits = new Map();

  return {
    // Counts how many times a person has said hello, and returns the new count.
    async recordVisit(userId) {
      const count = (visits.get(userId) ?? 0) + 1;
      visits.set(userId, count);
      return count;
    },
  };
}
