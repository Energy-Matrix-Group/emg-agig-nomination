const DIFF_LIMIT = 60_000;

export function fallbackNote({ repo, version, commits, files }) {
  const commitLines = commits.length ? commits.map((line) => `- ${line}`) : ['- No commit subjects were recorded.'];
  const fileLines = files.length ? files.map((line) => `- ${line}`) : ['- No file list was recorded.'];
  return [
    `# ${repo} ${version}`,
    '',
    'Recorded from the push. An AI summary was not available for this release.',
    '',
    '## Commits',
    ...commitLines,
    '',
    '## Files',
    ...fileLines,
    '',
  ].join('\n');
}

export function notePrompt({ repo, version, commits, diff }) {
  return [
    `Write patch notes for ${repo} version ${version}.`,
    'The reader is a colleague who uses the product, not the author of the change.',
    'Use Markdown. Start with a short paragraph of what changed for people using the product.',
    'Then a "Changes" list of the concrete behaviour, and a "Files" list only when a path helps someone find the work.',
    'Leave out secrets, credentials, and anything that looks like a password or connection string.',
    'Do not invent changes that are not in the commits or the diff.',
    '',
    'Commits:',
    commits.join('\n') || '(none)',
    '',
    'Diff:',
    clip(diff),
  ].join('\n');
}

export function clip(diff) {
  const text = String(diff || '');
  if (text.length <= DIFF_LIMIT) return text || '(no diff)';
  return `${text.slice(0, DIFF_LIMIT)}\n…(diff truncated)`;
}

export async function writePatchNote({ repo, version, commits, files, diff, complete }) {
  if (typeof complete === 'function') {
    let text = '';
    try {
      text = await complete(notePrompt({ repo, version, commits, diff }));
    } catch (error) {
      console.error(`Patch note model failed: ${error?.message || error}`);
    }
    const note = typeof text === 'string' ? text.trim() : '';
    if (note) return note;
  }
  return fallbackNote({ repo, version, commits, files });
}
