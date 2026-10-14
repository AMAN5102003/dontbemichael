# Named links in agent text

Owner, 2026-10-11 (screenshot of the Needs you card "Possible spam company in
HubSpot", step 1 reading "Open https://app.hubspot.com/contacts/5773691/record/0-2/18164826678"):
"the card showing link is ugly. it will be nicer to show a named link rather such
as HubSpot that takes to it rather showing the raw link".

Status: design review complete (/plan-design-review, 2026-10-11), D2 to D6 approved.
Eng review complete (/plan-eng-review, 2026-10-11): structure, R2 and R3 approved,
E1, E2 and E5 corrected below. Eng review questions are written eng D1 to eng D4.
Mockup: [`named-links.html`](./named-links.html) (option A approved).

## Premise

- **Problem:** an agent pastes a bare URL into an ask. remark-gfm turns it into a
  link whose text is the URL itself, and the `a` renderer in
  `src/renderer/src/markdown/MarkdownPreview.tsx:84` prints that text as is. On the
  narrow Needs you column a record URL wraps over two lines and buries the step
  it belongs to.
- **Nothing names a web address today.** `src/shared/integrations.ts` knows API
  hosts (`api.hubapi.com`), not the app hosts an owner opens (`app.hubspot.com`).
  The ask-writing rules (`src/main/hive.ts:329`, `:1918`, `:4574`) cover bold
  openers and backticked paths, not links.

## Decision ledger

| ID | Decision | Answer |
|---|---|---|
| D2 Name source | The app names every bare URL it renders in card mode (a known app's name, otherwise the host without `www.`, or the address for `mailto:`). Agents are also told to write links as a few words naming what opens. | B, owner 2026-10-11 |
| D3 Look | Named inline link with an external arrow, not a chip. | A, owner 2026-10-11 |
| D4 Trust | When the link's words name a known app or a web address the link does not go to, the real host follows in small grey text. | A, owner 2026-10-11 |
| D5 Surfaces | Every `variant="card"` surface. Document mode (file tabs, the IDE preview) unchanged. | A, owner 2026-10-11 |
| D6 Screen readers | A visually hidden "opens in your browser" after the name. | A, owner 2026-10-11 |

## The design

### What the card shows (D2, D5)

Card-mode markdown only: Ask me cards, Michael's dock replies, task detail Q&A,
memory notes, Work style offers, profile instructions, and the Command Center
index (every `MarkdownPreview` with `variant="card"`, including through `FileText`).

| Agent wrote | Card shows |
|---|---|
| `https://app.hubspot.com/contacts/...` (bare) | HubSpot ↗ |
| `https://qbo.intuit.com/app/invoice?txnId=118` (bare) | QuickBooks ↗ |
| `https://docs.google.com/spreadsheets/d/...` (bare) | Google Sheets ↗ |
| `https://www.northwindcafe.com/menu/fall` (bare, unknown host) | northwindcafe.com ↗ |
| `mailto:francis@example.com` or `francis@example.com` (bare) | francis@example.com ✉ (R2) |
| `www.northwindcafe.com/menu` (bare, no scheme) | northwindcafe.com ↗ (E1) |
| `http://hubspоt.com/` (bare, Cyrillic о) | xn--hubspt-0qf.com ↗ (E2: never the look-alike) |
| `[the company in HubSpot](https://app.hubspot.com/...)` | the company in HubSpot ↗ |
| `[HubSpot](https://hubspot-login.example/...)` | HubSpot ↗ (hubspot-login.example) |
| `[app.hubspot.com](https://evil.example/...)` | app.hubspot.com ↗ (evil.example) |
| `[the record](https://evil.example/...)` | the record ↗ (D4 limit: words name nothing to check) |
| a bare URL `new URL()` can't parse | unchanged from today |
| a `file:`, relative or other non-web link | unchanged from today (inert or `.md` handling) |

- **Bare** (E1, `isBareLink(text, href)`): the link's text equals its `href`, or
  `http://` plus the text equals it (remark-gfm adds the scheme to a `www.`
  autolink), or `mailto:` plus the text equals it (an email autolink).
- **Host** (E2): always `new URL(href).hostname` (punycode, lowercase, no
  `user:pw@`), shown without a leading `www.`. A known domain matches only the
  host itself or a host ending in `.` plus the domain, so
  `app.hubspot.com.evil.io` is not HubSpot.
- **Known apps** (`linkName(href)` in `src/renderer/src/markdown/mdLinks.ts`, eng D1; matched on the host or a parent
  domain): HubSpot (`hubspot.com`), QuickBooks (`intuit.com`), Gmail
  (`mail.google.com`), Google Docs, Sheets and Slides (`docs.google.com` by first
  path segment `document`, `spreadsheets`, `presentation`), Google Drive
  (`drive.google.com`), Google Calendar (`calendar.google.com`), Outlook
  (`outlook.office.com`, `outlook.live.com`), Slack (`slack.com`), Notion
  (`notion.so`), Stripe (`stripe.com`), GitHub (`github.com`), Linear
  (`linear.app`), Jira and Confluence (`atlassian.net`, `/wiki` is Confluence),
  Sentry (`sentry.io`), Xero (`xero.com`). Any other host shows itself without
  `www.`. Names are product names: not translated.
- **Agent rule (D2 and R3, agent behavior change):** one sentence added beside
  the backtick rule in the three ask-writing places (`hive.ts:329`, `:1918`,
  `:4574`) and in Michael's conversation rule for dock replies (`hive.ts:342`): "Write each link as a few words naming what opens, like [the company
  in HubSpot](https://...), never the bare address."

### What it looks like (D3)

- Link text: `indigo-text`, weight 500, underline 1 px at 2 px offset (2 px
  thick on hover), inherits the card's size (12.5 / 18 on Ask me).
- Then a 12 px `external` icon (Lucide external-link, 1.75 stroke,
  `currentColor`), 3 px gap, `vertical-align: -1px`, `aria-hidden`. New
  `external` entry in `components/Icon.tsx`.
- The last word and the arrow never break apart: a word joiner (U+2060) sits
  between the text and the icon (E5); a long label still wraps between its other
  words.
- Email links (R2): a 12 px `mail` icon (Lucide mail, new in `Icon.tsx`) in
  place of the arrow, same size, stroke and spacing.
- Tooltip: the full URL (`title`, as today).
- Click: unchanged path, `window.cth.openExternal`.
- Focus: 2 px `indigo` outline, 2 px offset (DESIGN.md §12).
- RTL: the arrow is not mirrored, same as the other inline icons; the link sits
  inside the block's `dir="auto"` as today.

### Mismatch guard (D4)

After the link, ` (host)` in `ink-3`, regular weight, not underlined, not part of
the link, when either:
1. the words contain a known app name (whole word, any case) and the host is not
   that app's domain, or
2. the words look like a web address (a host with a dot, with or without a
   scheme) and that host, without `www.`, differs from the link's host.

Names the app derived itself never trigger it. Honest links show nothing extra.

### Screen readers (D6)

Inside the link, after the name: a visually hidden span "opens in your browser"
(new key `markdown.opensInBrowser` in `en.json`, `ar.json`, `zh-CN.json`). The
mismatch host is real text after the link, so it is read too. Result: "HubSpot,
opens in your browser, link (hubspot-login.example)". Email links (R2) say
"opens your email app" instead (key `markdown.opensInEmail`).

## Review passes

| Pass | Before | After | Note |
|---|---|---|---|
| 1 Information architecture | 5 | 9 | The step reads first, the destination second; the real host only when it matters. |
| 2 States and edge cases | 3 | 9 | Unknown host, mailto, unparseable, non-web links and mismatch all specified. |
| 3 Journey | 5 | 9 | Scan the step, click the name, land in the app; a look-alike link shows where it really goes. |
| 4 AI slop | 7 | 9 | App UI (Operate). An inline link, no chip or decoration; no hard rejections. |
| 5 Design system | 3 | 9 | Uses `indigo-text`, `ink-3`, §12 focus, §10 icon style; §7.8 and §10 gain the rule. |
| 6 Responsive and accessibility | 3 | 9 | Arrow glued to the last word for the narrow column; hidden phrase; focus ring. |
| 7 Decisions | | | 5 resolved (D2 to D6), 0 deferred. |

No pass reaches 10 because D4's guard can't check words that name nothing ("the
record"); the owner accepted that limit.

## Behavior changes

| Who | Rule today | Proposed | What the owner sees |
|---|---|---|---|
| Michael, writing asks (hive.ts:329, :1918, HIVE doc :4574) | The ask rules say nothing about links; agents paste the bare URL | Write each link as a few words naming what opens, never the bare address | New asks read "Open the company in HubSpot" instead of a URL |
| Michael, replying in the dock (hive.ts:342, R3) | The conversation rule says nothing about links | Same sentence | Dock replies name what opens, like asks |

The app-side naming is display only: the stored question text is unchanged.

## NOT in scope

- File tabs and the IDE preview (D5): saved reports keep showing addresses.
- A link chip (D3 B): declined.
- Checking where a link redirects to or fetching a page title: would send a
  request for every card the owner reads.
- Favicons: remote images are blocked by the CSP (`img-src 'self' data: blob:`),
  and fetching them would leak what the owner opened.

## What already exists

- `MarkdownPreview` `a` renderer: external opening, tooltip, inert handling.
- `.cth-nowrap` and the chip punctuation tidy in `remarkFileChips.ts`.
- `isExternal` in `mdLinks.ts`.
- `Icon.tsx` outline set (Lucide style, §10).
- `actionText` maps MCP server names to app names ("Working in HubSpot"); it reads
  server names, not web hosts, so it does not share the new table (eng D1).
- `loadTs` plus unified and remark-gfm in `test/open-file-tab.test.cjs` test
  markdown parsing without React; the new tests use the same harness.

## Implementation Tasks

Rewritten by the eng review (eng D1 structure, R2, R3, E1, E2, E5).

- [ ] **T1 (P1, human: ~3h / CC: ~15min)** `mdLinks.ts`: `isBareLink(text, href)`, `linkName(href)` (known app, host without www, email address, or null when unparseable or not http(s)/mailto) and `labelMismatch(label, href)` (host or null). Hosts from `new URL().hostname`; domain match on a dot boundary.
  - Surfaced by: D2, D4, E1, E2
  - Files: `src/renderer/src/markdown/mdLinks.ts`, new `test/link-names.test.cjs`
  - Verify: `node --test test/link-names.test.cjs`
- [ ] **T2 (P1, human: ~2h / CC: ~15min)** `MarkdownPreview.tsx`: in card mode only, bare links show `linkName`; web links get the `external` arrow and the hidden "opens in your browser"; email links get the `mail` icon and "opens your email app"; a word joiner before the icon; the mismatch host after the link in `ink-3`. Document mode unchanged.
  - Surfaced by: D3, D5, D6, R2, E5
  - Files: `src/renderer/src/markdown/MarkdownPreview.tsx`, `src/renderer/src/components/Icon.tsx`, `src/renderer/src/design/global.css`
  - Verify: wiring assertions in `test/link-names.test.cjs`; run the app: the screenshot's card shows "Open HubSpot ↗", a dock reply with the same URL matches, a file tab still shows it raw.
- [ ] **T3 (P1, human: ~30min / CC: ~5min)** Locale keys `markdown.opensInBrowser` and `markdown.opensInEmail` in en, ar, zh-CN.
  - Surfaced by: D6, R2
  - Verify: `test/i18n-keys-exist.test.cjs` and the locale parity test.
- [ ] **T4 (P1, human: ~30min / CC: ~5min)** The link sentence at `hive.ts:329`, `:342`, `:1918` and the HIVE doc rule at `:4574`.
  - Surfaced by: D2, R3 (agent behavior change)
  - Verify: one assertion per place in `test/link-names.test.cjs`, as `test/open-file-tab.test.cjs:173` does for E4.
- [ ] **T5 (P2, human: ~30min / CC: ~5min)** `branding/DESIGN.md`: a "Links" bullet in §7.8 (look, email icon, mismatch, hidden phrases, card mode only), `external` and `mail` in §10, a §18 change log line; `docs/FEATURES.md` per the versioning rule.
  - Surfaced by: D3, R2

## Eng review (/plan-eng-review, 2026-10-11)

Target: this file (docs/designs/named-links.md).

Scope record: feature answers: none proposed (no cuts); structure: A Smaller
arrangement (D1, owner 2026-10-11); accepted scope: every approved feature
(D2 to D6 of the design review) with linkName, isBareLink and labelMismatch in
`src/renderer/src/markdown/mdLinks.ts` instead of a new `src/shared/linkNames.ts`;
pending remedies: R2, R3 (both since approved).

### Findings

- E1 [P1] (confidence: 10/10) MarkdownPreview.tsx:84 / plan "Bare means the link's text equals its href": remark-gfm writes a `www.` autolink with an added scheme. Probe (unified + remark-gfm, this checkout): `{"url":"http://www.northwindcafe.com/menu","text":"www.northwindcafe.com/menu"}` and `{"url":"mailto:francis@example.com","text":"francis@example.com"}`. With text-equals-href only, every `www.` link stays raw. Correction (no behavior change from D2, which names every bare URL): bare when the text equals the href, or `http://` plus the text equals it, or `mailto:` plus the text equals it.
- E2 [P1] (confidence: 9/10) plan "Any other host shows itself without www.": remark keeps the raw host, so a look-alike shows as written: `{"url":"http://hubspоt.com/"}` (Cyrillic о). `new URL(href).hostname` gives `xn--hubspt-0qf.com`, lowercases, and drops `user:pw@`; `APP.HubSpot.com.evil.io` gives `app.hubspot.com.evil.io`. Correction: every shown host and every known-app match uses `new URL(href).hostname`; a known domain matches only the host itself or a host ending in `.` plus the domain. Unparseable stays raw (already in the plan).
- E3 [P2] (confidence: 9/10) mdLinks.ts:30 `isExternal` covers `mailto:`, and MarkdownPreview.tsx:88 sends it to `openExternal`, which opens the mail app. The approved arrow and "opens in your browser" (D6) would be wrong for an email address. See R2.
- E4 [P2] (confidence: 8/10) plan Behavior changes table says "who writes an ask or a dock reply", but T4 names only the ask rules (hive.ts:329, :1918, :4574). Michael's dock replies follow the conversation rule at hive.ts:342 and render in card mode too. See R3.
- E5 [P3] (confidence: 7/10) plan "the existing `.cth-nowrap` span": wrapping the last word means splitting arbitrary link children (emphasis, code). Correction: a word joiner (U+2060) between the text and the arrow keeps them on one line with no splitting. Same approved behavior (D3).

### Decision ledger

### R2: mailto links
Finding: E3, P2, 9/10, mdLinks.ts:30 and MarkdownPreview.tsx:88, Claude
Plan baseline: every external link in card mode gets the arrow and "opens in your browser" (D3, D6); bare `mailto:` shows the address (D2)
Runtime evidence: `isExternal` is `/^(https?:|mailto:)/i`; mailto opens through `window.cth.openExternal` (the system mail app)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 mailto treatment | arrow + "opens in your browser" (plan) | mail icon + hidden "opens your email app" | no arrow, no hidden phrase |
| Bare mailto shows the address (D2) | approved | unchanged | unchanged |
| R3 conversation rule | pending | pending | pending |
Question D2:
D2 — What an email link shows <gstack-qid:plan-eng-review-named-links-mailto>
Project/branch/task: named links plan, mit/plan-design-review-named-links.
ELI10: An agent can write an email address as a link. Clicking it opens your mail app, not the browser. The plan gives every link the browser arrow and a hidden "opens in your browser", which would be wrong for an email. Either email links get their own small mail icon and say "opens your email app", or they get no icon at all.
Stakes if we pick wrong: a screen reader user is told a browser will open and gets Mail; a sighted owner sees the browser arrow on an address.
Recommendation: A because it keeps every link telling you where the click goes, which is the reason for the arrow (D6).
Completeness: A=10/10, B=8/10
Pros / cons:
A) Mail icon and phrase (recommended) (human: ~1h / CC: ~5min)
  ✅ The icon and the hidden phrase both say Mail opens, matching what the click really does
  ✅ Same pattern as web links, so every link on a card says where it goes
  ❌ One more icon in Icon.tsx and one more translated key in three locale files
B) No icon for email
  ✅ No new icon or key; an email address already reads as an email address
  ✅ Fewer moving parts in the link renderer, one less branch to test
  ❌ Screen readers get no warning that the mail app opens, unlike web links
Net: A keeps the "say where the click goes" rule for email too; B saves an icon and a key.
Header: Email links
Options:
A) Mail icon and phrase (recommended)
A 12 px `mail` icon (Lucide mail, new in Icon.tsx) instead of the arrow, and the hidden "opens your email app" (new key markdown.opensInEmail in en, ar, zh-CN). One extra icon, one extra key, one test row.
B) No icon for email
Email links stay plain underlined text with no icon and no hidden phrase. No new icon or key; screen readers hear only the address.

State: approved
Actual answer: A) Mail icon and phrase (D2, owner 2026-10-11)
Accepted scope: `mailto:` links in card mode show a 12 px `mail` icon (Lucide mail, new in Icon.tsx) in place of the arrow and a hidden "opens your email app" (key markdown.opensInEmail in en, ar, zh-CN); web links keep the arrow and "opens in your browser"; one test row.
History: none

### R3: dock replies follow the link rule too
Finding: E4, P2, 8/10, hive.ts:342, Claude
Plan baseline: link sentence added to the three ask rules (hive.ts:329, :1918, :4574); Behavior changes table names dock replies
Runtime evidence: hive.ts:342 is the rule for answering the owner in the dock; MichaelDock.tsx:317 renders the reply through FileText in card mode
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 conversation rule (hive.ts:342) | no link sentence | link sentence added | unchanged; table says asks only |
| Ask rules link sentence (D2) | approved | unchanged | unchanged |
| R2 mailto | pending until answered | answer carried | answer carried |
Question D3:
D3 — Should Michael's dock replies name links too <gstack-qid:plan-eng-review-named-links-dock-rule>
Project/branch/task: named links plan, mit/plan-design-review-named-links.
ELI10: You approved telling agents to write links as words, like "the company in HubSpot". The plan puts that sentence in the three rules for writing asks, but Michael's replies in the dock follow a separate conversation rule. Without the sentence there, the app still turns a bare dock URL into "HubSpot", but Michael won't write "the company in HubSpot".
Stakes if we pick wrong: asks say what opens and dock replies only say the app name, so the two read differently.
Recommendation: A because the same sentence in one more rule makes every card-mode message read the same.
Completeness: A=10/10, B=8/10
Pros / cons:
A) Add to the reply rule (recommended) (human: ~15min / CC: ~2min)
  ✅ Dock replies say what opens ("the company in HubSpot"), the same as asks do
  ✅ One sentence in hive.ts:342 and one more assertion in the prompt test
  ❌ A second agent behavior change: Michael's conversation replies change wording too
B) Asks only
  ✅ Michael's conversation rule stays exactly as it is today, one less prompt change
  ✅ Dock replies still show "HubSpot" instead of a URL, because the app names them
  ❌ Dock replies never say which record opens, so asks and replies read differently
Net: A makes all of Michael's writing consistent at the cost of one more prompt sentence.
Header: Dock replies
Options:
A) Add to the reply rule (recommended)
The same sentence goes into the conversation rule at hive.ts:342. Michael writes named links in dock replies as in asks. Behavior change listed in the table; one more test assertion.
B) Asks only
Leave hive.ts:342 alone and change the Behavior changes table to say asks only. Dock replies still show app names (the app does that), never "the company in HubSpot".

State: approved
Actual answer: A) Add to the reply rule (D3, owner 2026-10-11)
Accepted scope: the link sentence also goes into the conversation rule at hive.ts:342; the Behavior changes table lists dock replies; one more prompt test assertion.
History: none

Approval readiness: PASS (eng D1 structure; R2 eng D2 A; R3 eng D3 A; TODO eng D4 A; E1, E2, E5 are corrections of approved D2, D3, D4 behavior with no new behavior).

### Section results

- **Architecture:** E1, E2 (corrections, P1), E3 (R2, approved). Security boundary unchanged: react-markdown without rehype-raw, `openExternal` for http(s) and mailto only. Dispositions: E1 accepted (correction), E2 accepted (correction), E3 accepted (R2 A).
- **Code quality:** E4 (R3, approved), E5 (correction). Dispositions: E4 accepted (R3 A), E5 accepted (correction).
- **Tests:** diagram below; 0 gaps after T1 to T4.
- **Performance:** no issues found. `linkName` is a table lookup and one `new URL()` per link, run while a card renders; cards hold a handful of links. Scale: under 10 links per card [estimated].
- **Outside voice:** skipped. Owner rule (2026-10-01): Codex only for the adversarial pass, never a plan review, and no Claude subagent stand-in.

### Flow

```
agent markdown ──remark-gfm──▶ link node {url, text}
                                    │
                MarkdownPreview `a` (card mode only, D5)
                                    │
           isExternal(href)? ──no──▶ today's path (inert, .md, unchanged)
                  │yes
     isBareLink(text, href)? ──yes──▶ label = linkName(href) ?? text (E1, E2)
                  │no                         (null when unparseable: raw)
             label = agent's words
                  │
   <a title=href onClick=openExternal> label ⁠<icon external|mail aria-hidden>
                                       <hidden "opens in your browser|email app">
                  │
   labelMismatch(label, href)? ──host──▶ " (host)" in ink-3 after </a>   (D4)
```

### Test coverage diagram

```
CODE PATHS (mdLinks.ts, via loadTs)                    USER FLOWS
[+] isBareLink(text, href)                             [+] Ask me card with a bare URL
  ├── [GAP→T1] text == href                              ├── [GAP→T1] remark-gfm parse of the screenshot ask: each link bare
  ├── [GAP→T1] "http://"+text == href (www autolink)     └── [manual] shows "Open HubSpot ↗", click opens browser
  ├── [GAP→T1] "mailto:"+text == href                  [+] Dock reply, same URL
  └── [GAP→T1] labeled link → false                      └── [manual] matches the card
[+] linkName(href)                                     [+] File tab, same URL
  ├── [GAP→T1] each known app row, docs.google path,     └── [GAP→T2] source check: naming gated on `card` (CRITICAL regression)
  │            atlassian /wiki                         [+] Email link
  ├── [GAP→T1] unknown host, www stripped                └── [GAP→T2] mail icon + opensInEmail key wired
  ├── [GAP→T1] punycode host, userinfo dropped         [+] Screen reader
  ├── [GAP→T1] a.hubspot.com.evil.io not HubSpot         └── [GAP→T3] keys exist (i18n-keys-exist test)
  ├── [GAP→T1] mailto → address
  └── [GAP→T1] unparseable / non-web → null
[+] labelMismatch(label, href)
  ├── [GAP→T1] app name, other host → host
  ├── [GAP→T1] domain-like label, other host → host
  ├── [GAP→T1] matching label → null
  └── [GAP→T1] generic words → null (D4 limit)
[+] Agent rules
  └── [GAP→T4] sentence at hive.ts:329, :342, :1918, :4574

LLM: rule sentence only; no eval suite exists for ask wording (no_claim: agents obey it).
COVERAGE after T1 to T4: all code paths planned; 2 flows manual (look and click).
```

Test plan artifact: `~/.gstack/projects/agentvivekkumar-dontbemichael/moblizeit-mit-plan-design-review-named-links-e81b66-eng-review-test-plan-20261011-235618.md`.

### Failure modes

| Path | Realistic failure | Covered by | Owner sees |
|---|---|---|---|
| isBareLink | remark-gfm changes how it writes `www.` links | T1 parse test on the real pipeline | the raw URL again (no crash) |
| linkName | a URL `new URL()` rejects | T1 row | the raw URL, as today |
| known-app table | an app moves its web host | none (table edit) | the host instead of the name; still correct and safe |
| labelMismatch | label names nothing checkable | accepted limit (D4) | agent's words only, tooltip has the URL |
| card gating | naming leaks into file tabs | T2 source check | report addresses replaced (caught by test) |

Critical gaps: 0.

### Worktree parallelization strategy

Sequential implementation, no parallelization opportunity (one renderer module plus a prompt sentence; T2 depends on T1).

### Completion summary

- Step 0: Scope Challenge: scope accepted as-is (smaller arrangement, eng D1)
- Reality rows: premise-table pass (E1 and E2 premises probed, unverified=0) docs/designs/named-links.md:55; already-done pass (no origin/main commits since 2026-10-11 on the named files) src/renderer/src/markdown/MarkdownPreview.tsx:84; surface-check n/a (no CLI or route); binding-decisions pass (design D2 to D6 honored) docs/designs/named-links.md:23; numbers pass (efforts tagged estimated); deferred-asks pass (the one ask, named links, is in full); pr-count pass (one PR)
- Architecture Review: 3 issues found (E1, E2, E3)
- Code Quality Review: 2 issues found (E4, E5)
- Test Review: diagram produced, 0 gaps left after T1 to T4
- Performance Review: 0 issues found
- NOT in scope: written (plus copy link, TODO)
- What already exists: written
- TODOS.md updates: 1 item proposed, added (Copy a link's address from a card)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0
- Outside voice: codex, skipped (owner rule: Codex for adversarial passes only)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 2/2 (eng D2 and eng D3 picked the 10/10 option)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | |
| Outside Review | codex, from `/plan-eng-review` | Independent 2nd opinion | 0 | skipped | owner rule: Codex for adversarial passes only |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 5 issues, 0 critical gaps (all resolved: 2 approved, 3 corrected) |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score: 3/10 → 9/10, 5 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | |

- **OUTSIDE COVERAGE:** codex, plan-review phase, skipped by owner rule (Codex is kept for the adversarial pass at ship). No native stand-in.
- **VERDICT:** DESIGN CLEARED. ENG REVIEW COMPLETE with every finding resolved in the plan; logged as issues_open because findings were found (mapped work, not open questions). Ready to implement.

NO UNRESOLVED DECISIONS
