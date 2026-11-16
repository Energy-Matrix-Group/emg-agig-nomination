# test/platform

Template version: 1.6.5

The platform's own tests, copied from `emg-app-template` with `server/platform/` and `web/platform/`. **Do not edit them in an app repo.** They do not use the app's routes: they run against a small fixture app in `support/fixture-app.js`, with a fake portal in `support/fake-portal.js`.

| Test | What it proves |
| --- | --- |
| `handoff.test.js` | The sign-in flow: a good token, a tampered one, one for another app, an expired one, a replay, a bad `return`, the cookie flags, the absolute expiry, sign-out. |
| `token.test.js`, `keys.test.js` | The token and key code on their own. |
| `session-cookie.test.js` | The cookie value and its flags. |
| `config.test.js` | Every setting is checked and every problem is reported. |
| `service-token.test.js` | Bearer tokens and the limits on wrong guesses. |
| `assistant.test.js` | Joules's door: only a token the portal signed for one person, app and thing gets in; a read runs, a write previews first; input and answers are checked; never a sign-in. |
| `router.test.js`, `http.test.js` | Route checks, error answers, body limits. |
| `database-wake.test.js`, `database-wake-unit.test.js` | The 503 while a database starts, and the boot retry. |
| `static.test.js` | The UI is served safely, and every page gets the wait screen and Joules (the portal's pages do not). |
| `directory-client.test.js` | Portal user lookups and their cache. |
| `boundaries.test.js` | App code uses only `kit.js`; pages use `/platform/` and `fetch`. |
| `boot.test.js` | `server/index.js` starts, and refuses bad settings with a clear message. |
| `build-web.test.js` | `scripts/build-web.js` builds or tests a UI that has its own project, and says so when it does not. |
| `version.test.js` | Version bumps for the release workflow. |
| `web/db-wake.test.js` | The browser wait screen. |
| `web/assistant.test.js` | Joules's frame on an app's pages: its address, the shape it is cut to, whom it listens to, and when he stays away. |

App tests live one level up, in `test/`, and use `test/helpers.js` (`withServer`, `login`, `request`).
