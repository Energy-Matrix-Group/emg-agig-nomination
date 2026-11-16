import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { bumpVersion } from './version.js';

const file = new URL('../VERSION', import.meta.url);
const current = readFileSync(file, 'utf8');
const next = bumpVersion(current, pushMessages());
writeFileSync(file, `${next}\n`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${next}\n`);
}
process.stdout.write(`${next}\n`);

// COMMIT_MESSAGES is the JSON array of every commit message in the push; COMMIT_MESSAGE is one message.
function pushMessages() {
  try {
    const messages = JSON.parse(process.env.COMMIT_MESSAGES || 'null');
    if (Array.isArray(messages)) return messages.map(String).join('\n');
  } catch {
    // Fall back to the single message.
  }
  return process.env.COMMIT_MESSAGE || '';
}
