# Contributing

## The `test` branch

`test` is the shared integration and staging branch. Work lands there first so it can be checked before it goes to `main`.

Treat `test` as shared. Don't commit to it directly. All changes go in through pull requests.

## Workflow

1. Update your local copy:

   ```powershell
   git fetch origin
   git checkout test
   git pull origin test
   ```

2. Create a branch off `test`. Use `feature/<short-description>` for new work and `fix/<short-description>` for bug fixes:

   ```powershell
   git checkout -b feature/<short-description>
   ```

3. Make small, focused commits with clear messages. Run the checks before you push:

   ```powershell
   npm test           # every test that needs no browser, a Vite UI's own too
   npm run test:ui    # the browser tests, where the app has them
   npm run build      # when the UI is a Vite project
   npm run test:sql   # also run the SQL tests when you have a .env
   ```

   The Tests workflow runs all of these on every pull request.

4. Push your branch:

   ```powershell
   git push -u origin feature/<short-description>
   ```

5. Open a pull request into `test`, not `main`. Say what changed, why, and how to verify it. Link the related issue if there is one. If a dependency was added, say why.
6. Once it's merged, check it on the test environment. Only after it's verified there does Mat Harvey open a separate pull request from `test` to `main`.

## Rules

- Never force-push to `test` or `main`. Don't rewrite history on a branch someone else is using.
- Keep your branch current by merging `test` into it (`git merge origin/test`). Resolve conflicts on your branch, not on `test`.
- If you change an endpoint that another app or the portal calls, link the pull request in the other repo and merge them close together so `test` is not left broken. Update `docs/API.md` in the same change.
- Don't edit `server/platform/`, `web/platform/` or `test/platform/` in an app repo. Fix `emg-app-template` and copy the folders back in.
- Don't commit secrets, `.env` files or credentials. Use environment variables; `.env.example` holds names only.
- If CI fails on `test` after your merge, fix it straight away or revert your pull request. Don't leave `test` red.
- Don't merge unrelated work into your pull request.
- Only Mat Harvey promotes `test` to `main`, and only after the change has been checked on the test environment. AI agents never push to `main`, merge into it, or open a pull request whose base is `main`. Every push to `main` bumps `VERSION` and tags a release (see `docs/VERSIONING.md`).
