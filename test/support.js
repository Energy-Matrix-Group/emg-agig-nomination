import * as appModule from '../server/app/index.js';
import { login, request, withServer } from './helpers.js';

// What every test of this app shares. The app runs through the real platform (withServer: the fake portal, the
// real handoff and cookie), with a clock the test controls. The rows it shows are written by test/worker.js,
// standing in for the design's worker, straight into the store the app reads.
//
// Times: the clock starts at 10:00 AWST on Monday 16 November 2026 (02:00 UTC), so Gas Day 2026-11-17 is
// before its initial cutoff (14:00 AWST today) and 2026-11-16 is in its renomination window.

export const PREFIX = appModule.catalog.apiPrefix;
export const START = '2026-11-16T02:00:00Z';
export const TODAY = '2026-11-16';
export const TOMORROW = '2026-11-17';
export const OPS_EMAIL = 'ops.trader@energymatrix.com.au';

export function testClock(at = START) {
  let now = new Date(at);
  const clock = () => new Date(now);
  clock.set = (value) => { now = new Date(value); };
  clock.advance = (minutes) => { now = new Date(now.getTime() + minutes * 60_000); };
  return clock;
}

export function testApp({ clock } = {}) {
  return { ...appModule, setup: (options) => appModule.setup({ ...options, clock }) };
}

// Runs `run` with the app started. It receives what withServer gives, plus:
//   clock    the test's clock
//   store    the store the app reads, for test/worker.js to write into
//   ops      a signed-in member of the ops team (company role Ops Trader): { cookie, call(path, options) }
//   viewer   a signed-in person with no role, who may look but not act on alerts
export async function withApp(run, { env = {}, clock = testClock() } = {}) {
  await withServer(async (context) => {
    context.portal.createUser({ email: OPS_EMAIL, displayName: 'Olive Ops', role: 'ops-trader' });
    const signIn = async (email) => {
      const { cookie } = await login(context.base, email);
      return { cookie, call: (path, options = {}) => request(context.base, `${PREFIX}${path}`, { cookie, ...options }) };
    };
    const app = await context.appContext();
    await run({ ...context, clock, app, store: app.store, ops: await signIn(OPS_EMAIL), viewer: await signIn('staff@energymatrix.com.au') });
  }, { app: testApp({ clock }), env });
}

export async function quietly(run) {
  const { error, warn, log } = console;
  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};
  try {
    return await run();
  } finally {
    Object.assign(console, { error, warn, log });
  }
}
