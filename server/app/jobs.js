import { buildPending } from './batches.js';
import { postNewAlerts, startTeams } from './teams.js';
import { watchdog } from './watchdog.js';

// The background jobs, in this one process (the design's worker jobs). Each runs on its own timer, one run at a
// time, and a failure is logged without its details reaching anyone's screen; the next run tries again. Timers
// are unref'd, so they never keep the process alive on their own.
//
// The mailbox and Teams jobs reach outside the app, so they run only on a real database: never on the memory
// store, and never on the memory fallback after a database failure (docs/ARCHITECTURE.md, 3.1).

export function startJobs(app) {
  const timers = [];
  const running = new Set();
  const every = (seconds, name, work) => {
    const timer = setInterval(async () => {
      if (running.has(name)) return;
      running.add(name);
      try {
        await work();
        app.runtime.jobs[name] = { lastOkAt: app.clock().toISOString(), lastError: null };
      } catch (error) {
        app.runtime.jobs[name] = { ...app.runtime.jobs[name], lastError: error.message, lastFailedAt: app.clock().toISOString() };
        console.error(`The ${name} job failed: ${error.message}`);
      } finally {
        running.delete(name);
      }
    }, seconds * 1000);
    timer.unref?.();
    timers.push(timer);
  };

  every(60, 'watchdog', () => watchdog(app));
  every(20, 'build', () => buildPending(app));
  if (app.store.kind === 'sql') {
    if (app.mailbox.configured) every(app.mailbox.pollSeconds, 'mailbox', () => app.mailbox.poll(app));
    if (app.settings.teamsWebhook) {
      startTeams(app).catch((error) => console.error(`Teams alerts could not start: ${error.message}`));
      every(30, 'teams', () => postNewAlerts(app));
    }
  }
  return { stop: () => timers.forEach((timer) => clearInterval(timer)) };
}
