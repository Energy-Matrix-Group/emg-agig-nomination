// This app's own settings (NOM_*), read once at boot. A setting that is wrong stops the app with a message that
// names it, as the platform does for its own. Both are in .env.example with a comment, and in the README.
//
// The app only watches: the design's worker loads the batches, sends the files to AGIG, reads AGIG's emails and
// raises the alerts, with its own settings (nomhub.yaml on the office VM). So the app needs very little here.

export function readSettings(env = {}) {
  const problems = [];
  const text = (name) => String(env[name] ?? '').trim();

  const environment = (text('NOM_ENVIRONMENT') || 'NP').toUpperCase();
  if (!['NP', 'PROD'].includes(environment)) problems.push('NOM_ENVIRONMENT must be NP or PROD.');

  let cutoffWarningMinutes = 60;
  if (text('NOM_CUTOFF_WARNING_MINUTES')) {
    cutoffWarningMinutes = Number(text('NOM_CUTOFF_WARNING_MINUTES'));
    if (!Number.isInteger(cutoffWarningMinutes) || cutoffWarningMinutes < 5 || cutoffWarningMinutes > 600) {
      problems.push('NOM_CUTOFF_WARNING_MINUTES must be a whole number from 5 to 600.');
    }
  }

  if (problems.length) throw new Error(`AGIG Nominations cannot start:\n${problems.map((line) => `  - ${line}`).join('\n')}`);
  return { environment, cutoffWarningMinutes };
}
