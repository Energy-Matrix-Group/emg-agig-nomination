import * as appModule from '../server/app/index.js';
import { login, request, withServer } from './helpers.js';

// What every test of this app shares. The app runs through the real platform (withServer: the fake portal, the
// real handoff and cookie), with a clock the test controls, no background jobs, and a fetch that reaches nothing
// unless the test gives one, so no test ever touches the network.
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

export const noNetwork = async (url) => {
  throw new Error(`A test tried to reach ${url}`);
};

export function testApp({ clock, fetch = noNetwork } = {}) {
  return { ...appModule, setup: (options) => appModule.setup({ ...options, clock, fetch, jobs: false }) };
}

// Runs `run` with the app started. It receives what withServer gives, plus:
//   clock      the test's clock
//   ops        a signed-in member of the ops team (company role Ops Trader): { cookie, call(path, options) }
//   viewer     a signed-in person with no role, who may look but not change anything
//   app        what setup() returned
export async function withApp(run, { env = {}, clock = testClock(), fetch, participant = 'EMG Shipper' } = {}) {
  const settings = { NOM_PARTICIPANT: participant ?? '', ...env };
  await withServer(async (context) => {
    context.portal.createUser({ email: OPS_EMAIL, displayName: 'Olive Ops', role: 'ops-trader' });
    const signIn = async (email) => {
      const { cookie } = await login(context.base, email);
      return { cookie, call: (path, options = {}) => request(context.base, `${PREFIX}${path}`, { cookie, ...options }) };
    };
    const ops = await signIn(OPS_EMAIL);
    const viewer = await signIn('staff@energymatrix.com.au');
    await run({ ...context, clock, ops, viewer, app: await context.appContext(), signIn });
  }, { app: testApp({ clock, fetch }), env: settings });
}

// The contracts most tests use: a Transport contract on the DBNGP with 25 TJ of capacity, and a Spot contract.
export async function addContracts(ops) {
  const transport = await ops.call('/contracts', { method: 'POST', body: { code: 'Shipper1_FH01', type: 'Transport', pipelineCode: 'DBNGP', startDate: '2026-01-01', capacityTJ: '25', serviceType: 'T1' } });
  const spot = await ops.call('/contracts', { method: 'POST', body: { code: 'Shipper1_SPOT', type: 'Spot', pipelineCode: 'DBNGP', startDate: '2026-01-01' } });
  if (transport.status !== 201 || spot.status !== 201) throw new Error(`Contracts were not made: ${JSON.stringify([transport.data, spot.data])}`);
  return { transport: transport.data.contract, spot: spot.data.contract };
}

// A good day's nomination: 20 TJ in at Karratha, 12.5 and 7.25 out at Kemerton and Pinjarra.
export function dayLines(gasDay = TOMORROW, { kemerton = '12.5' } = {}) {
  return [
    { gasDay, contract: 'Shipper1_FH01', designation: 'I1-01', quantity: '20' },
    { gasDay, contract: 'Shipper1_FH01', designation: 'OS5-01', quantity: kemerton },
    { gasDay, contract: 'Shipper1_FH01', designation: 'OS2-01', quantity: '7.25' },
  ];
}

export async function publish(ops, lines, extra = {}) {
  return ops.call('/batches', { method: 'POST', body: { lines, ...extra } });
}

// An AGIG response attachment, as Appendix I lays it out.
export function agigResponse(fileName, { status = 'Success', errors = [] } = {}) {
  const lines = [
    `Filename,${fileName}`,
    'File Timestamp,20261116103000',
    'Participant_Name,EMG Shipper',
    'File Type,SHNOM',
    `Status,${status}`,
  ];
  if (errors.length) {
    lines.push('Line Number,Error Code,Error Description');
    for (const [line, codes, descriptions] of errors) lines.push(`${line},${codes},${descriptions}`);
  }
  lines.push('End');
  return `${lines.join('\r\n')}\r\n`;
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
