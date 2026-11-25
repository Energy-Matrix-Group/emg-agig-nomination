# web/platform

Template version: 1.8.2

This folder is copied from `emg-app-template`. **Do not edit it in an app repo.** Fix it in the template and copy it again, together with `server/platform/` and `test/platform/`.

The server serves this folder at `/platform/`. A page loads these files by that address:

| File | What it is |
| --- | --- |
| `app.css` | The one stylesheet a page links. It gathers the layers below. |
| `tokens.css` | The brand colours, and the semantic tokens that change with the light and dark themes. Use these variables; never hard-code a colour. |
| `base.css`, `chrome.css`, `signin.css`, `components.css`, `motion.css`, `soon.css`, `band.css` | The reset and controls, the app chrome (charcoal sidebar, page header, brand diamonds), the sign-in page, shared components, the loader and motion, and the coming-soon kit. |
| `api.js` | `api(path, { method, body })` returns `{ ok, status, data }`. A 401 with `signIn` sends the page to the portal. |
| `shell.js` | `requireUser()` and `mountChrome(user, { app, links, sub })`: the sidebar with the logo, the theme switch, the mobile menu, the app's links, **All applications**, the person and Sign out. It lifts the start-up splash. |
| `loader.js` | `loader({ label })`, the Energy Matrix loader for a loading state, and `bootDone()`, which lifts the start-up splash. |
| `mark.js`, `mark-tiles.js` | `logoMark({ mode })`: the mark drawn inline, assembling or blowing apart. `mark-tiles.js` is built by `scripts/make-mark.js` in the template. |
| `theme.js` | The light and dark themes: `currentTheme()`, `setTheme()`, `themeToggle()`. |
| `icons.js` | The app icons, keyed by app id, the interface icons (`uiIcon(name)`), and `initials(name)`. |
| `db-wake.js`, `db-wake.css` | The wait screen for a database that is starting. The server adds both to every page; a page never loads them itself. |
| `bell.js`, `bell-draw.js`, `bell-view.js`, `bell.css` | The bell (from 1.8.0): each person's notifications from the portal, first in the sidebar's tool row (`.app-nav__tools`). The server adds `bell.js` to every page, the portal's and every app's that has `PORTAL_URL` and `PORTAL_DIRECTORY_TOKEN` (1.8.2), as an `async` module (1.8.1) so it never holds back `DOMContentLoaded`, and it links `bell.css` itself, so a page does nothing to have it. It waits for the tool row, so a page with no sidebar has no bell, and puts itself back if a built UI draws the row again. It calls `/api/notifications` on its own server. `bell-view.js` is the panel's logic (tested in `test/platform/web/bell.test.js`) and `bell-draw.js` draws a tip and a row, which the portal's Admin Settings uses for its preview. |
| `assistant.js` | Joules, the portal's helper, in the corner of every page of an app (from 1.5.0). The server adds it to every page; a page never loads it itself. It puts the portal's own page for him (`/clip/frame/`) in a see-through frame cut to his shape, so the rest of the page is clicked as if he were not there, and takes the frame away when the portal says he should not be there. While he stands in the corner, `chrome.css` gives `.canvas` room at its end. From 1.8.1 his frame may save a file the person asked for (Download CSV on a table or chart he shows: `allow-downloads` in its sandbox). |
| `dev-banner.js` | The "no database" banner. Load it from a page with `<script type="module" src="/platform/dev-banner.js">`. |
| `logo/` | The logo, the favicon, and the animated loader (`loader.svg`, `loader-on-dark.svg`). |

`docs/STYLE-GUIDE.md` says how to use them.

Rules for pages:

- Import these files by their `/platform/...` address, never by a relative path.
- Call the API with `fetch` (through `api()`), never XMLHttpRequest or axios, or the wait screen cannot cover the call.
- **All applications** goes to `${portalUrl}/apps`. `shell.js` builds it from `portalUrl` in `/api/me`, so it is never a build-time constant.
