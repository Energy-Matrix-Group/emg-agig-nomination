import { gasDayBoard } from './board.js';
import { batchDetail } from './detail.js';
import { startJobs } from './jobs.js';
import { createMailbox, NO_MAILBOX } from './mailbox.js';
import { createRoutes } from './routes.js';
import { readSettings } from './settings.js';
import { openStore } from './store/index.js';

// This is the only file the platform reads from server/app/. docs/SPEC.md says what the app is for and
// docs/API.md is the route contract.
export const catalog = {
  id: 'agig-nomination',
  name: 'AGIG Nominations',
  description: 'Shipper transport nominations to AGIG\'s TBS: enter, check, send and track every Gas Day against the cutoffs.',
  apiPrefix: '/api/agig-nomination',
  statusLabel: null,
  message: 'Shipper transport nominations to AGIG\'s TBS: enter, check, send and track every Gas Day against the cutoffs.',
};

// A static UI: one folder per page under web/, no build step. No page opens without a sign-in.
export const ui = { root: 'web', spa: false, publicPaths: [] };

// Runs once at boot. Its result is `app` in every handler: the store, the settings, the clock and the mailbox.
// It must not take the service down over its database: openStore falls back to memory and says so
// (databaseConnected: false), and then no job reaches the outside world.
//
// The tests pass a clock, a fetch and jobs: false, so time and the network are theirs.
export async function setup({ sql = null, env = {}, connect, clock = () => new Date(), fetch = globalThis.fetch, jobs = true } = {}) {
  const settings = readSettings(env);
  const opened = await openStore({ sql, env, connect, clock });
  const app = {
    ...opened,
    settings,
    clock,
    fetch,
    appUrl: String(env.APP_URL ?? '').replace(/\/+$/, '') || null,
    mailbox: settings.mail ? createMailbox({ mail: settings.mail, fetch, clock }) : NO_MAILBOX,
    runtime: { agentSeenAt: null, uploadingSince: new Map(), postedThrough: 0, jobs: {} },
  };
  if (jobs && opened.databaseConnected !== false) app.jobs = startJobs(app);
  return app;
}

// auth: true means a signed-in user. The portal has already checked that they may open this app.
export const routes = createRoutes(catalog.apiPrefix);

// What Joules, the EMG helper in the portal, can do here for a person. Each action runs as that person. They
// only look: publishing a nomination stays a deliberate step on the New nomination page.
export const assistant = {
  about: 'AGIG Nominations sends EMG\'s shipper transport nominations (SHNOM files) to AGIG\'s TBS for the DBNGP and the other AGIG pipelines, and tracks each Gas Day against the cutoffs: 14:00 AWST the day before for the initial nomination, 20:00 AWST on the day for renominations. Joules can say whether each Gas Day is covered by an accepted nomination, what happened to a batch, and which alerts are open.',
  actions: [
    {
      name: 'gas_day_status',
      kind: 'read',
      title: 'Gas Day status',
      description: 'For yesterday to a week ahead: whether AGIG has accepted a nomination for each Gas Day, what is waiting, and when the cutoffs fall (times in UTC; AWST is UTC+8).',
      input: { type: 'object', properties: {} },
      run: async ({ app }) => {
        const board = await gasDayBoard(app);
        return {
          environment: board.environment,
          today: board.today,
          days: board.days.map((day) => ({
            gasDay: day.gasDay, status: day.label, colour: day.colour, initialCutoffUtc: day.initialCutoff, renominationCutoffUtc: day.renominationCutoff,
            latestBatch: day.latest && { id: day.latest.batchId, status: day.latest.statusLabel, outletTJ: day.latest.outletTJ },
            acceptedOutletTJ: day.held.lines ? day.held.outletTJ : null,
          })),
        };
      },
    },
    {
      name: 'batch_status',
      kind: 'read',
      title: 'A batch',
      description: 'One nomination batch by its number: its status, the file sent, when each step happened, and AGIG\'s errors if it was rejected.',
      input: { type: 'object', properties: { batchId: { type: 'integer', minimum: 1, description: 'The batch number, as the Submissions page shows it.' } }, required: ['batchId'] },
      run: async ({ app, user, input }) => {
        const detail = await batchDetail(app, user, input.batchId).catch((error) => {
          if (error.status === 404) return null;
          throw error;
        });
        if (!detail) return { found: false };
        return {
          found: true,
          id: detail.batch.id,
          status: detail.batch.statusLabel,
          gasDays: `${detail.batch.gasDayFrom} to ${detail.batch.gasDayTo}`,
          publishedBy: detail.batch.createdBy,
          lines: detail.rows.length,
          file: detail.file?.fileName ?? null,
          timeline: detail.timeline.filter((step) => step.at),
          agigErrors: detail.rows.flatMap((row) => row.agigErrors.map((error) => ({ line: row.csvLineNumber, designation: row.designation, code: error.errorCode, meaning: error.meaning ?? error.errorDescription }))).slice(0, 40),
          path: `/batch/?id=${detail.batch.id}`,
        };
      },
    },
    {
      name: 'open_alerts',
      kind: 'read',
      title: 'Open alerts',
      description: 'The alerts that are still open: rejections, files with no answer, cutoffs close with nothing accepted, key expiry.',
      input: { type: 'object', properties: {} },
      run: async ({ app }) => ({
        alerts: (await app.store.listAlerts({ open: true, limit: 30 })).map(({ id, type, severity, message, raisedAt, acknowledgedBy }) => ({ id, type, severity, message, raisedAt, acknowledged: Boolean(acknowledgedBy) })),
      }),
    },
  ],
};
