# Don't Be Michael: Design System

This is the single design spec for everything that carries the Don't Be Michael name:
the desktop app (this repo) and the marketing site, dontbemichael.com
(`agentvivekkumar/dontbemichael_website`). It is canonical. It lives in `branding/`
with every logo, icon, color file and font, so the folder can be handed to anyone,
with or without the code. The repo-root `DESIGN.md` and the site's `DESIGN.md` only
point here.

**How to use it**

1. Every rule is tagged with the surface it binds: **[Both]**, **[App]** or **[Web]**.
   An untagged rule inside a tagged chapter inherits the chapter's tag.
2. Change the spec first, then the code. A design change that lands in code without
   a matching edit here is drift, and drift is a bug.
3. Where the code and this doc disagree and nobody has decided which is right, the
   gap goes in the §17 register instead of being quietly "fixed" in either direction.
4. Tokens are the contract. If a value you need is not a token, add the token here
   and in the token files (§14). Do not paste a hex value into a component.

Last full audit against code: 2026-09-24 (app `main` @ `82ae65fb`, site `main` @ `7f404a7`).

---

## 1. Brand [Both]

### 1.1 The idea

Michael is the boss who kept every job on his own desk and called it leadership.
Don't Be Michael is the office he should have run: a team of AI agents that does the
work, while the owner signs off on it. Every design decision should reinforce one of
two things. Either **the work is delegated**, or **you stay in control by approving it**.

### 1.2 One family, two volumes

The app and the site are one brand at two volumes.

| | App | Web |
|---|---|---|
| Job | A workspace people sit in all day | A page that has to earn attention in seconds |
| Volume | Calm: muted accents, readable UI type, hairline structure | Loud: full-saturation accents, pixel display type, chunky frames |
| Shared | Ink and cream neutrals, the logo, the six accent hues, the hard shadow, the 4 px grid, the voice |

The two accent sets map one to one (§3.3). A hue never changes meaning between
surfaces. Coral means "Michael, stop, needs you" on both, and mint means "done, good".

### 1.3 The mark: Struck M

A pixel capital M with a coral slash through it. Read it as "don't be M".

**Construction.** 16 × 16 cell grid. Origin top-left, `x` right, `y` down.

- Stems: columns 2, 3, 12 and 13, rows 3 to 13.
- Diagonals, each two cells thick: (4,3) (4,4) (5,4) (5,5) (6,5) (6,6) (7,6) (7,7),
  mirrored across x = 7.5 for the right side.
- Slash: every cell with `x + y ∈ {15, 16}` for `1 ≤ x ≤ 14`. It is drawn over the M.
  There is no knockout gap. A 1 px gap was tried and rejected because it erases the
  right diagonal, so the mark reads as an N.

**Colors.** The mark does not follow the theme. Its colors are fixed.

| Use | M | Slash | Ground |
|---|---|---|---|
| On light | `#1A1320` (ink-900) | `#FF6B6B` (web coral) | transparent or `#FFFDF5` |
| On dark | `#FFFDF5` (cream-50) | `#FF6B6B` | transparent or `#1A1320` |

The slash is always the web coral `#FF6B6B`, including inside the app. The mark is a
logo, not UI, so it does not recalibrate with the calm palette.

**Size and space**

- Render only at integer multiples of 16 px (16, 32, 48, 64 and up), or as SVG with
  `shape-rendering: crispEdges`. Never blur, anti-alias or resample it at a fraction.
- Minimum size is 16 px. At 16 px each cell is one device pixel, which is the floor.
- Clear space is 2 cells (1/8 of the mark's width) on every side.
- Beside the wordmark, the mark is as tall as the cap height of the wordmark, rounded
  down to an integer size. Gap is 10 px (8 px below 480 px viewport).

**Don't**

- Don't rotate, outline, add a shadow to, or recolor the mark.
- Don't redraw the slash as a smooth line. It is pixels.
- Don't put the mark on coral or on a busy image.
- Don't use a character portrait, a necktie or a stamp as the brand mark. Those were
  explored and rejected on 2026-09-24.

**Files.** Every file is generated from one grid definition by
`branding/source/build.py`, so they cannot drift. Hand people the `branding/` folder.

| File | Where | Use |
|---|---|---|
| `logo/mark/struck-m-{light,dark,on-cream,on-ink}.svg` and `png/` 16 to 1024 | `branding/` | The mark on its own |
| `logo/lockup/dbm-lockup-{horizontal,stacked}-{light,dark}.svg` and `png/` | `branding/` | Mark plus wordmark, text outlined so no font is needed |
| `app-icon/icon.{svg,icns,ico}`, `icon-{128..1024}.png` | `branding/` | App icon per §1.5 |
| `social/og-card-1200x630.png` | `branding/` | Link previews |
| `logo.svg` | site `public/assets/` | Mark, transparent ground |
| `favicon.svg` | site `public/` | Mark on `#FFFDF5` |
| `favicon.ico` (16, 32, 48) | site `public/` | Browsers that request `/favicon.ico` |
| `favicon-32.png` | site `public/assets/` | PNG favicon |
| `apple-touch-icon.png` (180) | site `public/assets/` | iOS home screen |
| `build/icon.*` | app | **Not yet migrated.** Copy from `branding/app-icon/`. See §17. |

### 1.4 Wordmark

`DON'T BE MICHAEL`, set in VT323, all caps, with `MICHAEL` in coral. Letter-spacing
`.06em`. It sits to the right of the mark. On the web it is the nav logo. In the app it
appears only where the brand is announced (About, onboarding welcome, update notes),
never in working chrome.

### 1.5 App icon [App]

The app icon is the Struck M on a tile. It replaced the old portrait icon on 2026-09-25;
`build/icon.*` are copies of `branding/app-icon/`.

- Canvas 1024 × 1024. Tile inset 100 px on each side (824 × 824), macOS continuous
  corner radius 185 px. The tile is the one place a radius is allowed, because the OS
  expects it.
- Tile fill `#FFFDF5`, 2 px inner line `#1A1320` at 12% opacity.
- Mark at 512 × 512 (32 px per cell), centered.
- Windows `.ico` and Linux PNGs use the square tile with no radius.

### 1.6 Name, parody and legal lines

- The product name is **Don't Be Michael**. Always with the apostrophe.
- Michael is an archetype of the boss who won't delegate. Copy can nod to office
  comedy, but never uses NBC or *The Office* logos, title typography, cast likenesses
  or photos.

---

## 2. Principles [Both]

1. **Pixel-snapped.** Integer coordinates, integer scales. No half pixels, no CSS blur,
   no glassmorphism.
2. **Structure through contrast, not chrome.** App panels separate by surface tone and
   a single hairline. The web gets heavier frames because it is louder, but the
   separating job is the same.
3. **Limited palette.** One screen uses at most 8 colors. A sprite uses at most 5.
4. **Motion carries information, or it does not happen.** An avatar walking *is* the
   status. UI chrome stays still.
5. **Friendly, never cute for its own sake.** Short and human copy. Dry beats cute.
6. **Everything has a home.** Named panels, framed groups, status windows, the way a
   90s game manual lays out information.

**Not:** Material, iOS, glassmorphism, gradients as decoration, "retro filter on a
normal app", pixel art that serves no function.

---

## 3. Color

### 3.1 Neutrals [Both]

The neutrals are identical on both surfaces in light mode.

| Token | Light | Dark [App] | Use |
|---|---|---|---|
| `cream-50` | `#FFFDF5` | `#17171B` | App ground (dark), innermost dialog fill |
| `cream-100` | `#FFF8E7` | `#1D1D22` | Default panel fill |
| `cream-200` | `#F4E9C7` | `#26262C` | Inset, alt row, web nav bar |
| `cream-300` | `#E8D9A0` | `#313139` | Disabled fill |
| `paper-100` | `#FCFAF0` | `#1A1A1F` | Cards, inputs, terminals |
| `paper-200` | `#F0EAD2` | `#222229` | Subtle panel variant, web page ground |
| `ink-900` | `#1A1320` | `#DEDBD6` | Body text, outer lines. **Never `#000` or `#FFF`.** |
| `ink-700` | `#3D2E4A` | `#B3B0AC` | Secondary text |
| `ink-500` | `#6B5878` | `#96919F` | Tertiary text, hints, dialog border |
| `ink-300` | `#A899B5` | `#787684` | Structural borders. Target 3:1 against its surface. Dark measures 3.1 to 4.0:1. Light measures 2.2 to 2.6:1 (§17). |
| `ink-100` | `#D9CFE0` | `#3E3D46` | Dividers that should recede |
| `on-accent` | `#1A1320` | `#1A1320` | Text on an accent fill. Dark in both themes on purpose. |

### 3.2 Why the accents differ by surface

The original arcade accents are full-saturation. In a dense working UI they read as
noise, so the app recalibrated them in v0.3.4 to the same hues at a calmer saturation.
The web keeps the arcade set because a marketing page has the opposite problem: it
needs to be noticed.

### 3.3 Accent map

| Hue | Meaning | App light | App light `-light` | App dark | App dark `-light` | Web | Web `-light` |
|---|---|---|---|---|---|---|---|
| coral | Stop, needs you, Michael | `#D96A62` | `#F3D3CD` | `#E08C82` | `#3B2724` | `#FF6B6B` | `#FFB4B4` |
| mint | Done, good, go | `#5CA97A` | `#D2E7DA` | `#74C096` | `#1E3227` | `#6BCF7F` | `#B4E5BD` |
| sky | Thinking, info | `#4F9FAF` | `#CFE5E9` | `#6FB3C4` | `#1F3238` | `#4ECDC4` | `#A8E6E0` |
| lemon | Working, highlight | `#DCAB3C` | `#F3E4BC` | `#CFAA57` | `#332C1D` | `#FFD93D` | `#FFEC99` |
| lilac | Web, MCP, compacting | `#9482D3` | `#E0DAF2` | `#A896E3` | `#2B2740` | `#B197FC` | `#D6C5FF` |
| peach | Warm highlight, tabs | `#D99168` | `#F3DACA` | `#DFA57F` | `#352822` | `#FFA07A` | `#FFD0B5` |

Rules:

- A new accent must be added to all six columns at once, or not at all.
- Never use a web accent in the app, or an app accent on the web. The one exception is
  the logo's slash (§1.3).
- Text on any accent fill uses `on-accent`.

### 3.4 Status [App]

Status colors are the app's semantic layer. Labels read from the user's side of the
screen, not the token name.

| Token | Light | Dark | Label | Means |
|---|---|---|---|---|
| `status-idle` | `#A199AB` | `#6F6C77` | idle | At desk, awaiting |
| `status-thinking` | `#4F9FAF` | `#64ACBB` | thinking | Reasoning, en route to a station |
| `status-working` | `#DCAB3C` | `#D8B052` | working | At a station, using a tool |
| `status-waiting` | `#6D87D6` | `#8095DC` | waiting | Stalled on the boss agent or another agent |
| `status-blocked` | `#D96A62` | `#DF8078` | needs you | Needs the user |
| `status-success` | `#5CA97A` | `#6FB88B` | done | Just finished |
| `status-ghost` | `#D9D3DE` | `#6C6A76` | closing | Pane closed, fading out |
| `status-compacting` | `#8F7CC7` | `#9D8BD2` | compacting | Boxing up context |
| `status-looping` | `#D6903F` | `#D69A55` | looping | Circuit breaker armed |
| `status-typing` | `#C89838` | `#CBA24A` | your draft | **Not an agent state.** The user has unsent text on that agent's prompt, which holds its message queue. See [`docs/message-queue.md`](../../docs/message-queue.md). |

Status is always shown by color **and** a label or icon **and** position. Never by
color alone.

### 3.5 World [App]

The office floor. Theme-independent.

| Token | Hex | Use |
|---|---|---|
| `grass-light` | `#D4EAB0` | Light tile |
| `grass-dark` | `#B5D589` | Dark tile, checkerboard |
| `wood-light` | `#E5C896` | Room floor light tile |
| `wood-dark` | `#C9A66B` | Room floor dark tile |
| `path` | `#E8D8B0` | Pathways between rooms |
| `wall` | `#8B6F47` | Room walls, 3 px stroke |

### 3.6 Gradients [Both]

None. Every surface is flat.

---

## 4. Typography

### 4.1 Faces

| Role | App | Web | Why they differ |
|---|---|---|---|
| Brand label | Press Start 2P, small caps labels only | VT323 | Press Start 2P is too loud and too wide at web display sizes |
| Display / headings | Press Start 2P (8, 12, 16 px) | VT323 (h1), Pixelify Sans (h2, h3) | The web needs large, characterful display type |
| Reading text | Inter | Inter | Shared. Pixel faces were the app's main readability drag |
| Code / terminal | JetBrains Mono | not used | The site shows no code |

- **[App]** Fonts are bundled (`src/renderer/src/design/fonts.css`, `assets/fonts/*.woff2`),
  never loaded from a CDN. Press Start 2P is Latin-only. CJK and Arabic fall through to
  the system faces listed in the `--cth-font-*` stacks.
- **[Web]** Fonts load from Google Fonts: VT323, Pixelify Sans (400 to 700), Inter (400, 500).
- **[Both]** Every text element declares a family from its surface's set. No bare
  `system-ui` as a display face.

### 4.2 App scale [App]

| Token | Size / line height | Face | Use |
|---|---|---|---|
| `display-lg` | 16 / 24 | Press Start 2P | Screen titles |
| `display-md` | 12 / 20 | Press Start 2P | Section headers, modal titles |
| `display-sm` | 8 / 12 | Press Start 2P | Badges, chip labels |
| `body-lg` | 16 / 24 | Inter | Primary reading text |
| `body-md` | 14 / 20 | Inter | Default UI text |
| `body-sm` | 13 / 18 | Inter | Secondary text, captions |
| `mono-md` | 14 / 20 | JetBrains Mono | Terminal stream |
| `mono-sm` | 13 / 20 | JetBrains Mono | Inline log lines, paths |

- Floor: 13 px for any text a user reads. 11 px tooltips are debt (§17).
- Inter and JetBrains Mono may use weights 400 to 700. Press Start 2P is single-weight
  and is never faux-bolded.
- Case: Press Start 2P in Title Case. UI text in sentence case. Status labels lowercase.
- Letter-spacing: 0 for everything in the app.

### 4.3 Web scale [Web]

| Role | Face | Size (desktop / ≤ 980 px) | Line height | Tracking | Case |
|---|---|---|---|---|---|
| h1 | VT323 | 62 / 40 | 1.04 | 0 | Sentence |
| h2 | Pixelify Sans 400 | 37 / 27 | 1.12 | 0 | Sentence |
| h3 | Pixelify Sans 400 | 21 | inherit | 0 | Sentence |
| Body | Inter 400 | 17 | 1.6 | 0 | Sentence |
| Lede | Inter 400 | 19 | 1.6 | 0 | Sentence |
| Label: nav, button, chip, tab | VT323 | 21 (19 on phones) | 1 | `.06em` | ALL CAPS |
| Eyebrow (`.sechead`) | VT323 | 20 | inherit | `.12em` | ALL CAPS |
| Wordmark | VT323 | 28 (22 on phones) | 1 | `.06em` | ALL CAPS |

- Allowed tracking values on the web: `0`, `.06em`, `.12em`. Nothing else. Existing
  strays are listed in §17.
- Pixel faces never go bold on the web. `h1` to `h4` are weight 400.
- Measure: body copy 62 to 70 ch. Lede 50 ch.

---

## 5. Spacing and layout

### 5.1 Grid [Both]

Base unit **4 px**. Margins, padding, gaps and positions are multiples of 4.

| Token | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| `space-*` | 0 | 4 | 8 | 12 | 16 | 24 | 32 | 48 | 64 |

Pixel snapping: `translate` values are integers, `image-rendering: pixelated` on every
canvas and sprite image, and zoom is 1×, 2× or 3×, never 1.5×.

### 5.2 App layout [App]

- Minimum window 1280 × 800. Standard gutter 16 px. Panel padding 12 px.
- Floor canvas tile grid: 32 × 32 px.

```
┌──────────────────────── Title bar ────────────────────────────┐
├───────────────────────────────────────┬───────────────────────┤
│  Floor canvas (Pixi), fills width      │  Selected agent panel │
│                                        │  360 px: portrait,    │
│                                        │  terminal, command    │
│                                        │  bar, status          │
├───────────────────────────────────────┴───────────────────────┤
│  Agent strip: horizontal scroll of AgentCards, 80 px tall      │
└────────────────────────────────────────────────────────────────┘
```

Below 1024 px wide, the right panel collapses to a bottom drawer.

| z | Layer |
|---|---|
| 0 | Floor canvas |
| 1 | UI chrome |
| 2 | Drawer, sidebar |
| 3 | Toasts |
| 4 | Modals |
| 5 | Tooltips |

### 5.3 Web layout [Web]

- Content max width 1160 px, side padding 24 px.
- Sections: 62 px vertical padding (46 px at ≤ 980 px), 3 px `ink-900` rule between them.
- Breakpoints:

| Width | What changes |
|---|---|
| ≤ 1040 px | Nav switches to two rows (§8.1). Anchor offset becomes 112 px. |
| ≤ 980 px | Type steps down (§4.3). Section padding 46 px. |
| ≤ 480 px | Wordmark 22 px, mark 24 px, nav button 19 px. |
| ≤ 360 px | Wordmark 20 px, nav gap 8 px, nav button padding 8 px 10 px, so the bar with `DOWNLOAD` fits at 320 px. |

- No horizontal page scroll at any width from 320 px up. This is a release check.

---

## 6. Surfaces, borders and shadow

### 6.1 App panels [App]

Single 1 px inset hairlines. Structure comes from surface contrast.

| Variant | Border | Fill | Use |
|---|---|---|---|
| `default` | `inset 0 0 0 1px ink-300` | `cream-100` | Standard panel |
| `inset` | `inset 0 0 0 1px ink-100` | `cream-200` | Recessed area |
| `terminal` | `inset 0 0 0 1px ink-300` | `paper-100` | Terminal |
| `dialog` | `inset 0 0 0 1px ink-500` | `cream-50` | Modals, notifications |
| `active` | 1 px `ink-900`, 3 px accent, 5 px ring | `cream-100` | Selected agent, focused input. The only three-layer border left. |

### 6.2 Web frames [Web]

The web keeps the chunky frame, because volume is the point.

- `.panel` and `.file`: three-layer inset (2 px `ink-900`, 2 px `cream-200`, 1 px
  `ink-700`) plus the hard shadow.
- Buttons, chips, tabs: 2 px `ink-900` border.
- Nav: 4 px `ink-900` bottom border. Section rules are 3 px.

### 6.3 Hard shadow [Both]

The only shadow. Offset, no blur.

| Surface | Value |
|---|---|
| App light | `3px 3px 0 rgba(26,19,32,.14)` |
| App dark | `4px 4px 0 rgba(0,0,0,.45)` |
| Web | `4px 4px 0 rgba(26,19,32,.25)` |

### 6.4 Radius [Both]

0 everywhere. The one exception is the app icon tile (§1.5), and circles that are
genuinely round things (a status dot, an avatar ring). Existing 2 px radii are debt (§17).

---

## 7. App components [App]

All live in `src/renderer/src/components/`. States not listed are "no change".

### 7.1 `PixelPanel`

Variants per §6.1. `title?` renders a title bar. `accent?` tints the active ring.
Panels do not hover. Focused: the active variant with the accent.

### 7.2 `PixelButton`

| Variant | Fill | Hover fill | Text | Border |
|---|---|---|---|---|
| primary | `ink-900` | `ink-700` | `cream-50` | `ink-900` |
| secondary | `cream-100` | `cream-200` | `ink-900` | `ink-300` |
| ghost | transparent | `cream-200` | `ink-700` | `ink-300` |
| destructive | `coral` | `coral-light` | `on-accent` | `ink-500` |

Sizes: sm 24, md 32, lg 40 px tall. Disabled (every variant): `cream-300` fill and
`ink-500` text. `ink-500` is the one text color that stays readable on `cream-300` in
both themes. Focus: see §12.
Hover and press must also respond to keyboard (`:focus-visible`, Space, Enter).
Today they are mouse-only (§17).

The sections from 7.3 to 7.7 carry over from the previous spec. The component files
exist, but their sizes were not re-measured in the 2026-09-24 audit. Verify against the
component before relying on a pixel value.

### 7.3 `PixelBadge`

Status per §3.4. An 8 px dot, 4 px gap, lowercase label at `body-sm`. Background is
the status color at 20% over `cream-100`.

### 7.4 `AgentCard` and `AgentStrip`

Card: portrait, name at `body-md`, status badge. Second row: current project at
`body-sm` `ink-500`, and the current tool. Selected: `PixelPanel` active with the
agent's accent. The strip scrolls horizontally and is 80 px tall.

### 7.5 `CommandBar` and `MessageQueueComposer`

Inset panel. Prompt prefix `> ` in the agent's accent at `mono-md`. Text input with no
border. Send is a primary md button. Busy: the border tints `lemon`. Blocked: the border
tints `coral`, with helper text.

### 7.6 Terminal (`PtyTerminalView`)

Terminal panel variant, JetBrains Mono at `mono-md`. The xterm palette follows the
theme and is defined in `PtyTerminalView.tsx`. Do not restate it here. The rule is:
background `paper-100`, foreground `ink-900`, cursor `coral`, selection `lemon-light`,
and ANSI colors mapped to the accent set of the active theme.

### 7.7 Toast, modal, drawer

- Toast: dialog panel, 320 px wide, a 12 px stripe of the agent's accent at the top,
  at most two actions, hard shadow. Non-blocking toasts auto-dismiss. Blocking ones wait.
- Modal: dialog panel, backdrop `ink-900` at 60%, no blur, always a close button and at
  least one action.
- Drawer: slides from the right, 480 px wide.

### 7.8 `PackTile`

Business-type picker, onboarding step 1. Three columns at ≥ 560 px, two below, 8 px gap.
Unselected: `paper-100` with a 1 px `ink-300` inset. Selected: `mint-light` with a 2 px
`mint` inset. Height is set by content, because titles wrap to two lines in Arabic and
Chinese. The last tile is always **Something else**, a real path in which Michael asks
questions and builds from the core pack. This grid has no empty state and no dead end.

Pack titles and subtitles come from pack JSON, not i18n. A pack is data, and translating
third-party packs is not something the app can promise.

### 7.9 Tooltip

CSS-only `.cth-tip`, 400 ms show delay. Text at 13 px (currently 11 px, §17).

### 7.10 Schedule row (`triggers/ScheduleList`)

A divided list, never boxed tiles: one `ink-100` hairline between rows. Row: a when
chip (Inter 14 px, `lemon-light` when on, `cream-300` with `ink-500` text when paused),
the job name at 14 px, and a 13 px `ink-500` sub-line ("fired 2h ago, next in 40m,
added by you"), then the `Toggle` (`role="switch"`). The open row's editor uses the
`inset` variant (§6.1). Delete asks first: the ghost `Delete` becomes "Sure?" with a
`destructive` "delete it" (§7.2) and a secondary "keep". A failed save reverts the row
and says "Didn't save. Try again." in coral with a `!`. Read-only rows (Michael's office
schedule) end in `›` and open that agent's Schedules tab.

The agent panel tab strip uses Inter 14 px labels and scrolls sideways when four tabs
outgrow the panel.

### 7.10a Radio row (`CapabilitiesTab`, Sending)

For a choice between a few options where each option needs its reason beside it
(first use: Can send or Draft only). Rows follow §7.10: a divided list, one `ink-100`
hairline between rows. Each row: a 16 px circle (`paper-100` fill, 1 px `ink-500`
inset; the chosen one gets an 8 px `ink-900` dot), the option at 14 px, and a 13 px
`ink-500` line under it saying what it does. The rows form one `role="radiogroup"`
with a name; only the chosen row is in the Tab order, and the arrow keys move the
choice (§12). No pill or segmented control.

### 7.11 Memory notes (`MemoryNotes`, the Memory tab)

The memory index is shown as notes, never its raw lines (the `[m3]` id, kind word and
pipes stay in "Show the file"). Memory comes first: the agent's name in Press Start 2P
12 px with the picker beside it, then a 13 px `ink-500` count line ("12 things
remembered, 3 notes waiting to be sorted in"). Groups in this order, each an Inter 13 px
semibold `ink-700` heading with its count: Your preferences, How to, Facts, Where things
live, Other notes. Rows follow §7.10: a divided list on the panel ground, entry text
Inter 14 px, a 13 px `ink-500` line under it ("learned on a task, Sep 25"). A future
"check again" date is a `lemon-light` chip; a passed one is `coral-light` with a `!`.
Procedures are disclosure buttons that open to their steps (markdown, `card` variant).
One search box sits below the memory with an "Exact words / By meaning" switch.

### 7.12 Agent profile (`ProfileTab`)

The first tab on every agent. Job title in Press Start 2P 12 px, then what the job is in
Inter 16/24 (`body-lg`), then sections with Inter 13 px semibold `ink-700` headings as in
§7.11: "What {{name}} does"
with a mint ✓; "Asks you first"; Key facts as a two-column definition list (13 px `ink-500`
labels, 14 px values, the folder in mono); the full instructions collapsed behind a text
button, rendered as markdown (`card`) on `paper-100`. 72ch measure, 16 px padding.

---

## 8. Web components [Web]

All in `public/assets/site.css` unless noted as page-local in `index.html`.

### 8.1 Nav

- Left: the mark (30 px) and the wordmark. Center: four section links. Right: one
  primary `DOWNLOAD` button that goes to `/download`. Nothing else: Discord, GitHub and
  the FAQ live in the footer (§8.5), so the bar has one action.
- Section labels are one or two words: HOW IT WORKS, TEAM, LIMITS, OPEN SOURCE. The
  label promises what the section delivers. There is no paid tier, so nothing is labelled
  PLANS or PRICING.
  Sections without a link (Dwight, the day log, business types, FAQ) light up the link
  of the chapter they sit in.
- Links that leave the site carry `↗` wherever they appear.
- Current section: `ink-900` text, a 3 px coral underline and `aria-current="true"`. It is
  set by a scroll check: the last section whose top has passed the bottom of the nav.
  Nothing is marked above the first section.
- At ≤ 1040 px the links move to a second sticky row that scrolls sideways, with
  44 px tap targets and the current link scrolled into view. Both rows stay sticky.
  `section { scroll-margin-top }` matches the header height: 66 px wide, 112 px narrow.

### 8.2 Button (`.btn`)

VT323 label per §4.3, 2 px `ink-900` border, hard shadow, `cream-50` fill. Primary:
`coral` fill. Hover: one step lighter. Active: `translate(4px,4px)` and the shadow
disappears (`steps(1)`, 60 ms). Focus: 3 px `ink-900` outline at 3 px offset.

### 8.3 Chip, stamp, tabs, file, panel

- Chip: VT323 17 px, 2 px border, hard shadow, an optional 9 px square status dot.
- Stamp: VT323 19 px coral, 3 px coral border, rotated −3°. Used for jokes and verdicts
  such as NOT ON RECORD. Never as a logo.
- Tabs and file: folder tabs (VT323 19 px, current tab `peach`) over a `paper-100`
  frame. Used to present an artifact as a document in a cabinet.

### 8.4 Section header

An eyebrow (`.sechead`, §4.3) above the h2, then one supporting sentence (`.sub`, 62 ch).
One job per section.

### 8.5 Footer

`ink-900` ground, Pixelify Sans 17 px, `peach` links with `lemon` hover. Links: Download,
FAQ, GitHub, Discord, License, Contact.

---

## 9. Characters and sprites [App]

Sprites are drawn in code (`scene/office/portraitArt.ts`, `scene/office/cast.ts`).

- Portrait cell 18 × 28 px. In-scene sprite 18 × 32 px.
- Frames: walk × 3, type × 2, read × 2, laid out in three rows.
- Each character has one identifying shirt color, used for its selection glow. Those
  colors live in `cast.ts` and are not design tokens (§17).
- Agents can also carry one of the six accents (§3.3). The accent drives the agent's
  badge, selection ring and prompt prefix.
- Walking adds a ±1 px vertical bob. Reduced motion turns walks into instant moves and
  disables the bob (§11). This is not yet implemented in the Pixi layer (§17).

Status overlays (drawn above the sprite, 8 × 8 px): `thinking` has three cycling dots,
`blocked` has a pulsing coral `!`, `success` has a four-frame sparkle, and `ghost` is 50%
opacity. *Spec. Not verified against `scene/` in the 2026-09-24 audit.*

Office scene themes (`office`, `brooklyn99`) live in `scene/office/themeRegistry.ts`.
They restyle the floor and do not change UI tokens.

---

## 10. Iconography [App]

- 16 × 16 px, integer coordinates, at most two colors (ink plus one accent),
  hand-drawn inline SVG through `Icon.tsx`. Integer scaling only.
- Provider marks go through `ProviderLogo.tsx`.
- **Pack glyphs are not icons.** A pack's `glyph` renders as an emoji inside a
  `PackTile` and nowhere else. An unknown glyph shows `?` on a `cream-200` tile, never a
  broken image. Promoting stable packs to real `Icon` entries is the upgrade path, and
  the tile's API does not change.
- **[Web]** Business-type glyphs on the site are 32 px pixel SVGs, drawn to the same
  rules. The site uses no emoji.

---

## 11. Motion

### 11.1 App [App]

| What | Duration | Easing |
|---|---|---|
| Hover | 0 | none |
| Button press | 0 | none |
| Settings button | 80 ms | `steps(2)` |
| Tooltip | 90 ms after a 400 ms delay | ease-out |
| Blink, pulse keyframes | 700 to 1200 ms | `steps(2)` |
| Sprite frame | 125 ms | step |

Forbidden: spring physics, bounce, parallax, and idle animation on static UI panels.
Animation belongs to the game layer.

### 11.2 Web [Web]

- Button press: `steps(1)`, 60 ms.
- Anchor jumps use smooth scroll.
- Nothing else moves. No entrance animations, no hover zooms, no marquees.

### 11.3 Reduced motion [Both]

When `prefers-reduced-motion: reduce`, set all durations to 0, turn smooth scroll off,
turn walks into instant moves, and turn particles off. The app's CSS already does
this. The Pixi layer and the website's smooth scroll do not yet (§17).

---

## 12. Accessibility [Both]

- Contrast: body text 4.5:1 or better on every surface it can appear on. Structural
  borders 3:1 or better. The app's dark palette is measured. Keep it measured.
- Focus is always visible and at least 3:1 against its surroundings.
  - **[Web]** 3 px `ink-900` outline, 3 px offset.
  - **[App]** 2 px `ink-900` outline, 2 px offset for buttons and links. Inputs get a
    2 px `ink-700` inset. (The current global ring is 1 px `ink-300`, which is too weak, §17.)
- Touch targets 44 px or larger on the web's phone layout.
- Keyboard: everything reachable by Tab. Enter and Escape handlers respect IME
  composition (`isComposingKey`) so CJK input is never cut off.
- Never communicate by color alone (§3.4).
- **[Web]** One `nav aria-label="Main"`. The duplicate phone link row is `display:none`
  when hidden, so screen readers hear one set.

---

## 13. Voice and copy [Both]

### 13.1 Shared rules

- Name the actor. "Oscar is reconciling March", never "the agent is processing".
- Keep system feedback under 12 words. Second person to the user.
- No emoji in copy. The app has icons, and the site has pixel glyphs.
- Exclamation marks only for completions and notifications.
- Real punctuation: "don't", never "dont".
- **No em dashes or en dashes in user-facing copy.** Use a period, a comma, a colon or
  parentheses. The website and its repo were cleaned of them on 2026-09-18. The app's
  strings have not been audited (§17).

### 13.2 App tone

Friendly and factual. A villager who happens to be technically literate.

| Don't | Do |
|---|---|
| "An error has occurred" | "Oscar hit a snag" |
| "Permission denied" | "Oscar needs your permission" |
| "Loading..." | "One sec..." |
| "Confirm operation" | "Sure?" |

### 13.3 Web tone

Dry. The site is written as a performance review of Michael: section eyebrows read like
file references (REVIEW 05 · SCORECARD), verdicts are stamped, and each agent has a
WON'T list with one line of humor. The joke is always at Michael's expense, never the
customer's.

- Headlines are sentence case statements, and they land in one line when they can.
  "The software is free. The setup is what costs."
- Claims stay honest. No price on a page with no prices. A download button only points
  at a real release (met from v0.0.1; the button goes to `/download`, which reads the latest
  release from GitHub).

---

## 14. Token files

| Surface | File | Holds |
|---|---|---|
| App | `src/renderer/src/design/tokens.css` | CSS custom properties `--cth-*`, light in `:root`, dark under `:root[data-cth-theme='dark']` |
| App | `src/renderer/src/design/tokens.ts` | TS mirror for Pixi and inline styles. **Currently missing four statuses and all dark values** (§17). |
| App | `src/renderer/src/design/global.css`, `fonts.css` | Base styles, font faces |
| App | `src/renderer/src/design/theme.ts` | Theme switch: `data-cth-theme` on `<html>`, stored in `localStorage` key `cth.theme`, default light |
| Web | `public/assets/site.css` `:root` | Web tokens: neutrals, web accents, `--hard`, `--panel` |
| Kit | `branding/colors/colors.{css,json}`, `dont-be-michael.ase` | Every color in formats for design tools. Generated, do not hand-edit. |

Rules:

- `tokens.css` and `tokens.ts` change in the same commit.
- A web token must name its app twin in a comment if it has one.
- **[Web]** Any edit to `site.css` bumps the `?v=` query in `index.html` and `404.html`.
  The file is cached for five minutes, and a stale stylesheet has shipped invisible
  changes before.

---

## 15. Themes [App]

Light and dark, one token swap for the whole app. Terminals and per-agent sessions
follow the switch, and the terminal is told about the change (dark = 1, light = 2, see
`test/theme-notify.test.cjs`). The dark theme is warm and lifted: the ground is never
`#000`, text is never `#FFF`, and the accents hold a narrow luminance band so no hue
fluoresces.

The website is light only. That is a decision, not an omission: the brand is cream paper.

---

## 16. Making changes

1. Decide at the right level. If it changes what a color or face *means*, it is a
   brand change (§1 to §4), and it is decided for both surfaces at once.
2. Edit this file, then the token files, then components.
3. Before merging a visual change, check at 1440, 1040, 980, 480, 390 and 320 px (web),
   or at 1280 × 800 in both themes (app).
4. Record deliberate deviations in §17 with a reason, or remove them.
5. Add a line to §18.

---

## 17. Deviation and debt register

Known gaps between this spec and the code, as of 2026-09-24. Each one is either
**Accepted** (with a reason) or **Fix** (the spec wins and the code should change).

| # | Surface | Gap | Where | Status |
|---|---|---|---|---|
| 1 | App | App icon is the Michael portrait, not the Struck M | `build/icon.*` | Done 2026-09-25: `build/icon.*` are copies of `branding/app-icon/`, checked by `test/header-lockup.test.cjs` |
| 2 | App | `tokens.ts` lacks `waiting`, `compacting`, `looping`, `typing` and all dark values | `design/tokens.ts:37-44` | Fix |
| 3 | App | `CodeEditor` asks for VT323, which is no longer bundled | `components/CodeEditor.tsx:22` | Fix: JetBrains Mono |
| 4 | App | Tooltips at 11 px, below the 13 px floor | `global.css:132` | Fix |
| 5 | App | Global focus ring is 1 px `ink-300`, too weak | `global.css:67-70` | Fix: §12 |
| 6 | App | `PixelButton` hover and press are mouse-only | `PixelButton.tsx:85-88` | Fix |
| 7 | App | Pixi walk and bob ignore reduced motion | `scene/` | Fix |
| 8 | App | `color-scheme: light` hard-coded in dark mode | `global.css:9` | Fix |
| 9 | App | Thirteen 2 px radii | `App.tsx`, `FullscreenTerminal.tsx`, `IdePanel.tsx`, `global.css`, `UpdateBadge.tsx` | Fix to 0, or accept with a reason |
| 10 | App | Character shirt colors are raw hex, not tokens | `scene/office/cast.ts:30-49` | Accepted for now: they are sprite art, not UI. Revisit with #11. |
| 11 | App | The cast uses *The Office* character names | `scene/office/cast.ts` | Open decision (§19) |
| 12 | App | No shared motion tokens | components | Fix: add `--cth-dur-*` |
| 13 | App | UI strings not audited for em and en dashes | `src/renderer/src/i18n` | Fix: audit |
| 14 | App | The release-notes modal paints with its own palette (paper `#FFFDF7`, ink `#1B1B1B`, yellow `#FFCA54`, sky `#72C2DF`, maroon `#B23A4E`) instead of app tokens | `components/ReleaseDrop.tsx:46-55`, `shared/releaseDrop.ts:126` | Fix: move to `--cth-*` tokens |
| 15 | Web | Eight different letter-spacing values (.02 to .12em) | `site.css`, `index.html` | Fix: normalize to §4.3 |
| 16 | Web | Off-grid padding and gaps (13, 22, 26 px and others) | `site.css`, `index.html` | Fix gradually: touch it, snap it |
| 17 | Web | `.btn-primary:hover` uses the raw hex `#ff8080` | `site.css` | Fix: token |
| 18 | Web | Smooth scroll ignores reduced motion | `site.css` (`html{scroll-behavior:smooth}`) | Fix |
| 19 | Web | No social card image (`og:image`) | `index.html` | Fix: use `branding/social/og-card-1200x630.png` |
| 20 | Web | Body text in Inter, not a pixel face | `site.css` | Accepted: readability, and it matches the app |
| 21 | Web | ALL CAPS and tracking on VT323 labels, which the app forbids | `site.css` | Accepted: web volume, limited to §4.3 values |
| 22 | App | Destructive button text is `ink-900`, which turns off-white in dark mode: 1.85:1 on dark coral | `PixelButton.tsx` (destructive `text`) | Fix: use `on-accent` |
| 23 | App | Light-theme `ink-300` borders measure 2.2 to 2.6:1 on cream surfaces, under the 3:1 border floor | `tokens.css` light `ink-300` | Fix: darken light `ink-300`, re-measure every surface |

---

## 18. Change log

| Date | Change |
|---|---|
| 2026-09-28 | Web: Pro offering removed; the site is open source only. PLANS becomes OPEN SOURCE (§8.1). |
| 2026-09-28 | Web: nav cut to four links plus a `DOWNLOAD` button (§8.1); Discord, GitHub and FAQ moved to the footer (§8.5); ≤ 360 px row added (§5.3); download rule met (§13.3). |
| 2026-09-24 | Moved into `branding/` with the full brand kit: logos, lockups, app icon, favicons, social card, color files, fonts, a printable brand guide and the build script. |
| 2026-09-24 | Rewritten as one spec for app and web. Documented the v0.3.4 recalibration (calm accents, Inter and JetBrains Mono, hairline panels, dark theme) that the old doc predated. Added brand, logo (Struck M), web profile, accent map and the deviation register. Retired the three-layer panel, Pixelify and VT323 in the app, and "no dark mode". |
| 2026-09-24 | Web: nav rebuilt (§8.1), Struck M logo and favicons shipped, Discord added. |
| v0.3.4 | App recalibration: calmer accents, bundled Inter and JetBrains Mono, hairline borders, measured dark theme. |

---

## 19. Open decisions

1. **Character names.** The office cast uses *The Office* character names (Michael, Jim,
   Pam and others). The product's premise is a nod to the show, but using the names
   directly is a legal and brand risk. Decide whether to keep them, rename them, or make
   names user-set with neutral defaults.
2. **App dash audit scope.** Confirm that the no-em-dash rule (§13.1) applies to app UI
   strings and release notes, not just the website.
3. **Custom sprite art** versus programmatic sprites, long term.
4. **Social card and press kit.** Define a 1200 × 630 card and a downloadable logo pack
   once the app icon has migrated.
5. **Sound.** 8-bit sound effects are specced but deferred. Off by default if they ship.
