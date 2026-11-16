// Runs one of the UI's own npm scripts (default: build) when the UI has a project of its own:
// a Vite project in web/ with its own package.json. A static UI (plain HTML, CSS and ES modules) has
// nothing to build or test, and this script says so and exits 0.
//
//   node scripts/build-web.js          installs what the UI needs, then builds it into web/dist
//   node scripts/build-web.js test     the same, then runs the UI's own tests
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const script = process.argv[2] ?? 'build';

if (!/^[a-z][a-z0-9:-]*$/.test(script)) {
  console.error('Usage: node scripts/build-web.js [build|test|<another script of the UI>]');
  process.exit(2);
}
if (!existsSync(path.join(web, 'package.json'))) {
  console.log(`web/ is a static UI. Nothing to ${script}.`);
  process.exit(0);
}
if (!JSON.parse(readFileSync(path.join(web, 'package.json'), 'utf8')).scripts?.[script]) {
  console.log(`web/package.json has no "${script}" script. Nothing to do.`);
  process.exit(0);
}

// Render sets NODE_ENV=production and may reuse a node_modules folder that left the compilers out,
// so it installs with the dev dependencies every time.
const production = process.env.NODE_ENV === 'production';
if (production || !existsSync(path.join(web, 'node_modules'))) {
  run([existsSync(path.join(web, 'package-lock.json')) ? 'ci' : 'install', '--include=dev']);
}
run(['run', script]);

function run(args) {
  const command = `npm ${args.join(' ')}`;
  console.log(`\n> web: ${command}`);
  // npm is a .cmd shim on Windows, which only starts through a shell.
  const result = spawnSync(command, { cwd: web, stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`web: ${command} failed`);
    process.exit(result.status ?? 1);
  }
}
