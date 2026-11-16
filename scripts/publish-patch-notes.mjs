import { execFileSync } from 'node:child_process';
import { writePatchNote } from './patch-note.js';

const version = (process.env.RELEASE_VERSION || '').trim();
const repo = (process.env.RELEASE_REPO || 'EMG-Api').trim();
const origin = (process.env.DOCS_API_ORIGIN || '').replace(/\/$/, '');
const token = process.env.RELEASE_NOTES_TOKEN || '';
const MODEL_TIMEOUT_MS = 120_000;
const API_TIMEOUT_MS = 60_000;

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('RELEASE_VERSION must be major.minor.patch');
  process.exit(1);
}
if (!origin || !token) {
  console.error('DOCS_API_ORIGIN and RELEASE_NOTES_TOKEN are required');
  process.exit(1);
}
if (!isSafeOrigin(origin)) {
  console.error('DOCS_API_ORIGIN must be an https origin, so the release token is not sent in clear text');
  process.exit(1);
}

const range = pushRange(process.env.BEFORE_SHA || '', process.env.RELEASE_SHA || '');
const commits = git(['log', '--format=%s', range]).split('\n').map((line) => line.trim()).filter(Boolean);
const files = git(['diff', '--name-only', range]).split('\n').map((line) => line.trim()).filter(Boolean);
const diff = git(['diff', '--unified=3', range]);
const body = await writePatchNote({
  repo,
  version,
  commits,
  files,
  diff,
  complete: completeFromEnv(),
});

let response;
try {
  response = await fetch(`${origin}/api/docs/releases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ version, repo, body }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
} catch (error) {
  console.error(`Documentation API at ${origin} could not be reached: ${error?.cause?.code || error?.message || 'network error'}`);
  process.exit(1);
}
const text = await response.text();
if (!response.ok) {
  console.error(text || `Documentation API returned ${response.status}`);
  process.exit(1);
}
process.stdout.write(`${text}\n`);

function isSafeOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function pushRange(before, sha) {
  const end = /^[0-9a-f]{40}$/i.test(sha) ? sha : 'HEAD';
  if (/^[0-9a-f]{40}$/i.test(before) && !/^0+$/.test(before)) return `${before}..${end}`;
  return `${end}~1..${end}`;
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  } catch {
    return '';
  }
}

function completeFromEnv() {
  const azureEndpoint = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
  const azureKey = process.env.AZURE_OPENAI_API_KEY || '';
  const azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT || '';
  const openAiKey = process.env.OPENAI_API_KEY || '';
  if (azureEndpoint && azureKey && azureDeployment) {
    const url = `${azureEndpoint}/openai/deployments/${encodeURIComponent(azureDeployment)}/chat/completions?api-version=2024-10-21`;
    return (prompt) => chat(url, { 'api-key': azureKey }, prompt);
  }
  if (openAiKey) {
    return (prompt) => chat('https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${openAiKey}` }, prompt, process.env.OPENAI_MODEL || 'gpt-4o-mini');
  }
  return null;
}

async function chat(url, headers, prompt, model) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      ...(model ? { model } : {}),
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You write accurate product patch notes from a code diff.' },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });
  if (!response.ok) {
    console.error(`Patch note model returned ${response.status}`);
    return '';
  }
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}
