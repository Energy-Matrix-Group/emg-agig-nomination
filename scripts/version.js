const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const STEPS = ['patch', 'minor', 'major'];

// Every push to main moves the patch number. A commit can ask for a larger step
// with a line `Version: minor` or `Version: major`; the largest step asked for in the push wins.
export function bumpVersion(current, message = '') {
  const match = VERSION.exec(String(current).trim());
  if (!match) throw new Error('VERSION must be major.minor.patch');
  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);
  const asked = [...String(message).matchAll(/^[ \t]*Version:[ \t]*(major|minor|patch)\b/gim)]
    .map((found) => found[1].toLowerCase())
    .reduce((largest, step) => (STEPS.indexOf(step) > STEPS.indexOf(largest) ? step : largest), 'patch');
  if (asked === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (asked === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}
