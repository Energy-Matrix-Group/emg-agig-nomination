# Energy Matrix Group: design style guide

For the portal and every EMG app. Version 2.0, October 2026 (platform template 1.2.0).

**Look and feel:** the [How we build software](https://energy-matrix-group.github.io/HowWeBuildSoftware/) guide and the [electricity retail prototype](https://energy-matrix-group.github.io/ElectricityRetailDataMxProposal/electricity-retail-prototype.html): Montserrat, navy and coral, square geometry, the diamond mark, light and dark themes.
**Source of truth for print and brand:** `docs/design/EMG-Brand-Style-Guide-Issue1-May2025.pdf` in `emg-app-template`.
**The code:** `web/platform/` (served at `/platform/`). Pages link `/platform/app.css` and nothing else from the platform's styles.

Version 1 used a bright app blue (`#2462EA`), a near-black sidebar (`#020816`) and rounded corners. Version 2 replaces all three: actions are navy (coral in the dark theme), the sidebar is the brand's charcoal, and every corner is square. The old token names still work, with the new values.

---

## 1. Brand essence

Energy Matrix Group is Australia's gas trading, wholesale supply and energy advisory specialist. Screens should feel **established, commercial and precise**, and a little bit exciting: calm density, confident type, one coral accent that draws the eye.

| Principle | In practice |
| --- | --- |
| **Expert** | Clear hierarchy, data that is easy to scan |
| **Commercial** | Strong headlines, plain actions, outcomes over fluff |
| **Reliable** | The same tokens, patterns and motion in every app |
| **Australian** | AU spelling (organise, colour, licence), `en-AU` dates |

**Voice:** confident, plain, solutions-led. Short sentences. Say what a thing does.

---

## 2. The mark, the logo and the loader

The mark is a diamond of 29 tiles in five colours. The lockup adds the wordmark "ENERGY MATRIX GROUP".

| Asset | Use |
| --- | --- |
| `logo/logo.svg` | The lockup on light backgrounds |
| `logo/logo-on-dark.svg` | The lockup on the charcoal sidebar and dark panels: the wordmark and the darkest tiles are white |
| `logo/favicon.svg` | The mark alone: favicon, compact places |
| `logo/loader.svg`, `logo/loader-on-dark.svg` | **The loader** (below) |
| `mark.js` | The mark drawn inline, so it can animate with the page |

**Tile colours:** navy `#415A7E`, sky `#9DC0D7`, ice `#CCEBF7`, coral `#E47454`, and the darkest tile `#2E3541` (white on dark backgrounds, `--emg-logo-dark`). Never recolour the mark otherwise, stretch it or add a shadow.

### The loader: the mark blows apart and spins once

Every loading moment uses the Energy Matrix loader. One cycle takes 3.4 seconds and repeats:

1. The mark holds, then gathers itself (it shrinks a little).
2. **It blows apart**: each tile flies out along its own line, turning, with a coral diamond shockwave.
3. The tiles drift, then snap back together.
4. **The whole mark spins once.**
5. A light sweeps across it, and it starts again.

The motion lives inside the SVG (`logo/loader.svg`), so it works anywhere: as a CSS background, in an `<img>`, in a React app, and behind the database wait screen. `scripts/make-mark.js` in this template builds the two loader files and `mark-tiles.js` from `favicon.svg`; edit the script, not its output.

| Where | How |
| --- | --- |
| Anything loading in a page | `loader({ label: 'Loading tickets' })` from `/platform/loader.js`, or the markup `<div class="emg-loading" role="status"><span class="emg-loader" aria-hidden="true"></span><span>Loading tickets</span></div>` |
| Inline, next to words | `loader({ label, inline: true })`, or add `emg-loading--inline` |
| Just the mark | `<span class="emg-loader" aria-hidden="true"></span>`; size it with `--emg-loader-size` or `emg-loader--xs` / `--sm` / `--lg` |
| While a page starts | the start-up splash (below) |
| While a paused database wakes | the wait screen does it for you (`db-wake.js`) |

`--emg-loader` picks the light or dark drawing for the theme. With "reduce motion" set, the loader is the still mark, breathing.

### The start-up splash

Put this first in `<body>`. It covers the empty page with the loader until the sidebar is drawn:

```html
<div class="emg-boot" data-boot aria-hidden="true">
  <span class="emg-loader" aria-hidden="true"></span>
  <span class="emg-boot__label">Energy Matrix</span>
</div>
```

`mountChrome()` lifts it, so most pages need nothing else. A page that never calls `mountChrome()` calls `bootDone()` from `/platform/loader.js`. The first page in a tab keeps it for about a second, long enough to see the mark blow apart; later pages lift it as soon as they are ready. If nothing lifts it, it lifts itself after 12 seconds.

---

## 3. Colour

### 3.1 The palette

| Name | Hex | Role |
| --- | --- | --- |
| Navy | `#415A7E` | Headings, primary actions, the brand's main blue |
| Coral | `#E47454` (`#E06C4B` as an accent on white, `#B5492A` for coral text) | The one accent: eyebrows, highlights, active markers |
| Charcoal | `#2B3340` | The sidebar, dark bands, body text |
| Sky | `#9DC0D7` | Supporting blue, illustration |
| Ice | `#CCEBF7` | Lightest blue, selection |
| Feature blue | `#5A8DB6` | A third card tone, information |

### 3.2 Semantic tokens: use these

Each has a light and a dark value, so a style written with them is right in both themes.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--emg-bg` | `#FFFFFF` | `#161B22` | Page background |
| `--emg-bg-alt` | `#F7FAFC` | `#1A2029` | Alternate bands, quiet rows |
| `--emg-panel` | `#FFFFFF` | `#222A35` | Cards and panels |
| `--emg-raised` | `#F4F7FA` | `#262E3A` | Table headers, card footers, hover |
| `--emg-text` | `#2B3340` | `#E8EEF5` | Body text |
| `--emg-heading` | `#415A7E` | `#F4F7FB` | Headings |
| `--emg-text-muted` | `#566275` | `#A9B5C6` | Secondary text (meets 4.5:1) |
| `--emg-text-faint` | `#8793A5` | `#7C889A` | Hints, placeholders (large or non-essential text only) |
| `--emg-line`, `--emg-line-strong` | `#E2E8F0`, `#CBD5E0` | `#2C3542`, `#3A4655` | Dividers, borders |
| `--emg-accent`, `--emg-accent-ink`, `--emg-accent-soft` | coral | coral | Accent fill, coral text, coral tint |
| `--emg-primary`, `--emg-primary-hover`, `--emg-on-primary` | navy, charcoal, white | coral, light coral, `#161B22` | Solid buttons |
| `--emg-link` | `#415A7E` | `#A3BBE0` | Links |
| `--emg-focus` | `#1F6FD1` | `#7DB4FF` | Focus rings |
| `--emg-good`, `--emg-warn`, `--emg-bad`, `--emg-info-ink` (+ `-bg`) | | | Status text and its tint |
| `--emg-tone-navy`, `-coral`, `-blue`, `-ink` (+ `-ink`) | | | Card border tones and the text that goes with them |
| `--emg-nav-*` | charcoal | `#1F252E` | The sidebar |
| `--emg-shadow`, `--emg-shadow-sm` | | | The only two shadows |

The older names (`--emg-app-primary`, `--emg-app-sidebar`, `--emg-white`, `--emg-muted`, `--emg-border`, `--emg-radius-*` ...) still exist with one value in both themes. **Do not use them in new work**: they do not follow the dark theme.

Never write a hex value in an app's styles. If a colour is missing, add a token in the template.

### 3.3 Themes

The page follows the system's light or dark setting. A person can switch with the sun and moon button in the sidebar; the choice is kept in this browser (`localStorage` `emg-theme`) and the platform layer applies it before the first paint. A page can force a theme with `<html data-theme="light|dark">` (Ticketing does, from each person's own setting). Inside an `.emg-band` the tokens are dark whatever the theme. Printing always uses the light colours, so paper is never dark. Tick boxes and radio buttons take `--emg-primary`, so they follow the theme too.

### 3.4 Chart colours

A chart takes its colours from these tokens, never from hex values. Each has a light and a dark value, and printing uses the light ones.

| Tokens | Use |
| --- | --- |
| `--emg-series-1` to `--emg-series-8` | One colour per series (a market, a state, a facility). Assign them in order, 1 first, and never cycle: a ninth series goes into "Other". A series keeps its colour when a filter hides the others. |
| `--emg-fuel-coal`, `-brown-coal`, `-gas`, `-distillate`, `-bioenergy`, `-hydro`, `-solar-rooftop`, `-solar-utility`, `-wind`, `-battery`, `-battery-charging`, `-imports`, `-exports` | Electricity generation by fuel, in the colours the energy industry expects: coal black, wind green, solar yellow and orange, hydro blue. |
| `--emg-chart-price` | The price area drawn behind other lines. |
| `--emg-gridline`, `--emg-line-strong`, `--emg-text-muted` | Gridlines, the zero line and axis labels. |

The series colours are a palette checked for colour-blind readers. In both themes, neighbouring series stay apart under protanopia and deuteranopia (OKLab ΔE ×100 ≥ 8), and readers with full colour vision can tell them apart (≥ 15). The fuel colours keep neighbours in their stacking order (exports, coal, gas, distillate, bioenergy, hydro, rooftop solar, utility solar, wind, battery, imports) ≥ 15 apart for full colour vision and ≥ 6 apart under colour-blindness. Coal, gas and exports are neutral greys by convention.

Some of these colours fall below 3:1 against the panel, and some fuel neighbours are only ≥ 6 apart for colour-blind readers. So a chart never relies on colour alone:

- a legend whenever there are two or more series;
- a tooltip on hover that names each series;
- a 2px gap in the panel colour between stacked areas.

Text stays in the text tokens, never in a series colour.

---

## 4. Type

**Montserrat**, weights 400, 500, 600, 700 and 800, for everything on screen. Century Gothic is for printed documents only.

| Role | Size | Weight | Notes |
| --- | --- | --- | --- |
| Hero headline | `clamp(2.1rem, 4.2vw, 3.6rem)` | 700 | `letter-spacing: -0.03em`; one phrase in coral (`.emg-hl`) |
| Page title (`h1`) | `clamp(1.75rem, 2.6vw, 2.35rem)` | 700 | Sentence case, navy |
| Section (`h2`, `.section-label`) | 1 to 1.1rem | 700 | A coral diamond before a panel heading |
| Body | 15px | 400 | Line height 1.6 |
| Eyebrow (`.emg-eyebrow`) | 0.72rem | 700 | Uppercase, `0.14em` tracking, coral, a 30px coral dash after |
| Table header, badges, counts | 0.66 to 0.74rem | 700 | Uppercase, tracked |

Titles are **sentence case** now, not all capitals. Small labels are uppercase and tracked.

---

## 5. Shape and layout

- **Square corners everywhere** (`--emg-radius-*` are 0). The only round thing is a `--emg-radius-pill` control, and there should be few.
- **The diamond** is the brand's motif: a 45° square marks a heading, a badge, a step number, an active stage. Draw it with `transform: rotate(45deg)` on a small square, or with `clip-path`.
- **Borders over shadows.** Cards are 1.5px `--emg-line-strong`; app cards are 2px in a tone. Shadows only on hover and on floating things.
- **The coral bar:** a 44 x 3px coral bar on the top-left edge of a panel or figure (`.panel`, `.emg-kpi` have it).
- **The shell:** a 264px charcoal sidebar and a fluid canvas, at most 1280px wide. Below 900px the sidebar becomes a top bar with a menu button that opens it as a drawer.
- **The background diamonds:** every `.app-main` has a large pale diamond off its top-right corner and a small coral one, drawn by the platform. Nothing to add.
- **Spacing rhythm:** 4, 8, 12, 16, 24, 32, 48px. Generous space between header, filters and tables.

---

## 6. Components

All of these come with `/platform/app.css`. Platform classes added in version 2 start with `emg-` so they never clash with an app's own.

| What | Markup |
| --- | --- |
| Solid button | a plain `<button>`: navy, square, 44px high, sentence case |
| Quiet button | `<button class="button-quiet">` |
| A link that looks like a button | `<a class="emg-btn">`, with `emg-btn--line` (coral outline), `emg-btn--quiet`, `emg-btn--sm` |
| Arrow in a button | `uiIcon('arrow')` with class `emg-arrow`; it nudges right on hover |
| Eyebrow | `<p class="emg-eyebrow">Overview</p>` above a title |
| Highlight | `<span class="emg-hl">one place</span>` inside a headline |
| Page header | `.page-head` with `.page-icon` (the icon in a coral diamond), an `h1` and `.lede` |
| Panel | `.panel` with an `h2.section-label` |
| Section heading row | `.emg-section-head` with a heading and an `.emg-count` |
| Card with header | `.emg-card` with `header`, `.emg-card__body`, `footer` |
| App card | `a.choice` with `.choice__icon`, `h2`, `p` and `.choice__go`; tones cycle navy, coral, blue, ink |
| Badge | `.emg-badge` with `--navy`, `--coral`, `--good`, `--warn`, `--bad`, `--info` (`.pill` and `.tag` look the same) |
| Figures | `.emg-kpis` of `.emg-kpi` with `__label`, `__value`, `__note` |
| Message | `.message` (error) or `.message.ok`; `.emg-callout` with `--good`, `--info`, `--warn`, `--note` |
| Empty state | `.emg-empty` with a `strong` line and a sentence |
| Person | `.person` with a square `.avatar` |
| Table | a plain `table` inside `.table-wrap` |
| Column of blocks | `.emg-stack` |

### The coming-soon kit (`soon.css`, `band.css`)

| What | Markup |
| --- | --- |
| Hero | `.emg-hero`: words on the left, `.emg-hero__art` with `logoMark({ mode: 'assemble' })` on the right, up to four `.emg-hero__tag` labels (`--tl`, `--tr`, `--br`, `--bl`) |
| Stage track | `ol.emg-stage` of `li` (`is-done`, `is-now`), each with a `strong` name: Scoping, Design, Build, Launch |
| Roadmap | `ol.emg-roadmap` of `li > a.emg-step` with `h3`, `p` and a badge; numbers and diamonds are automatic |
| Blueprint | `.emg-blueprint`: a planned screen drawn as a wireframe, stamped "In design" |
| Dark band | `.emg-band` with `.emg-band__head`; inside it, `.soon-cards` of `.soon-card` (the portal's "On the way") |

---

## 7. Motion

Short and purposeful. Hover changes take 160 to 250ms. Entrances use `.emg-rise` (with `--rise-delay` to stagger). The mark is the one big moment: it assembles on the sign-in page and in heroes (`mark.js`), blows apart when pointed at or pressed, and is the loader everywhere else.

Everything stops for people who ask for less motion (`prefers-reduced-motion`): the loader is the still mark, breathing, and nothing slides.

---

## 8. The platform's scripts

| File | What it gives a page |
| --- | --- |
| `shell.js` | `requireUser()`, `mountChrome(user, { app, links, sub })`: the sidebar with the logo, the theme switch, the mobile menu, "All applications", the app's links (`{ heading }` starts a group, `badge` adds a tag), the person and Sign out. It lifts the start-up splash. |
| `loader.js` | `loader({ label, inline })` and `bootDone()` |
| `mark.js` | `logoMark({ mode: 'static' | 'assemble' | 'loader', label })` |
| `theme.js` | `currentTheme()`, `setTheme()`, `themeToggle()` |
| `icons.js` | `appIcon(id)` for apps (and the interface icons by name), `uiIcon(name)`: sun, moon, menu, close, arrow, check, spark, bolt, planned, overview; `initials(name)` |

A built UI (Ticketing) draws the same markup with the same classes and uses the same tokens through `@theme inline`.

---

## 9. Accessibility

- Text meets WCAG AA: 4.5:1 for body text, 3:1 for large text. `--emg-text-faint` is for hints only.
- Focus is always visible: a 3px `--emg-focus` outline. Never `outline: none` without a replacement.
- Touch targets are at least 44 x 44px (40px in the dense sidebar).
- Colour never carries meaning alone: badges and stages have words.
- Decoration (the mark, the diamonds, the hero labels) is hidden from screen readers. Loading states say what is loading (`role="status"`).

---

## 10. Do and don't

**Do**

- Use the semantic tokens, so the dark theme works.
- Put one coral highlight in a headline, and coral on the one thing that matters on a screen.
- Use the loader for every wait.
- Keep corners square and borders crisp.

**Don't**

- Bring back the bright app blue, the near-black sidebar or rounded cards.
- Write hex values, or use the old fixed tokens in new work.
- Use more than one accent colour on a screen.
- Add a second display font, or animate anything that is not the mark without a reason.
