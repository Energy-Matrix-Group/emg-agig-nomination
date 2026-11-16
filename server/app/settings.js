import { isGasDay, minutesOfDay } from './time.js';

// This app's own settings (NOM_*), read once at boot. A setting that is wrong stops the app with a message that
// names it, as the platform does for its own. Every one is in .env.example with a comment, and in the README.
//
// What the design kept in the worker's nomhub.yaml lives here now. The SFTP host, username, key and host key are
// not here at all: they stay on the office VM, with the upload agent (scripts/agent/), because AGIG only accepts
// connections from the office's registered IP address.

const PARTICIPANT = /^[A-Za-z0-9][A-Za-z0-9 _.&-]{0,59}$/;
const MAIL_PARTS = ['NOM_MAIL_TENANT_ID', 'NOM_MAIL_CLIENT_ID', 'NOM_MAIL_CLIENT_SECRET', 'NOM_MAIL_MAILBOX'];

export function readSettings(env = {}) {
  const problems = [];
  const text = (name) => String(env[name] ?? '').trim();
  const whole = (name, fallback, min, max) => {
    const raw = text(name);
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      problems.push(`${name} must be a whole number from ${min} to ${max}.`);
      return fallback;
    }
    return value;
  };

  const environment = (text('NOM_ENVIRONMENT') || 'NP').toUpperCase();
  if (!['NP', 'PROD'].includes(environment)) problems.push('NOM_ENVIRONMENT must be NP or PROD.');

  const participant = text('NOM_PARTICIPANT');
  if (participant && !PARTICIPANT.test(participant)) problems.push('NOM_PARTICIPANT must be the participant name AGIG gave you: letters, digits, spaces and _ . & -, at most 60.');

  const autoApprove = !['false', '0', 'no'].includes(text('NOM_AUTO_APPROVE').toLowerCase());

  const initialAlertTime = text('NOM_INITIAL_ALERT_TIME') || '13:00';
  if (minutesOfDay(initialAlertTime) === null) problems.push('NOM_INITIAL_ALERT_TIME must be a time of day such as 13:00.');

  const keyExpires = text('NOM_SFTP_KEY_EXPIRES') || null;
  if (keyExpires && !isGasDay(keyExpires)) problems.push('NOM_SFTP_KEY_EXPIRES must be a date, yyyy-mm-dd.');

  const given = MAIL_PARTS.filter((name) => text(name));
  if (given.length && given.length < MAIL_PARTS.length) {
    problems.push(`The response mailbox needs all of ${MAIL_PARTS.join(', ')}, or none. Missing: ${MAIL_PARTS.filter((name) => !text(name)).join(', ')}.`);
  }
  const mail = given.length === MAIL_PARTS.length
    ? {
      tenantId: text('NOM_MAIL_TENANT_ID'),
      clientId: text('NOM_MAIL_CLIENT_ID'),
      clientSecret: text('NOM_MAIL_CLIENT_SECRET'),
      mailbox: text('NOM_MAIL_MAILBOX'),
      agigSender: text('NOM_MAIL_AGIG_SENDER') || null,
      pollSeconds: whole('NOM_MAIL_POLL_SECONDS', 60, 15, 3600),
    }
    : null;

  const teamsWebhook = text('NOM_TEAMS_WEBHOOK_URL') || null;
  if (teamsWebhook && !/^https:\/\/[^\s]+$/.test(teamsWebhook)) problems.push('NOM_TEAMS_WEBHOOK_URL must be an https address.');

  const settings = {
    environment,
    participant: participant || null,
    autoApprove,
    responseTimeoutMinutes: whole('NOM_RESPONSE_TIMEOUT_MINUTES', 20, 1, 1440),
    cutoffWarningMinutes: whole('NOM_CUTOFF_WARNING_MINUTES', 60, 5, 600),
    initialAlertTime,
    keyExpires,
    agentEnabled: Boolean(text('NOM_AGENT_TOKEN')),
    mail,
    teamsWebhook,
  };
  if (problems.length) throw new Error(`AGIG Nominations cannot start:\n${problems.map((line) => `  - ${line}`).join('\n')}`);
  return settings;
}
