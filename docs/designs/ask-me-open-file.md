# Ask me: open the file a question points at

Owner, 2026-10-04: "when a ask me card talk about storing a file locally for analysis
or review show an option to open the file as it is not a good experience for user to
manually find that path."

## The problem

An Ask me question often asks the owner to read or work through a file a team member
saved, and names it only as text: `Quality/HubSpot cleanup checklist for owner
2026-10-04.md`. The owner has to know which folder that path is relative to, open
Finder, and walk there.

How often: 30 of the 80 questions in the reference office's ledger name a file (26 Markdown,
4 Excel, 1 JSON). 28 of 31 paths resolve under the office folder (`businessFolder`);
the other 3 are relative to the raising team member's own folder.

## The design (decided in review, 2026-10-04)

### What the owner sees (open card)

```
+------------------------------------------------------------+
| HubSpot cleanup: duplicate companies and contacts, junk... |  title (t-ui 600, 13)
| (Creed)  13h ago                                       ^   |  person chip, age, chevron
|                                                            |
| **Say "done" once you've worked through the HubSpot...**   |  the question, markdown
| It's `Quality/HubSpot cleanup checklist ...md`: 29 ...     |  (unchanged; the path
|  1. Done, recheck                                          |   stays as Michael wrote it)
|  2. Not yet, I'll do it later                              |
| ---------------------------------------------------------- |  hairline (line)
| [doc] HubSpot cleanup checklist for owner...  Markdown [Open] |  one row per named file
| ---------------------------------------------------------- |  hairline (line)
| [ Your answer, or done if you handled it ]        [Reply]  |
| ---------------------------------------------------------- |
| See full context   4 earlier answers                       |
+------------------------------------------------------------+
```

Order: title, who and when, the question, its files, the reply, the footer. The file
rows sit between the question they belong to and the answer, because the owner works
through the file and then replies.

- **Superseded 2026-10-10** for D1 and D2 by `docs/designs/open-file-tab.md`: files are chips in place of the path, and readable kinds open as an office tab.
- **D1 What Open does.** A document opens in the owner's default app: `md`, `markdown`,
  `txt`, `csv`, `tsv`, `xlsx`, `docx`, `pptx`, `pdf`, `png`, `jpg`, `jpeg`, `gif`,
  `webp` (eng R2: `xls` only shows in Finder). Only when `safeResolve` (src/main/fs.ts)
  places it inside the office folder (`businessFolder ?? legacyBusinessFolder(officeFolder)`,
  as src/main/index.ts:1882) or a team member's folder (registry `cwd`, eng R3), and the
  CANONICAL path it returns is a regular file whose own extension is on the list. Any
  other type, a folder, or a file outside those folders is shown in Finder with
  `showItemInFolder`, never `openPath` (eng R4). The list lives in
  `src/shared/askFiles.ts`; main enforces it and never trusts the renderer's verdict.
- **D2 Where.** A file row under the question (mockup A2), not a link inside the text.
  One row per distinct file named in the question, in the order it appears.
- **D5 Row chrome.** Plain rows between `line` hairlines, like the card footer and the
  "Holding up N tasks" list: no fill, ring or radius of their own.
- **D6 Parts.** Row: 16 px outline icon (`ink-3`), the file name without its folder or
  extension (12, `ink`, one line, ellipsis, full path as the tooltip), its kind (11,
  `ink-3`: Markdown, Text, CSV, Excel, Word, PowerPoint, PDF, Image, File), and a
  `PixelButton` variant `secondary`, size `sm` (28 px). `Icon.tsx` gains `file` (Lucide
  file-text) and `sheet` (Lucide sheet, for csv and Excel); 1.75 stroke at 16 px,
  `currentColor`.
- **D7 Folded cards** stay exactly as they are: no file mark. Rows show only on the open
  card.
- **D8 Task detail.** The same row component appears under each question in the Task
  detail question trail (`TasksKanban`), so a question opens its files the same way on
  Ask me and in its history.

### Which text is a file

An inline code span in the question that ends in a known file extension (eng R1): `md`,
`markdown`, `txt`, `csv`, `tsv`, `xlsx`, `xls`, `docx`, `pptx`, `pdf`, `png`, `jpg`,
`jpeg`, `gif`, `webp`, `json` or `zip`, case insensitive, with no `@` and not starting
with `$` (`Quality/HubSpot cleanup checklist for owner 2026-10-04.md`). On the ledger
this finds 20 paths and 19 resolve; amounts, emails and domains never match. Resolved
in main, first match wins: an absolute or `~` path as is; else relative to the office
folder; else the raising team member's folder (`raisedBy`); else the card assignee's
folder. Duplicates collapse to one row.

### States (D3, D4)

```
  ROW STATE            | WHAT THE OWNER SEES
  ---------------------|------------------------------------------------------------
  Checking (first ms)  | Name, kind and the button from the text alone; the button is
                       | disabled until the check returns, so nothing jumps in or out
  Openable             | [Open]
  Reveal only          | [Show in Finder]: other types, or outside the office folders
  Not found            | Name in ink-3, "Not found" as quiet text (no button, not a
                       | tab stop): the question still says it named a file
  Open failed          | Falls back to Show in Finder, no error text
  No files named       | No rows, no divider: the card is exactly today's card
```

### Journey

```
  STEP | OWNER DOES                         | FEELS                 | PLAN SPECIFIES
  -----|------------------------------------|-----------------------|-----------------------------
  1    | Opens the HubSpot card             | "what do I need to do" | question first, file right under it
  2    | Sees "HubSpot cleanup checklist,    | "that's the thing"    | readable name, kind word
       | Markdown, Open"                    |                       |
  3    | Clicks Open                        | relief, no hunting    | opens in their own Markdown app
  4    | Works the checklist in HubSpot     | focused               | card stays as it was, draft kept
  5    | Comes back, types "done", Reply    | finished              | unchanged reply flow
  alt  | File moved: row says Not found     | informed, not stuck   | they say so in the reply
```

5 seconds: the file is a visible thing, not a code span. 5 minutes: one click, their
own app. Long run: questions about files stop meaning a trip through Finder.

### Accessibility and layout

- Each button has an `aria-label` with the action and the name ("Open HubSpot cleanup
  checklist for owner 2026-10-04", "Show HubSpot ... in Finder"); rows sit in a
  `role="list"` labelled "Files in this question".
- Focus: the 2 px `indigo` ring with 2 px offset (PixelButton). Tab order: question,
  file buttons in order, answer field, Reply, footer links. A Not found row is not a
  tab stop.
- Name with `dir="auto"` and a bidi isolate around the path tooltip (DESIGN.md 12).
  Logical properties, so the row mirrors in Arabic.
- Narrow column: the name ellipsizes first; the kind word and the button never wrap.

## What already exists

- `AskMeTab.tsx` renders the question with `MarkdownPreview`; paths arrive as inline
  code spans, written that way by Michael's ask rules ("put paths ... in backticks").
- `fs:statAbs` and `fs:revealPath` (`src/main/index.ts:3948`): stat a path, reveal a
  file in Finder. The reveal only rule there stays for every other caller.
- Terminal Cmd-click on a path (`terminalPool.ts activatePath`): the in-app IDE when
  `SHOW_IDE`, else Finder. `SHOW_IDE` is false in this build.
- `PixelButton` (sizes sm 28, md 32, lg 36), `Icon.tsx` outline set, the card's
  hairline footer and the "Holding up N tasks" rows.
- DESIGN.md 7.8 already allows secondary actions on an Ask me card.

## NOT in scope

- An in-app reader for Markdown (D1 option C): a new panel; the owner's own apps are
  enough for now.
- Making the path inside the question a link too (D2 option C): two controls for one
  action.
- A file mark on folded cards (D7).
- Files the owner should attach or upload: this is only for files the team saved.

## Eng review notes

Resolved in the eng review below: `xls` only shows in Finder (R2); `doc`, `docm`,
`xlsm` and `pptm` stay off the open list; the folder check is `safeResolve` on roots
main reads itself, judged on the canonical path (finding 2); Show in Finder never
calls `openPath` on a folder (R4).

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|----------------|-------------|-----------|-------|
| Ask me open card, file row | askme-open-file.html (local HTML/CSS mockup, not in the repo) | Variant A2: plain rows between hairlines under the question | HTML/CSS mockup (owner rule: no image generator); build with PixelButton sm and Icon.tsx, not the mockup's inline button |
| Missing file state | same file, variant C | "Not found" quiet row | row chrome per A2 |

## Implementation Tasks
Synthesized from the design and eng review findings. Each task derives from a
specific finding. Effort ratio assumed: features ~30x, tests ~50x, bug fix ~20x.

- [x] **T1 (P1, human: ~4h / CC: ~10min)** — shared — `src/shared/askFiles.ts`: the extension tables and detection
  - Surfaced by: eng R1 (known endings), R2 (xls reveal), design D6 (kind words)
  - Exports: `askFilePaths(questionMarkdown)` (code spans with a known ending, no `@`, not `$`, deduped, in order), `OPEN_EXTENSIONS` (no xls), `kindOf(path)`
  - Verify: table test with the 20 real ledger paths matching and `$1,234.50`, `billing@example.com`, `example-client.com`, `29`, `Example.IT` not matching
- [x] **T2 (P1, human: ~4h / CC: ~10min)** — main — `fs:askFiles` (check) and `fs:openAskFile` (act)
  - Surfaced by: design D1, D3, D4; eng finding 2 (safeResolve, canonical path), R3 (roots), finding 6 (office folder resolver)
  - Takes the path text and the raiser and assignee ids; roots computed in main from `businessFolder ?? legacyBusinessFolder(officeFolder)` and registry cwds (mark `gstack-shortcut(dec-150d1c26-a7b6-4411-b059-faad20888603)` on the roots list); returns `open | reveal | missing` per path; act re-runs the check, then `shell.openPath` for `open`, `showItemInFolder` otherwise or when openPath returns an error
  - Files: `src/main/fs.ts` (next to safeResolve), `src/main/index.ts`, `src/preload/index.ts`
  - Verify: unit tests in `test/ask-files.test.cjs` (see Test review)
- [x] **T3 (P1, human: ~1h / CC: ~5min)** — main — bundle reveal fix in `fs:revealPath`
  - Surfaced by: eng R4. A directory whose name has an extension is revealed with `showItemInFolder`, never `openPath`
  - Files: `src/main/index.ts:3967`
  - Verify: test with a fake `Tool.app` folder: revealPath never calls openPath
- [x] **T4 (P1, human: ~4h / CC: ~10min)** — renderer — `AskFileRows` on the open Ask me card
  - Surfaced by: design D2, D3, D4, D5, D6. One `fs:askFiles` call per card, cached per card while it is open
  - Files: `src/renderer/src/components/AskFileRows.tsx`, `AskMeTab.tsx`, `Icon.tsx` (`file`, `sheet`), locales en, zh-CN, ar
  - Verify: source pins for placement, labels and aria; manual: open the HubSpot card in the app and click Open
- [x] **T5 (P2, human: ~1h / CC: ~5min)** — renderer — rows in Task detail
  - Surfaced by: design D8
  - Files: `src/renderer/src/components/TasksKanban.tsx`
- [x] **T6 (P2, human: ~30min / CC: ~5min)** — docs — DESIGN.md 7.8 and 10; `docs/FEATURES.md` on land
  - Surfaced by: design D2, D6

## Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | DESIGN.md present (7.8, 10, 12); UI scope:  |
  |                      | Ask me card, Task detail, main IPC          |
  | Step 0               | 2/10; all 7 passes (no focus narrowing)     |
  | Pass 1  (Info Arch)  | 3/10 → 9/10 after fixes (D2, D7)            |
  | Pass 2  (States)     | 2/10 → 9/10 after fixes (D3, D4)            |
  | Pass 3  (Journey)    | 4/10 → 9/10 (storyboard from D1 to D4)      |
  | Pass 4  (AI Slop)    | 6/10 → 9/10 after fixes (D5, nested card)   |
  | Pass 5  (Design Sys) | 5/10 → 9/10 after fixes (D6)                |
  | Pass 6  (Responsive) | 5/10 → 9/10 (DESIGN.md 12 applied, 28 px)   |
  | Pass 7  (Decisions)  | 2 resolved (D7, D8), 0 deferred             |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (4 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 1 HTML mockup (4 variants), A2 approved     |
  | Decisions made       | 8 added to plan                             |
  | Decisions deferred   | 0                                           |
  | Overall design score | 2/10 → 9/10                                 |
  +====================================================================+
```

Pass 4 classifier: OPERATE (app UI). No hard rejections after D5 removed the nested
box. Litmus: one visual anchor (the question) yes; scannable by headings yes; each part
one job yes; card necessary yes (the existing Ask me card); premium without shadows yes.

Outside voices: skipped. The owner's rule keeps Codex to the adversarial pass only.

## Eng review (2026-10-04)

Target: `docs/designs/ask-me-open-file.md` (this file). Focus: the D1 open allowlist,
symlink and folder confinement.

Scope record: feature answers: none proposed; structure: original arrangement (owner
rule: no file or module layout questions); accepted scope: the design above, D1 to D8;
pending remedies: R1, R2, R3.

Scope Challenge findings:

1. [P1] (confidence: 10/10) docs/designs/ask-me-open-file.md "Which text is a file":
   "Code spans that are amounts or ids (`29`, `$1,234.50`) never match" is false.
   The rule "ends in a dot and 1 to 5 letters or digits" matches `$1,234.50` (".50").
   Replayed on the ledger: 54 code spans match, 37 are not files (16 dollar amounts,
   emails such as `billing@example.com`, domains such as `example-client.com`). Each would
   show a Not found row. Decision R1.
2. [P1] (confidence: 9/10) src/main/fs.ts:101 `safeResolve(root, rel)` is "exactly one
   path-escape policy in the app": canonical path, refuses links that leave the root
   and dangling links, fails closed. `statAbs` (fs.ts:357) does no confinement. The
   plan's folder check must be `safeResolve`, and the allowlist and isFile check must
   run on the CANONICAL path it returns, so an in-folder link named `notes.md` that
   points at `Tool.app` is judged as `.app` and only revealed. Implementation of the
   approved D1 guarantee; no new choice.
3. [P2] (confidence: 8/10) D1 keeps `xls`, which can carry macros; 0 of 31 real paths
   are `xls`. Decision R2.
4. [P2] (confidence: 8/10) D1 allows "a team member's folder (registry cwd)" as a
   root. `cwdValidity` (src/main/hive.ts:890) only requires an existing absolute
   directory, so a team member working in a home folder would make every PDF there
   openable. All 11 reference office folders are inside the office folder. Decision R3.

## Decision ledger

### R1: which code spans count as a file
Finding: 1, P1, 10/10, plan "Which text is a file", Claude eng review
Plan baseline: a code span ending in a dot and 1 to 5 letters or digits (design review, unapproved detail)
Runtime evidence: ledger replay, 54 matches, 17 resolve, 37 not files; known extension rule: 20 matches, 19 resolve (miss: `fleet.json`, a hive file)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 detection | dot plus 1 to 5 letters or digits | known extension list, no `@`, not starting `$` | current rule minus spans with `@`, a leading `$` or an all digit ending |
| R2 xls opens | approved D1: opens | pending | pending |
| R3 roots | approved D1: office or team folder | pending | pending |
Question D1:
D1 — Which code spans in a question count as a file? <gstack-qid:plan-eng-review-file-detection>
Project/branch/task: main, docs/designs/ask-me-open-file.md, Ask me file rows.
ELI10: Michael puts paths in code formatting, but also amounts and email addresses. The plan's rule ("ends in a dot and a short ending") catches `$1,234.50` and `billing@example.com` too. Replayed on your real questions it found 54 matches, and 37 of them are money, emails or web domains, each of which would show a Not found row on the card.
Stakes if we pick wrong: Ask me cards fill with Not found rows for dollar amounts and email addresses.
Recommendation: A because a short list of real file endings found 20 paths in your questions and 19 of them open, with no money or email noise.
Completeness: A=9/10, B=6/10
Pros / cons:
A) Known file endings only (recommended) (human: ~1h / CC: ~5 min)
  ✅ Only md, txt, csv, tsv, xlsx, xls, docx, pptx, pdf, images, json and zip count as files
  ✅ On your ledger: 20 matches, 19 resolve; money, emails and domains never match
  ❌ A file with any other ending (a .py script, a .key deck) gets no row and stays as text
B) Plan rule with exclusions (human: ~1h / CC: ~5 min)
  ✅ Any file ending counts, so unusual file types still get a row
  ✅ Spans with @, a leading $ or a number ending are skipped
  ❌ Domains like `example-client.com` and `enrichment.ai` still show as Not found rows
Net: a clean list of real files (A) versus catching rare file types at the cost of noise (B).
Header: Detection
Options:
A) Known file endings (recommended)
Only code spans ending in md, markdown, txt, csv, tsv, xlsx, xls, docx, pptx, pdf, png, jpg, jpeg, gif, webp, json or zip, with no @ and not starting with $, become file rows. One shared list in src/shared/askFiles.ts; main decides open or reveal.
B) Plan rule with exclusions
Any span ending in a dot and 1 to 5 letters or digits, except spans containing @, starting with $, or ending in digits only.

State: approved
Actual answer: A) Known file endings (eng review D1, 2026-10-04)
Accepted scope: only code spans ending in md, markdown, txt, csv, tsv, xlsx, xls, docx, pptx, pdf, png, jpg, jpeg, gif, webp, json or zip, with no @ and not starting with $, become file rows; one shared list in src/shared/askFiles.ts; main decides open or reveal
History: none

### R2: does xls open or only reveal
Finding: 3, P2, 8/10, plan D1 open list, Claude eng review
Plan baseline: approved D1 (design review D1 answer): xls opens in the default app
Runtime evidence: 0 of 31 ledger paths are xls; 4 are xlsx
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 xls | opens (D1) | Show in Finder | opens (D1) |
| R1 detection | approved R1 A: known endings | approved R1 A, unchanged | approved R1 A, unchanged |
| R3 roots | approved D1: office or team folder | pending | pending |
Question D2:
D2 — Should old Excel files (.xls) open, or only show in Finder? <gstack-qid:plan-eng-review-xls-open>
Project/branch/task: main, docs/designs/ask-me-open-file.md, the D1 open list.
ELI10: Modern Excel files (.xlsx) cannot hold macros, the small programs that run inside a spreadsheet. The older .xls format can. Excel on a Mac asks before running them, but the point of the open list is that no Office format on it can carry macros. None of your 31 real file paths is .xls; four are .xlsx.
Stakes if we pick wrong: either an old spreadsheet an agent saved opens with macros one prompt away, or you click Show in Finder for a format nobody uses.
Recommendation: A because .xls costs you nothing today and is the only Office format on the list that can carry macros.
Completeness: A=9/10, B=8/10
Pros / cons:
A) .xls shows in Finder (recommended)
  ✅ Every Office format on the open list is one that cannot carry macros
  ✅ Nothing changes for your real files: all four spreadsheets are .xlsx
  ❌ An old .xls an agent saves needs one more click, from Finder
B) Keep .xls on the open list (approved D1)
  ✅ Old spreadsheets open in one click like new ones
  ✅ No change to the design review's answer
  ❌ The open list includes one format that can carry macros, behind Excel's prompt
Net: a list with no macro formats (A) versus one click for a format you don't use (B).
Header: Old Excel
Options:
A) .xls shows in Finder (recommended)
Remove xls from the open list; an .xls row says Show in Finder. xlsx, docx and pptx still open.
B) Keep .xls opening
Keep the approved D1 list unchanged, xls included.

State: approved
Actual answer: A) .xls shows in Finder (eng review D2, 2026-10-04)
Accepted scope: xls removed from the open list; an .xls row says Show in Finder; xlsx, docx and pptx still open
History: design review D1 approved xls on the open list; reopened for the macro risk (finding 3)

### R3: which folders can a file open from
Finding: 4, P2, 8/10, plan D1 "inside the office folder or a team member's folder", src/main/hive.ts:890
Plan baseline: approved D1: office folder or any team member's folder (registry cwd)
Runtime evidence: all 11 reference office team folders are inside the office folder; cwdValidity accepts any existing absolute directory
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 roots | office or any team folder (D1) | office folder only; team folders only as places to look up a relative path | office or any team folder (D1) |
| R1 detection | approved R1 A: known endings | approved R1 A, unchanged | approved R1 A, unchanged |
| R2 xls | approved R2 A: Show in Finder | approved R2 A, unchanged | approved R2 A, unchanged |
Question D3:
D3 — Should Open be limited to files inside the office folder? <gstack-qid:plan-eng-review-open-roots>
Project/branch/task: main, docs/designs/ask-me-open-file.md, the D1 folder check.
ELI10: D1 lets Open work inside the office folder or inside any team member's own folder. Today every team member's folder is inside your office folder, so the two are the same. But the app lets a team member work in any folder, even your home folder, and then every PDF or Word file there would open in one click from a question.
Stakes if we pick wrong: on another office, one team member set up in a home folder turns Open into a key to every document in it.
Recommendation: A because it changes nothing for your office and keeps Open inside the business's own files everywhere.
Completeness: A=9/10, B=7/10
Pros / cons:
A) Office folder only (recommended)
  ✅ Open never reaches outside the business folder, on any install
  ✅ Team folders still help find a relative path, as long as they sit inside it
  ❌ A team member working outside the office folder gets Show in Finder, not Open
B) Office or any team folder (approved D1)
  ✅ Files in a team member's own folder open wherever that folder lives
  ✅ No change to the design review's answer
  ❌ A team folder like a home folder widens Open to everything in it
Net: one fixed boundary (A) versus following wherever team members work (B).
Header: Open folders
Options:
A) Office folder only (recommended)
Open only when safeResolve places the file inside the office folder; team folders are used to look up a relative path but never widen the boundary. Anything else shows in Finder.
B) Office or any team folder
Keep D1: safeResolve against the office folder and every team member's registry folder.

State: approved
Actual answer: B) Office or any team folder (eng review D3, 2026-10-04)
Accepted scope: no change to D1: safeResolve against the office folder and every team member's registry folder. Accepted shortcut dec-150d1c26-a7b6-4411-b059-faad20888603: mark the roots list in code with `gstack-shortcut(dec-150d1c26-a7b6-4411-b059-faad20888603): a team folder outside the office folder widens Open, upgrade when any team folder sits outside businessFolder or an outside user onboards`
History: none

### R4: a revealed app bundle launches (existing fs:revealPath)
Finding: 5, P1, 9/10, src/main/index.ts:3967-3978, Claude eng review
Plan baseline: Show in Finder for anything not openable (design D1, D4); the existing handler is `if (st.isFile) { shell.showItemInFolder(st.path); return { ok: true }; } const err = await shell.openPath(st.path);`, justified by "a directory has no default application to launch"
Runtime evidence: on macOS an app is a directory (`Tool.app`); `shell.openPath` on it goes through LaunchServices and launches it. Terminal Cmd-click on an agent printed `Tool.app` path reaches this branch today. Not probed live.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R4 bundle reveal | openPath on any directory | TODOS.md entry only | no change | build now: a directory whose name has an extension (a bundle) is revealed with showItemInFolder, never openPath; Ask me rows never call openPath on a directory |
| R1, R2, R3 | approved | unchanged | unchanged | unchanged |
Question D4:
D4 — Fix the existing Show in Finder path that can launch an app, in this change? <gstack-qid:plan-eng-review-todo-bundle-reveal>
Project/branch/task: main, src/main/index.ts:3967 fs:revealPath, used by terminal Cmd-click and planned for the Ask me fallback.
ELI10: To show a folder, the app "opens" it, on the idea that a folder has no app to launch. On a Mac an app is a folder with a name ending in .app, so "showing" an agent printed `Tool.app` actually starts it. That breaks the very rule this feature relies on: paths agents write are only shown, never run.
Stakes if we pick wrong: an agent (or a customer email it quotes) prints a path to an app, you Cmd-click it in a terminal or hit Show in Finder, and the app runs.
Recommendation: C because the fix is a few lines in the handler this feature reuses, and leaving it means Show in Finder is not safe.
Completeness: A=5/10, B=3/10, C=10/10
Pros / cons:
A) Add to TODOS.md
  ✅ Keeps this change to the Ask me feature only
  ✅ The bug is written down with its context for later
  ❌ Ships Show in Finder on top of a handler that can launch an app
B) Skip
  ✅ No extra work in this change
  ✅ Terminal behavior stays exactly as it is today
  ❌ A known way for an agent printed path to launch an app stays open
C) Build it now (recommended) (human: ~1h / CC: ~5 min)
  ✅ A bundle (any folder whose name has an extension) is shown in Finder, never opened
  ✅ Fixes terminal Cmd-click too, with a test for a fake Tool.app folder
  ❌ Touches the existing terminal reveal path, so its tests need a new row
Net: fix the launch hole while we're in the handler (C) versus park it (A) or leave it (B).
Header: App reveal
Options:
A) Add to TODOS.md
Write a TODOS.md entry for the fs:revealPath bundle launch; no code change in this plan.
B) Skip
No entry, no change.
C) Build it now (recommended)
In fs:revealPath, reveal a directory whose name has an extension with showItemInFolder instead of openPath; Ask me rows reveal through showItemInFolder only; add a test with a fake Tool.app folder.

State: approved
Actual answer: C) Build it now (eng review D4, 2026-10-04)
Accepted scope: in fs:revealPath, a directory whose name has an extension is revealed with showItemInFolder instead of openPath; Ask me rows reveal through showItemInFolder only; a test with a fake Tool.app folder
History: none

Approval readiness: PASS (R1 D1 A, R2 D2 A, R3 D3 B with shortcut dec-150d1c26-a7b6-4411-b059-faad20888603, R4 D4 C; findings 2, 6 and 7 are implementation of approved D1 and need no answer)

## Eng review sections

### 1. Architecture

```
 renderer (Ask me open card / Task detail)              main
 ------------------------------------------              -----------------------------------
 question markdown
   └─ askFilePaths()  (shared, R1)  ── paths[] ──────▶ fs:askFiles(paths, raiser, assignee)
                                                          for each path:
                                                            roots = office folder, then raiser
                                                                    and assignee registry cwd (R3)
                                                            abs/~ path → relative to each root
                                                            safeResolve(root, rel)  (fs.ts:101)
                                                              null ──────────────▶ exists? reveal : missing
                                                              canonical path
                                                                ├─ not a regular file ▶ reveal
                                                                ├─ ext in OPEN (R2) ─▶ open
                                                                └─ otherwise ────────▶ reveal
 rows: Open | Show in Finder | Not found  ◀── verdicts ──┘
 click ───────────────────────────────────────────────▶ fs:openAskFile(path, raiser, assignee)
                                                          re-run the same check (never trust
                                                          the renderer's verdict)
                                                            open   → shell.openPath; error → reveal
                                                            reveal → showItemInFolder (R4)
```

- [P2] (confidence: 8/10) src/main/index.ts:1882 `const folder = cfg.businessFolder ?? legacyBusinessFolder(cfg.officeFolder);`: the office folder must come from this same resolver, not `cfg.businessFolder` alone, or an older config has no root and every row reveals. Finding 6; implementation of D1.
- [P3] (confidence: 7/10) Check then open is not atomic: an agent could swap the file between the check and `openPath`. Agents already run shell commands as the owner, so this adds no capability; the real threat is a path quoted from outside content, which the allowlist and confinement cover. Recorded as accepted risk, no task.
- Realistic failure: a Dropbox online only file. `stat` works and `openPath` triggers the download; no special handling.

Dispositions: finding 2 accepted under D1; finding 6 accepted under D1; P3 TOCTOU recorded as accepted risk.

### 2. Code quality

- [P2] (confidence: 8/10) One extension table for both sides: the renderer needs it for detection and the kind word, main for enforcement. `src/shared/askFiles.ts` holds it; main imports it (main already imports `../shared/*`). Finding 7; implementation of R1.
- Error handling: `openPath` resolves to an error string, not a throw; empty string means success. Non empty falls back to reveal (D4).
- Edge cases covered by the check: `~` paths (expandTilde), `..` (safeResolve refuses), uppercase extensions, a folder named `x.pdf` (not a regular file, reveal), duplicates (one row).

Dispositions: finding 7 accepted under R1. No other issues.

### 3. Test review

Framework: node:test, `test/*.test.cjs` with `test/load-ts.cjs` (package.json `test:focused`).

```
CODE PATHS                                                    USER FLOWS
[+] src/shared/askFiles.ts                                    [+] Open a checklist from Ask me
  ├── askFilePaths()                                            ├── [GAP] Markdown in office folder → Open → default app (manual)
  │   ├── [GAP] known endings match (20 real paths)             ├── [GAP] Moved file → Not found, no button
  │   ├── [GAP] money, emails, domains, ids never match         └── [GAP] JSON path → Show in Finder
  │   └── [GAP] duplicates collapse, order kept               [+] Task detail
  └── kindOf() [GAP] Markdown / Excel / File words              └── [GAP] old question with a file shows its row
[+] src/main/fs.ts askFiles / openAskFile                     [+] Terminal Cmd-click (existing)
  ├── [GAP] md in office folder → open                          └── [GAP] [regression] Tool.app → revealed, not launched
  ├── [GAP] relative path found via raiser folder
  ├── [GAP] xls → reveal (R2)
  ├── [GAP] .app / .command / unknown ending → reveal
  ├── [GAP] in folder link notes.md → Tool.app → reveal (canonical ext)
  ├── [GAP] link leaving the office folder → reveal or missing, never open
  ├── [GAP] dangling link → missing
  ├── [GAP] ../ escape → never open
  ├── [GAP] folder named x.pdf → reveal
  ├── [GAP] openPath error → reveal
  └── [GAP] act re-checks: a path the renderer calls open but is outside → reveal
[+] src/main/index.ts fs:revealPath
  └── [GAP] directory with an extension → showItemInFolder (R4)

COVERAGE: 0/22 paths tested today (new code)  |  QUALITY: all planned ★★★ (behavior + edge + error)
```

Required tests (proof of approved D1 to D8 and R1 to R4):
- `test/ask-files.test.cjs` (unit, table driven): detection table; every main branch above on a temp office folder with real symlinks; `shell` injected through the module's existing Electron import seam used by other main tests, else assert the verdict function and keep `openPath` behind a one line wrapper. Value: protects=an agent named path opens only allowlisted files inside the office folders; fails_when=the canonical ext check, safeResolve or the allowlist is dropped; why_new=no test covers opening agent paths; seam=none
- `test/reveal-bundle.test.cjs` (unit): fake `Tool.app` directory never reaches openPath. Value: protects=an agent printed app path is shown, never launched; fails_when=revealPath goes back to openPath for directories; why_new=fs:revealPath has no directory test; seam=none
- Extend `test/askme-card.test.cjs`: rows sit between the question and the reply, aria labels, Not found has no button. Value: protects=D2 placement and D3 state; fails_when=rows move into the question or Not found gets a button; why_new=new UI; seam=none

Regression contract (carried from design D2: the question renders as Michael wrote it): `askme-card`, `askme-order` and `ask-me-routing` tests stay green unchanged.

Tests made obsolete: none.

### 4. Performance

One `fs:askFiles` call per open card with 1 to 3 paths (20 paths across 80 questions in the ledger); results cached per card while open, so the 5 s Needs you poll causes no new IPC. Task detail checks every question's paths once on open (at most a few dozen stats). No issues.

### Failure modes

| Path | Realistic failure | Test | Handling | User sees |
|---|---|---|---|---|
| detection | money or email read as a file | T1 table | known endings only | no row |
| check | file moved | missing row test | verdict missing | Not found |
| check | link escapes the folder | symlink test | safeResolve null | Show in Finder |
| act | openPath error (no default app) | error test | fall back to reveal | Finder window |
| reveal | path is an app bundle | Tool.app test | showItemInFolder | Finder window, nothing runs |

Critical gaps: 0 (every failure has a planned test and visible handling).

### Outside voice

Skipped: the owner's standing rule keeps Codex to the adversarial pass only, with no Claude subagent fallback.

### NOT in scope (eng)

- Atomic check and open (TOCTOU): agents already have a shell; recorded as accepted risk.
- Restricting team folders to inside the office folder: owner chose to keep D1 (R3, shortcut dec-150d1c26-a7b6-4411-b059-faad20888603).

### What already exists (eng)

- `safeResolve` and `canonicalize` (src/main/fs.ts:33, :101): reused as the folder check.
- `statAbs`, `expandTilde`: reused for `~` paths; statAbs alone is not a confinement check.
- `legacyBusinessFolder` resolver (src/main/index.ts:1882): reused for the office folder.

### Worktree parallelization strategy

| Step | Modules touched | Depends on |
|------|----------------|------------|
| T1 shared detection | src/shared | — |
| T2 main check and act | src/main, src/preload | T1 |
| T3 bundle reveal fix | src/main | — |
| T4, T5 renderer rows | src/renderer | T1, T2 (IPC shape) |
| T6 docs | branding, docs | T4 |

Lane A: T1 → T2 → T4 → T5 → T6. Lane B: T3 (independent, but shares src/main/index.ts with T2: merge B first or sequence). Execution: launch A and B; merge B; finish A. Conflict flag: src/main/index.ts.

### Eng completion summary

- Step 0: Scope Challenge — scope accepted as-is
- Architecture Review: 2 issues found (finding 6 office folder resolver, P3 TOCTOU accepted risk)
- Code Quality Review: 1 issue found (finding 7 shared table)
- Test Review: diagram produced, 22 gaps identified (all new code, all planned)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to user (R4), built now
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, skipped (owner rule: Codex adversarial only)
- Parallelization: 2 lanes, 1 parallel / 4 sequential
- Lake Score: 3/4 answers picked the 10/10 option (R3 took B)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 2 | not run for this plan | — |
| Outside Review | codex plan review | Independent 2nd opinion | 8 | skipped (owner rule: Codex adversarial only) | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 6 | issues_open (mapped to tasks) | 3 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 10 | clean | score: 2/10 → 9/10, 8 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review and design phases, skipped by the owner's standing rule; no outside findings.
- **VERDICT:** DESIGN CLEARED. Eng review complete with 3 issues mapped to tasks T1 to T3 and 0 unresolved decisions; eng review required (status issues_open until the tasks land).

NO UNRESOLVED DECISIONS
