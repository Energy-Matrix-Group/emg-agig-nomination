# EMG app: agent guide

This repo is one EMG app. It is a single Node service that serves its own UI and its own API, and keeps its own database. People sign in at the portal (`emg-portal`), which hands them to the app. It started as a copy of `emg-app-template`, and every app repo has the same layout. **Read `docs/ARCHITECTURE.md` before you change anything.** The app's own purpose and API are in `docs/SPEC.md` and `docs/API.md`.

## Branches

`test` is the shared integration and staging branch. Work lands there first, is checked on the test environment, and only then goes to `main`.

- **Never commit to `test` directly.** Every change goes in through a pull request whose base is `test`.
- **Create every feature branch from `test`**: `git fetch origin test`, then `git switch -c feature/<short-description> --no-track origin/test` (`fix/<description>` for a bug fix). With no upstream, a plain `git push` can never target `test`. Push with `git push -u origin <branch>`. If your environment assigns a branch name (for example `claude/...`), keep that name but start it from `test`.
- Make small, focused commits with clear messages. Run the tests (and the build, where the repo has one) before you push.
- **Open the pull request into `test`, never `main`.** Say what changed, why, and how to verify it, and link the issue if there is one. Keep unrelated work out of it.
- Keep your branch current by merging `test` into it (`git merge origin/test`). Resolve conflicts on your branch, not on `test`.
- **Never force-push `test` or `main`.** Don't rewrite history on a branch someone else is using.
- If you change an endpoint that another app or the portal calls (the portal directory, a billable-items endpoint, a service-token route), say so in the pull request and link the pull request in the other repo. Merge them close together, so `test` is never left broken.
- If CI or the tests fail on `test` after your merge, fix it straight away or revert your pull request. Don't leave `test` red.
- Don't commit secrets, `.env` files or credentials. Use environment variables.
- **Only Mat Harvey promotes `test` to `main`**, with a separate pull request from `test` to `main`, opened after the change has been checked on the test environment. Nobody else does, and AI agents never push to `main`, merge into `main`, or open a pull request whose base is `main`. The release workflow's version-bump commit is the one automatic write to `main`, and it follows a promotion.
- If a tool, template or default proposes `main` as the base or target, change it to `test`. If a task can only be done by changing `main`, stop and ask Mat.

## Commands

```powershell
npm start          # loads .env if present; runs on memory unless SQL_SERVER is set
npm run build      # builds web/ when it is a Vite project; a static UI has nothing to build
npm test           # every test in test/ (and a built UI's own tests, where it has them)
npm run test:sql   # the same, with .env loaded, so the SQL tests run against the database
```

`.env` is gitignored and holds this app's settings and secrets. Never copy a value from it into a committed file, a doc, a test or chat output. `.env.example` holds names and comments only.

## Layout

```
server/index.js        boot: read the settings, set the app up, listen
server/platform/       COPIED from emg-app-template. Never edited here.
server/app/            this app: index.js (catalogue, routes, setup), rules, store (memory and SQL), services
web/                   the UI: static ES modules, or a Vite project that builds to web/dist
web/platform/          COPIED from emg-app-template. Never edited here.
test/                  this app's tests (node --test, through HTTP). helpers.js has withServer, login, request
test/platform/         COPIED from emg-app-template. Never edited here.
docs/                  SPEC.md, API.md (the route contract), ARCHITECTURE.md
```

`server/app/index.js` is the only file the platform reads. It exports `catalog`, `routes`, an optional `setup()` and an optional `ui`.

## Do

- **Fix the template, not the copy.** If `server/platform/`, `web/platform/` or `test/platform/` needs a change, make it in `emg-app-template`, then copy the three folders back in and update the version line in each README. Never edit them in an app repo.
- Import platform code from `server/platform/kit.js` and nowhere else in `server/platform/`. `test/platform/boundaries.test.js` fails otherwise.
- In pages, import shared files by their `/platform/...` address, and call the API with `fetch` (through `api()`) only. XMLHttpRequest and axios bypass the wait screen.
- **Let database errors reach the platform.** Don't catch a failed query to reword it. The platform turns a paused database into the 503 the browser waits on. `setup()` is the one exception: if it cannot use its database it falls back to memory and returns `databaseConnected: false`.
- Make store and service functions async and await every call.
- Put every route in `docs/API.md` in the same change as the code. `test/contract.test.js` fails when they disagree.
- Put tests in `test/`. Test through HTTP (`test/helpers.js` `withServer`), never through store internals. Cover the deliberate gaps so nobody "fixes" them.
- Split a file when it mixes features or gets hard to follow, not to meet a line count. A split is its own commit, with no change in behaviour.
- Queries are parameterised, always. Schema and table names are fixed in code, never built from input.
- Slow outside work (sending mail, MYOB, a heavy export) belongs in a background job, never inside a request.
- Tell Joules, the portal's helper, what the app can do for a person: `assistant` in `server/app/index.js`, listed in `docs/API.md` under "What Joules can do here" (`docs/ARCHITECTURE.md`, 5.4). Each action runs as that person, so it applies the app's own rules; a write action has a preview and runs only after the person says yes in the portal. Keep what an action answers to what Joules needs, and never return a secret. He also stands in the corner of every page (template 1.5.0, `web/platform/assistant.js`): the platform adds him, so leave his frame alone and don't add one of your own (`docs/ARCHITECTURE.md`, 3.4 and 5.4). A page that shows a Joules of its own for a while (a guided tour he narrates) asks the corner one to step aside with `stepAside(true)` from `/platform/assistant.js`, and `stepAside(false)` when it ends (template 1.6.0), so two are never on screen at once.
- A new dependency needs a reason in the pull request description. The allowed set is `mssql`, and for a large UI: React, React Router, TanStack Query, Tailwind, Vite and Vitest. `playwright`, pinned to an exact version, is also allowed as a devDependency in the root `package.json` for the browser UI tests (`test/ui/`), and for nothing else (Mat, 28 Oct 2026).

## Don't

- Don't read another app's database. Cross-app data goes through a documented HTTP endpoint with a service token (see `docs/ARCHITECTURE.md`).
- Don't put permission strings in page source or in routes. The portal decides who may open the app; the app decides everything finer, from its own tables.
- Don't add a route without a sign-in (`auth: false`) unless Mat has approved it. List it under "Public routes" in `docs/API.md`.
- Don't write secrets, tokens or personal data into logs, docs, tests or error messages.
- Don't commit `dist/`, `node_modules/` or `.env`.
- Don't "fix" a deliberate gap. If a gap looks like a bug, ask.
