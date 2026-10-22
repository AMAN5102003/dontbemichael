# Open a file Michael names, in a tab inside the office

Owner, 2026-10-10 (screenshot of Michael's dock reply "Full report:
/Users/.../IT/it-mail-report-2026-10-10.md"): when a response has a file path,
show the Open option instead of the bare path; Open opens the file as a new tab
inside the office app, next to "Who talks to whom". Same behavior on Ask me cards.

Status: CEO review complete (mode SELECTIVE EXPANSION). R1 to R4, E1, E3, E4, E4b
approved; E2, E5 declined (see ledger).

## 0A. Premise

- **Real problem:** Michael finishes work by pointing at a saved file. The owner
  sees a long path wrapped over two lines, can't click it, and has to copy it
  into Finder. The report Michael wrote is the deliverable, and it is the
  hardest thing on screen to reach.
- **Why today's rows don't help:** Ask me file rows exist (`AskFileRows`, design
  `docs/designs/ask-me-open-file.md`) and are already mounted under every dock
  reply (`MichaelDock.tsx:320`), but `askFilePaths` (`src/shared/askFiles.ts`)
  only reads backtick code spans. The screenshot's path is plain text, so no
  row shows.
- **Second gap:** Open hands the file to the default app (D1 of 2026-10-04). The
  owner wants to read it without leaving the office.
- **Do nothing:** every report Michael writes stays a copy and paste into Finder.

## 0B. Existing code to reuse

| Sub-problem | Reuse |
|---|---|
| Which files a question names | `askFilePaths`, `isFileSpan`, `DETECT_EXTENSIONS`, `kindOf`, `fileTitle` (`src/shared/askFiles.ts`) |
| May this path be opened | `askFileVerdict` + `askFileRootsFor` (`src/main/fs.ts:391-475`): office folder, raiser's and team folders, `safeResolve` (realpath, containment, no symlinks) |
| Rows under the question | `AskFileRows` (dock, Ask me tab, Task detail) |
| Rendering Markdown | `MarkdownPreview` (`src/renderer/src/markdown/MarkdownPreview.tsx`), with `onOpenMarkdownLink` for relative `.md` links |
| Images | the `fs:readBinary` blob pattern (`ImagePreview` in `src/renderer/src/ide`) |
| Text read caps | `readFileText` 2 MB, `readFileBinary` 10 MB (`src/main`) |
| View tabs | `ViewTabs` (`shell/TopBar.tsx:93`), `FloorView` + `setFloorView` (`store/store.ts:448,1309`), the view overlay (`App.tsx:464`) |

No rebuild: the IDE panel can show files but is off in this build
(`SHOW_IDE = false`), and turning it on brings Monaco, git and a file tree the
owner did not ask for.

## 0C. Dream state

```
  CURRENT                         THIS PLAN                         12-MONTH IDEAL
  Path as plain text; rows only   Any path Michael names opens      Michael's work products are
  for backticked paths; Open      in an office tab next to Who      first-class: every report, sheet
  launches the default app        talks to whom, on the dock and    and draft opens in the office,
                                  on Ask me cards                   stays fresh, and links to the
                                                                    task that made it
```

## Decision ledger

| ID and owner | Contract and evidence | Current | Proposed | Status | Exact approval and scope |
|---|---|---|---|---|---|
| R1 detection (askFiles.ts) | Screenshot path is plain text; eng R1 2026-10-04 rejected loose span rules (37 of 54 false hits) | backtick spans with a known extension | backtick spans, plus plain absolute paths (`/`, `~/`, `C:\`) and absolute Markdown link targets ending in a known extension; spaces only inside backticks | approved | D3 answer A (owner, 2026-10-10): detection rule only |
| R2 presentation (dock, Ask me) | Owner: "show the open option instead"; 2026-10-04 D2 chose a row, not a link in text | row under the text, path stays in text | the path in the text becomes an inline file chip (icon, file name, Open); no separate row; same on Ask me cards and Task detail | approved | D4 answer A (owner, 2026-10-10): presentation only; reverses 2026-10-04 D2 |
| R3 what a tab shows (new view) | Owner: open as a tab; MarkdownPreview and image blobs exist; no PDF or Office renderer | default app (D1) | Markdown, text, JSON, CSV/TSV and images open as an office tab; PDF, Word, Excel, PowerPoint keep opening in their app; inside a folder but not readable: Show in Finder; outside every folder: Not found | approved | D5 answer A (owner, 2026-10-10): tab kinds only; reverses 2026-10-04 D1 for readable kinds |
| R4 tab lifecycle (store, ViewTabs) | View tabs are a fixed list of three, persisted in `cth.floorView` | n/a | one closable tab per file after Who talks to whom; reopening selects it; at most 5, a sixth closes the oldest; not kept across restarts | approved | D6 answer A (owner, 2026-10-10): tab lifecycle only |
| E1 live refresh (main watcher, file view) | Michael rewrites reports in place | n/a | an open tab re-reads its file when it changes on disk; one watcher per open tab, stopped on close | approved | D7 answer A (owner, 2026-10-10): added to scope |
| E2 links inside an opened file (file view) | `MarkdownPreview` has `onOpenMarkdownLink` | n/a | links inside opened files stay inert | declined | D8 answer C (owner, 2026-10-10): skipped |
| E3 CSV/TSV as a table (file view) | CSV is a readable kind (R3) | n/a | CSV/TSV render as a table with a sticky header row, first 1,000 rows, a note when more | approved | D9 answer A (owner, 2026-10-10): added to scope |
| E4 Michael names files as backticked full paths (prompt) | R1 cuts a plain path at its first space | n/a | the conversation rule (hive.ts:328) says to name each file by its full path in backticks | approved | D10 answer A (owner, 2026-10-10): added to scope |
| E4b report rule backticks (hive.ts:332) | spec review 1: report rule asks for unbackticked paths | n/a | the Ask me report rule also says full paths in backticks | approved | D12 answer A (owner, 2026-10-10): added to scope |
| F1 right column beside a file tab (App.tsx columnShown) | Section 4: Tasks and graph hide the column (owner 2026-10-03); opening from Ask me would hide the card being answered | column hidden on non-office views | on a file tab the right column stays shown if it was open; opening the column while on a file tab stays on it (officeView skips 'file'); Tasks and Who talks to whom unchanged | approved | D14 answer A (owner, 2026-10-10): column visibility on file tabs only |
| E5 terminal path clicks open the tab (terminalPool.ts) | Cmd-click reveals in Finder while the IDE is hidden | n/a | terminal Cmd-click keeps showing in Finder | declined | D11 answer C (owner, 2026-10-10): skipped |

## 0G. Hold-scope checks

- **Complexity:** about 14 files (detector, chip, Markdown hook, dock, Ask me tab,
  Task detail, store, view tabs, App overlay, new file view, main IPC, preload,
  3 locales, DESIGN.md, tests). One new component (the file view) and three new
  IPC channels plus one event (`fs:readAskFile`, `fs:watchAskFile`, `fs:unwatchAskFile`,
  `fs:askFileChanged`). Every file carries part of the approved rows (R1 to R4, then E1, E3, E4, E4b); none can be dropped
  without dropping an approved behavior.
- **Minimum change:** reuse `askFileVerdict` for reads, `MarkdownPreview` for
  Markdown, the blob pattern for images; no IDE, no new dependency.
- **Invariants kept:** main never trusts the renderer's verdict; the office and
  team folders are the only readable roots; no `file:` URLs (CSP).


## Accepted scope (R1 to R4, E1, E3, E4, E4b)

### What the owner sees

```
 Michael's reply, before                        after
 ┌────────────────────────────────────┐         ┌────────────────────────────────────┐
 │ **Nick handled it...** Full report:│         │ **Nick handled it...** Full report:│
 │ /Users/.../IT/it-mail-report-      │   ──▶   │ [▤ it-mail-report-2026-10-10  Open]│
 │ 2026-10-10.md                      │         │                                    │
 └────────────────────────────────────┘         └────────────────────────────────────┘

 Top bar:  [Office] [Tasks] [Who talks to whom] [▤ it-mail-report-2026-10-10 ×] [▦ leads ×]
```

1. **Chip (R2).** Each file a message names (R1) renders in place of its path as an
   inline chip: a 14 px `file` or `sheet` icon, the file name without folder or
   extension (one line, ellipsis at 220 px, the full path as tooltip), then the action
   word. Same chip in Michael's dock replies (notes included), Ask me cards and Task detail. A
   chip inside a reply cut at 4 lines shows after More, like the rest of the text. A
   Markdown link to a file becomes a chip labeled with the file name, like any other. Folded Ask
   me cards show nothing (2026-10-04 D7 kept). The rows under the question
   (`AskFileRows`) go away.
2. **Chip states** (one `fs:askFiles` check per message or card, as today):
   checking: name, action slot reserved at its widest label; a readable kind
   (Markdown, text, JSON, CSV/TSV, image) inside the folders: "Open" (opens the tab);
   `open` and PDF or Office: "Open" (default app, as today); `reveal` (inside a folder, not a document that opens): "Show in Finder" ("Show in
   folder" on Windows); `missing` (gone, or outside every folder, per the 2026-10-05
   review): name in `ink-3` and "Not found", no action; check failed: "Show in Finder" (the click asks
   main again).
3. **Tab (R3, R4).** Open on Markdown, text, JSON, CSV/TSV or an image adds a tab after
   Who talks to whom (icon, name, ellipsis at 180 px, x to close) and selects it.
   Opening a file already open selects its tab (tabs are keyed by main's real path, so
   `~/x.md` and `/Users/me/x.md` are one tab). At most 5 file tabs: a sixth closes the
   one opened longest ago. File tabs are not saved: `setFloorView` never writes `'file'` to `cth.floorView`, so
   after a restart the app opens on the last fixed view. Each file tab is a group of two
   sibling buttons, select and close ("Close <name>"), both reachable by Tab. The right column stays beside a file tab
   when it was open (F1), so a file opened from Ask me reads on the left while the card
   stays on the right; opening the column while on a file tab stays on the tab. Closing the selected tab selects the
   tab to its left.
4. **File view.** Header: file name, its folder in `ink-3` (tooltip full path), and two
   `sm` buttons, "Open in app" and "Show in Finder". "Open in app" shows only for kinds on `OPEN_EXTENSIONS` (not JSON, per the
   2026-10-04 eng allowlist). Body by kind: Markdown through `MarkdownPreview`, its
   images loaded through a new `loadImage(rel)` prop that resolves against the file's
   folder and calls `fs:readAskFile` (the same check) (shown only when inside the folders, else their
   alt text), web and mail links opening in the browser as today, local file links
   inert (E2 skipped); text and JSON as wrapped monospace; CSV/TSV as a table (E3) with a
   sticky header row, first 1,000 rows, then "Showing 1,000 of N rows"; images fitted to
   the width from a blob URL. The view sits in the existing overlay (`App.tsx:464`),
   which hides the bottom bar on a file tab (owner, 2026-10-16).
5. **View states.** Reading: a quiet "Reading..." line. Gone (deleted or moved): "Not
   found" with Show in Finder hidden; the tab stays until closed. Too large (over 2 MB
   text or 10 MB image): "Too large to show here" with Open in app (Show in Finder for JSON, which never
   opens in an app). Refused (the folders changed while the tab was open, so the file now reads as
   outside): "Not found", no actions, the same as the chip.
6. **Live refresh (E1).** While a tab is open, main watches the file's folder (filtered to
   its name, so a write-then-rename or a re-create is seen) and the view re-reads it
   within a second of a change, keeping the scroll position; every re-read runs the
   folder check again. A delete shows Not found; a re-create brings it back.
7. **Michael's habit (E4, E4b).** `hive.ts:328` "Name files by their full path so the
   owner can open them" becomes "...by their full path in backticks...", and the Ask me
   report rule (`hive.ts:332`) "then the full paths of its files" becomes "then the
   full paths of its files, each in backticks".

### How it works

```
 message text ──▶ askFilePaths (shared) ──▶ chips in MarkdownPreview (remark plugin, fileChips prop)
                                              │ one fs:askFiles per message: { verdict, tab, path }
                                              ▼
           click Open ── readable kind? ──yes──▶ store.openFileTab(path, who) ──▶ ViewTabs + FileTabView
                               │no                                                │ fs:readAskFile(path, who)
                               ▼                                                  ▼
                     fs:openAskFile (default app / Finder)        main: askFileVerdict(roots) → read capped
                                                                                  │ fs:watchAskFile → fs:askFileChanged
```

- **Detection (R1)** in `src/shared/askFiles.ts`: backtick spans as today; plus plain
  tokens outside code fences and spans that start with `/`, `~/` or a drive letter
  (`C:\`), are not part of a URL (not preceded by `:` `/` or a word character), and
  end in a `DETECT_EXTENSIONS` extension, with trailing `.,;:!?)` trimmed; plus
  Markdown link targets that are such paths. `askFilePaths` builds the list sent to `fs:askFiles`; the
  chip itself is placed by a remark plugin that runs the same shared matcher on
  `text`, `inlineCode` and `link` nodes, so Markdown parsing and `boldFirst` never
  shift it. The plugin array is memoized per message (the shared `CARD_PLUGINS`
  constant stays for messages without files), so cards don't re-run the pipeline.
- **Readable kinds:** a new `TAB_EXTENSIONS` set in `askFiles.ts` (md, markdown, txt,
  json, csv, tsv, png, jpg, jpeg, gif, webp) and a `json` kind; `askFileVerdict`
  returns a separate `tab` flag so JSON (not on `OPEN_EXTENSIONS`) can open a tab.
- **Check IPC** `fs:askFiles` returns `{ verdict, tab, path }` per file (path is
  main's real path, the tab key) instead of the bare verdict; the preload type and
  `AskFileVerdict` users change to match.
- **Read IPC** `fs:readAskFile(path, who)`: re-runs `askFileVerdict` with
  `askFileRoots(who)`; requires a file inside the folders on `TAB_EXTENSIONS`;
  returns the canonical path for the tab key; reads text up to 2 MB
  (UTF-8) or an image up to 10 MB (mime from the extension); returns
  `{ ok, kind, text | bytes, mime, size, mtime }` or `{ ok: false, error: 'not found' |
  'too large' | 'refused' }`. `~/` is expanded in main, as `askFileVerdict` already does.
- **Watch IPC** `fs:watchAskFile(path, who)` / `fs:unwatchAskFile(id)`: `fs.watch` on the
  file's folder filtered to its name, debounced 300 ms, at most 5 watchers per window, all closed when the
  window closes; sends `fs:askFileChanged`.
- **Store** `fileTabs: { id, path, who, title, kind, openedAt }[]` and `floorView`
  widened to `'office' | 'tasks' | 'graph' | 'file'` with `activeFileTab`; the startup
  read keeps accepting only tasks or graph, and `setFloorView` skips saving `'file'`.

## NOT in scope

- Links inside an opened file opening as tabs (E2, owner skipped 2026-10-10).
- Terminal Cmd-click opening the tab (E5, owner skipped 2026-10-10).
- PDF, Word, Excel, PowerPoint inside the office (R3): the CSP blocks embedded PDF and
  there is no Office renderer; they open in their app.
- Bare file names without a folder (R1 option B, not chosen).
- Editing a file in the tab: it is a reader.

## 0I. Temporal interrogation

```
  HOUR 1 (foundations):   detection with positions + unit tests; fs:readAskFile on askFileVerdict
  HOUR 2-3 (core logic):  remark plugin + FileChip; store fileTabs + ViewTabs; FileTabView by kind
  HOUR 4-5 (integration): dock, Ask me tab, Task detail swap rows for chips; watcher IPC; hive.ts wording
  HOUR 6+ (polish/tests): states, RTL, keyboard, DESIGN.md, ask-me-open-file.md superseded notes, i18n x3
```

Effort: human ~3 days / CC ~1.5 h. No feasibility blockers: every read path reuses
the approved roots; nothing needs a new dependency or a CSP change.


## Review sections (CEO review, 2026-10-10)

**Section 1 Architecture: OK.** Dependency graph:

```
 shared/askFiles.ts ── detect (TAB_EXTENSIONS, json kind) ──┬──▶ renderer: remark plugin ─▶ FileChip
                                                            │        │ fs:askFiles {verdict,tab,path}
 main/fs.ts askFileVerdict (roots, safeResolve) ◀───────────┼────────┘
        ▲                                                   │
        ├── fs:readAskFile ◀── FileTabView ◀── store.fileTabs / floorView 'file' ◀── ViewTabs
        └── fs:watchAskFile ─▶ fs:askFileChanged ─▶ FileTabView re-read
 main/hive.ts:328, :332 wording (E4, E4b)
```

Only new coupling: the `fs:askFiles` return shape, whose callers all change with R2.
Rollback: revert the release (no data written, no migration).

**Section 2 Error and rescue: 8 paths, 0 gaps** (registry below).

**Section 3 Security: 0 High.** `fs:readAskFile` is a new read surface with the same
roots, `safeResolve` and symlink refusal as `fs:openAskFile`; caps bound size; the CSP
blocks remote images; Markdown has no raw HTML; links go through `openExternal` as in
every card today. Threat: a team member writes a report linking to a phishing page;
likelihood Low, impact Med, unchanged from Ask me text today.

**Section 4 Data flow and edge cases: 1 gap, resolved (F1).**

```
 text ─▶ remark match ─▶ chip(path) ─▶ fs:askFiles ─▶ {verdict,tab,path} ─▶ click
   │ no match: plain text      │ check throws: Show in Finder     │ tab: openFileTab(path) sync, dedupe by path
   │ path in code fence: text  │ outside roots: Not found         └ else: fs:openAskFile
 openFileTab ─▶ fs:readAskFile(seq n) ─▶ view      watch event ─▶ re-read(seq n+1); older seq dropped
```

| Interaction | Edge case | Handled | How |
|---|---|---|---|
| Open | double click | yes | tab inserted synchronously, keyed by canonical path |
| Open | sixth file | yes | closes the oldest tab that is not selected |
| Open | file deleted between check and read | yes | Not found state |
| Tab | closed while reading | yes | result ignored by tab id |
| Tab | file rewritten twice quickly | yes | 300 ms debounce, sequence numbers |
| Ask me | open a file, answer the card | yes (F1) | column stays beside the file tab |
| Message | same path twice | yes | two chips, one tab |
| Restart | file tab was selected | yes | `'file'` never saved; opens the last fixed view |

**Section 5 Code quality: OK.** `AskFileRows` is replaced by `FileChip`, reusing
`useAskFileVerdicts`; one new view component; no new dependency.

**Section 6 Tests:** see tasks. Each approved behavior has a test: detection cases
(plain, `~/`, `C:\`, URL not matched, trailing punctuation, code fence skipped, link
target), read IPC refusals (outside, symlink, too large, not on `TAB_EXTENSIONS`),
watcher start, stop and re-create, store tab rules (dedupe, cap, close selected,
no `'file'` saved, F1 column), hive.ts wording, i18n keys exist. Hostile test: a
symlink inside the office folder pointing at `~/.ssh/id_rsa.txt` is refused. Prompt
change: no eval suite in this repo; covered by a source test on the two sentences.

**Section 7 Performance: OK.** One check call per message; the plugin array is memoized
per message; at most 5 watchers; CSV parse bounded by the 2 MB cap and 1,000 rows.

**Section 8 Observability: OK.** Main logs refusals and watcher failures with the path
and error code; a broken refresh never blanks a tab.

**Section 9 Deployment: OK.** Desktop release, no migration, no flag. Running offices get
the E4/E4b wording when Michael's instructions next refresh; until then R1 covers plain
paths. Windows ships with it: drive-letter paths are in R1 tests.

**Section 10 Trajectory: reversibility 4/5.** File tabs are a base for later PDF, links
between files (E2) or terminal paths (E5) without redesign. Skipped E2 and E5 are not
needed by any accepted row.

**Section 11 Design: UI scope.**

```
 reply/card ─[chip: checking]─▶ [Open] ─▶ tab: Reading... ─▶ content ─(file changes)─▶ content'
                    │                         ├─▶ Not found      ├─▶ Too large (Open in app / Show in Finder)
                    ├─▶ [Show in Finder]      └─▶ x ─▶ tab to its left
                    └─▶ Not found (no action)
```

Logical properties for RTL; select and close are separate buttons with labels;
the chip keeps its action slot width while checking. Recommend /plan-design-review
before implementation.

**Outside voice: skipped.** Owner rule (2026-10-01): Codex only for the adversarial
pass, with no Claude subagent fallback. No outside coverage.

**TODOS.md:** none proposed; nothing deferred.

Approval readiness: PASS. Rows R1 (D3 A), R2 (D4 A), R3 (D5 A), R4 (D6 A), E1 (D7 A),
E3 (D9 A), E4 (D10 A), E4b (D12 A), F1 (D14 A) approved; E2 (D8 C) and E5 (D11 C)
declined; document approval D13 A.

## What already exists

See 0B. Reused: `askFilePaths`/`isFileSpan`, `askFileVerdict`/`askFileRootsFor`,
`useAskFileVerdicts`, `MarkdownPreview`, the image blob pattern, `ViewTabs`, the view
overlay. Replaced: `AskFileRows` (R2).

## Dream state delta

After this, every file Michael or a report names opens in the office and stays current.
Left for later: PDF and Office in the office, links between files, terminal paths, and
linking a file to the task that made it.

## Error & Rescue Registry

| Codepath | What can go wrong | Rescued | Action | User sees |
|---|---|---|---|---|
| fs:askFiles | IPC throws | Y | chip treats it as reveal | Show in Finder |
| fs:askFiles | outside roots / gone | Y | verdict missing | Not found |
| fs:readAskFile | ENOENT | Y | error not found | Not found |
| fs:readAskFile | over cap | Y | error too large | Too large to show here |
| fs:readAskFile | not on TAB_EXTENSIONS / refused | Y | error refused, logged | Not found |
| fs:watchAskFile | EMFILE, folder gone | Y | logged with path and code | last content stays |
| CSV parse | bad quoting | Y | falls back to text | plain text |
| image blob | decode fails | Y | alt text | file name |

## Failure Modes Registry

| Codepath | Failure mode | Rescued | Test | User sees | Logged |
|---|---|---|---|---|---|
| detection | URL path matched as file | Y | Y | no chip | n/a |
| read | symlink escape | Y | Y | Not found | Y |
| read | file deleted mid-read | Y | Y | Not found | n/a |
| watch | rewrite by rename | Y | Y | new content | n/a |
| tabs | sixth tab while one is reading | Y | Y | oldest closes | n/a |
| restart | 'file' saved as last view | Y | Y | last fixed view | n/a |

0 CRITICAL GAPS.

## Scope Expansion Decisions

- Accepted: E1 live refresh, E3 CSV table, E4 conversation backticks, E4b report backticks
- Deferred: none
- Skipped: E2 links inside opened files, E5 terminal Cmd-click

## Stale Diagram Audit

`docs/designs/ask-me-open-file.md` storyboard (D1 default app, D2 row) becomes stale:
T9 marks D1 and D2 superseded by this doc. DESIGN.md §7.8 row text is rewritten in T9.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~3h / CC: ~6min)**: shared: detection, TAB_EXTENSIONS, json kind
  - Surfaced by: R1, R3, spec review C2.1
  - Files: `src/shared/askFiles.ts`, `test/ask-files.test.cjs`
  - Verify: plain, `~/`, `C:\`, link target, URL not matched, punctuation trimmed, fence skipped
- [ ] **T2 (P1, human: ~6h / CC: ~15min)**: main: check shape, read and watch IPC
  - Surfaced by: R3, E1, Sections 2 and 3
  - Files: `src/main/fs.ts`, `src/main/index.ts`, `src/preload/index.ts`, new `test/open-file-tab-ipc.test.cjs`
  - Verify: refusals (outside, symlink, cap, kind), canonical path, watcher start/stop/re-create
- [ ] **T3 (P1, human: ~5h / CC: ~12min)**: renderer: FileChip and the remark plugin
  - Surfaced by: R2, spec review Cl.1, F2
  - Files: `src/renderer/src/markdown/MarkdownPreview.tsx`, new `src/renderer/src/components/FileChip.tsx`
  - Verify: chip replaces the path in text, inlineCode and link nodes; memoized plugins
- [ ] **T4 (P1, human: ~2h / CC: ~5min)**: chips in the dock, Ask me and Task detail
  - Surfaced by: R2, owner "same behavior in Ask me cards"
  - Files: `src/renderer/src/shell/MichaelDock.tsx`, `src/renderer/src/components/AskMeTab.tsx`, `src/renderer/src/components/TasksKanban.tsx`, remove `AskFileRows.tsx`
  - Verify: no rows left; folded cards show nothing; notes replies get chips
- [ ] **T5 (P1, human: ~5h / CC: ~12min)**: file tabs in the store, top bar and App
  - Surfaced by: R4, F1, spec review C2.3, Cl.4
  - Files: `src/renderer/src/store/store.ts`, `src/renderer/src/shell/TopBar.tsx`, `src/renderer/src/App.tsx`
  - Verify: dedupe, cap 5, close selects left, `'file'` never saved, column stays beside a file tab
- [ ] **T6 (P1, human: ~6h / CC: ~15min)**: FileTabView by kind, states, live refresh, CSV table
  - Surfaced by: R3, E1, E3, Section 2
  - Files: new `src/renderer/src/components/FileTabView.tsx`
  - Verify: Markdown, text, JSON, CSV table cap note, image, Reading, Not found, Too large, refresh keeps scroll
- [ ] **T7 (P1, human: ~30min / CC: ~2min)**: Michael's wording, paths in backticks
  - Surfaced by: E4, E4b
  - Files: `src/main/hive.ts`, a source test
  - Verify: both sentences carry "in backticks"
- [ ] **T8 (P1, human: ~1h / CC: ~3min)**: strings in en, zh-CN, ar
  - Surfaced by: R2, R3, R4 labels; no dashes rule
  - Files: `src/renderer/src/i18n/locales/{en,zh-CN,ar}.json`
  - Verify: `test/i18n-keys-exist.test.cjs`, `test/arabic-ui.test.cjs`
- [ ] **T9 (P1, human: ~1h / CC: ~4min)**: DESIGN.md and the 2026-10-04 doc
  - Surfaced by: Stale Diagram Audit
  - Files: `branding/DESIGN.md` (§7.2, §7.8, §7.19, a file tab section, decision log), `docs/designs/ask-me-open-file.md`
  - Verify: no "row under the question" or "default app" left for readable kinds

## Completion Summary

```
  +====================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
  +====================================================================+
  | Mode selected        | SELECTIVE EXPANSION                         |
  | System Audit         | rows exist but only for backtick spans; IDE off; tabs fixed |
  | Step 0               | R1 to R4 + E1, E3, E4, E4b accepted; E2, E5 skipped |
  | Section 1  (Arch)    | 0 issues found                              |
  | Section 2  (Errors)  | 8 error paths mapped, 0 GAPS                |
  | Section 3  (Security)| 1 issue found, 0 High severity              |
  | Section 4  (Data/UX) | 8 edge cases mapped, 0 unhandled (F1 fixed) |
  | Section 5  (Quality) | 0 issues found                              |
  | Section 6  (Tests)   | Diagram produced, 0 gaps                    |
  | Section 7  (Perf)    | 0 issues found                              |
  | Section 8  (Observ)  | 0 gaps found                                |
  | Section 9  (Deploy)  | 1 risk flagged (prompt refresh lag)         |
  | Section 10 (Future)  | Reversibility: 4/5, debt items: 0           |
  | Section 11 (Design)  | 0 issues; /plan-design-review recommended   |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (5 items)                           |
  | What already exists  | written                                     |
  | Dream state delta    | written                                     |
  | Error/rescue registry| 8 rows, 0 CRITICAL GAPS                     |
  | Failure modes        | 6 total, 0 CRITICAL GAPS                    |
  | TODOS.md updates     | 0 items proposed                            |
  | Scope proposals      | 6 proposed, 4 accepted (EXP + SEL)          |
  | CEO plan             | written                                     |
  | Outside voice        | codex, skipped (owner rule)                 |
  | Lake Score           | 3/4 recommendations chose complete option   |
  | Diagrams produced    | 5 (architecture, data flow, state, error, user flow) |
  | Stale diagrams found | 1                                           |
  | Unresolved decisions | 0                                           |
  +====================================================================+
```

## Eng review (2026-10-10)

Target: `docs/designs/open-file-tab.md` (this file). Report file: this file.

### Scope Challenge

- **Reuse:** as 0B; no CSV parser exists in `src` (grep `parseCsv|csvParse`: none), so
  E3 adds a small one. TODOS.md has nothing related.
- **Complexity:** about 18 changed files (estimate), 2 new components (`FileChip`,
  `FileTabView`). Gate tripped. No feature cuts proposed: every feature is an owner
  answer from the CEO review (D3 to D14) given today.
- **Structure:** auto-decided `Original arrangement` (owner rule 2026-10-09: never ask
  file or module layout questions; pick the recommended one). The plan's file list
  stays as written.
- **Search:** fs.watch on a folder and a remark plugin are built-in, standard
  practice [Layer 1]; in-distribution knowledge, no web search.
- Scope record: feature answers: CEO D3 to D14; structure: A (auto, owner rule);
  accepted scope: CEO accepted scope unchanged; pending remedies: P1.
- Result: scope accepted as-is.

### Decision ledger (eng)

### P1: Large Markdown freezes the window
Finding: 1, P1, confidence 9/10, plan "Too large (over 2 MB text...)", Section 4 (eng)
Plan baseline: Markdown up to 2 MB renders through MarkdownPreview; over 2 MB shows Too large (CEO accepted scope, D5/R3)
Runtime evidence: probe, remark-parse + remark-gfm + remark-rehype in Node on this Mac: 512 KB 973 ms, 2 MB 9,566 ms, before React renders; live refresh (E1) repeats it on every change
Comparison grid:

| Commitment | Current | A | B | C |
|---|---|---|---|---|
| Markdown up to 256 KB | rendered | rendered | rendered | rendered |
| Markdown 256 KB to 2 MB | rendered (freezes up to ~10 s) | plain text, a quiet "Shown as text" line | rendered, parsed off the main thread | rendered |
| Over 2 MB | Too large | Too large | Too large | Too large |
| Other kinds, live refresh | approved | unchanged | unchanged | unchanged |

Question D1:
D1 — P1: Large Markdown freezes the window. (full brief in the native question)
Header: Big Markdown
Options:
A) Show big ones as text (recommended)
Markdown over 256 KB opens as plain text with a quiet "Shown as text" line; smaller files render. Effort S (human ~1h / CC ~3min), risk low, nothing new to maintain.
B) Parse off the main thread
Parse in a Web Worker, then render. Effort M (human ~1 day / CC ~20min), risk medium: the React render of a huge tree still stalls.
C) Keep the 2 MB limit
No change; a 2 MB report freezes the window about 10 s per open and per refresh. Effort S, risk high for big reports.

State: approved
Actual answer: C, Keep the 2 MB limit (D1, owner, 2026-10-10)
Accepted scope: no change; Markdown up to 2 MB renders. Accepted risk: a report near 2 MB freezes the window up to ~10 s on open and on each live refresh.
History: none

### Section 1 Architecture

- [P2] (confidence: 9/10) src/renderer/src/App.tsx:523 — the right column is also hidden
  by its own style, `display: floorView === 'office' ? 'flex' : 'none'`, not only by
  `columnShown` (`App.tsx:328`, `const columnShown = columnOpen && floorView === 'office';`).
  F1 needs both, and `SidebarSplitter` (`App.tsx:502`) follows `columnShown`. The overlay
  (`App.tsx:466`, `position: 'absolute', inset: 0, zIndex: 50`) sits inside the stage
  container, so the column beside it works. Disposition: required work of F1 (D14), added
  to T5; no new choice.
- [P2] (confidence: 7/10) plan "Watch IPC ... all closed when the window closes" — a
  renderer reload or crash recovery re-mounts the view without closing the window, so
  watchers would leak past the 5 cap. Keep watchers per `webContents` and drop them on
  `did-start-navigation`, `render-process-gone` and `destroyed`. Disposition: required
  work of E1 (D7), added to T2.

Production failure per new path: a report rewritten by rename (handled by folder watch);
a file moved out of the office mid-view (Not found); a 2 MB Markdown report (accepted
freeze, D1). Distribution: no new artifact; ships in the normal Mac and Windows builds.

### Section 2 Code quality

- [P2] (confidence: 8/10) plan R1 "start with `/`, `~/` or a drive letter (`C:\`)" — in
  Markdown text a backslash before ASCII punctuation is an escape, so
  `C:\Reports\_q3.md` reaches a `text` node as `C:\Reports_q3.md`. The remark plugin takes
  the path from the source by the node's `position` offsets, not from `node.value`.
  Disposition: required work of R1 (D3), added to T3, with a Windows test row.
- [P3] (confidence: 9/10) test/ask-files.test.cjs:126 asserts `<AskFileRows question={open.q}`
  under the question and the row markup; R2 (D4) intentionally replaces rows with chips.
  Rewrite that test for chips; keep tests at :21, :38, :90, :112 (detection, allowlist,
  roots, reveal), whose behavior is unchanged. Disposition: added to T4.
- No shared-code extraction: the chip reuses `useAskFileVerdicts` and the existing
  `askMe.file*` strings; no second caller exists for a CSV parser.

### Section 3 Tests

```
CODE PATHS                                              USER FLOWS
[+] src/shared/askFiles.ts                              [+] Open from Michael's reply
  ├── askFilePaths: backtick spans  [★★★ TESTED] :21      ├── [GAP] chip replaces a plain path
  ├── plain absolute paths          [GAP] /, ~/, C:\       ├── [GAP] Open selects existing tab
  ├── link targets, URL not matched [GAP]                 └── [GAP] [→E2E] read and answer beside Ask me (F1)
  └── TAB_EXTENSIONS, json kind     [GAP]               [+] File tab
[+] src/main/fs.ts askFileVerdict                         ├── [GAP] Reading, Not found, Too large states
  ├── roots, allowlist, canonical   [★★★ TESTED] :38, :90 ├── [GAP] live refresh keeps scroll; delete, re-create
  └── tab flag                      [GAP]                 ├── [GAP] sixth tab closes the oldest
[+] main IPC                                              └── [GAP] restart opens the last fixed view
  ├── fs:askFiles {verdict,tab,path} [GAP]
  ├── fs:readAskFile refusals/caps   [GAP] symlink, outside, 2 MB, kind
  └── fs:watchAskFile lifecycle      [GAP] close, reload, re-create
[+] renderer
  ├── remark plugin (text, code, link, raw source) [GAP]
  ├── store fileTabs/floorView/persist             [GAP]
  └── CSV table parse (quotes, 1,000 rows)         [GAP]
LLM: hive.ts:328, :332 wording   [GAP] source test (no eval suite in repo) [→EVAL n/a]

COVERAGE: 4/22 paths tested today (18%) | every GAP has a planned test below
```

Planned tests (each protects an approved behavior):
- `test/ask-files.test.cjs` (extend): plain `/`, `~/`, `C:\` paths; trailing `.,;:!?)`;
  `https://x.com/a.md` not matched; code fence skipped; link target; `json` kind; tab flag.
  Value: protects=R1 detection; fails_when=a URL or prose path becomes a chip or a path is missed; why_new=:21 covers backtick spans only; seam=none
- `test/open-file-tab-ipc.test.cjs` (new): read refuses outside, symlink to `~/.ssh`,
  over 2 MB, non-tab kind; returns canonical path; watcher stops on close and reload, sees
  a rename and a re-create.
  Value: protects=R3 read roots and E1 lifecycle; fails_when=a file outside the folders is read or watchers leak; why_new=no read IPC exists; seam=none
- `test/open-file-tab.test.cjs` (new, source and store level): chip in dock (notes too),
  Ask me, Task detail; no `AskFileRows`; tabs dedupe by path, cap 5 closes oldest, close
  selects left; `'file'` never written to `cth.floorView`; column shown on file tab
  (`App.tsx:328` and `:523`); CSV quoted fields and 1,000 row note; hive.ts sentences
  carry "in backticks".
  Value: protects=R2, R4, F1, E3, E4; fails_when=rows return, tabs pile up, restart lands on a dead tab, or Ask me hides; why_new=no tab code exists; seam=none
- Regression: tests at ask-files :21, :38, :90, :112 stay unchanged (D1 and D3 to D8 of
  2026-10-04 still hold for PDF and Office). Retire: the row assertions at :126 (R2).

### Section 4 Performance

- [P1] (confidence: 9/10) Markdown up to 2 MB through `MarkdownPreview` — probe: 512 KB
  973 ms, 2 MB 9,566 ms (parse only). Disposition: D1 answer C, keep; accepted risk.
- One `fs:askFiles` per message (each realpaths the roots once); at most 5 watchers; CSV
  and text bounded by the 2 MB read cap; plugin array memoized per message. No other issue.

### Outside voice

Skipped: owner rule (2026-10-01), Codex only for the adversarial pass, no Claude
subagent fallback. No outside coverage.

### TODOS.md

None proposed. The big Markdown freeze is an accepted risk (D1), not deferred work.

Approval readiness: PASS. CEO rows R1 to R4, E1, E3, E4, E4b, F1 (D3 to D14) carried
forward; eng P1 (D1 C). Required work A1, A2, Q1, Q2 sits under F1, E1, R1 and R2.

### Failure modes (eng)

| Path | Failure | Test | Handled | User sees |
|---|---|---|---|---|
| plain path in text | Windows backslash escape eats a character | yes (T3) | raw source slice | chip works |
| watcher | renderer reload | yes (T2) | dropped per webContents | nothing |
| big Markdown | parse freeze | probe only | accepted (D1) | window busy ~10 s |
| read | symlink to a secret | yes (T2) | refused | Not found |

0 critical gaps.

### Worktree parallelization strategy

| Step | Modules touched | Depends on |
|---|---|---|
| Detection | src/shared | — |
| Main IPC | src/main, src/preload | Detection |
| Chip | src/renderer/src/markdown, components | Detection, Main IPC |
| Tabs and view | src/renderer/src/store, shell, App, components | Main IPC |
| Wording, strings, docs | src/main/hive.ts, i18n, branding, docs | — |

Lane A: Detection → Main IPC → Chip → Tabs and view (shared renderer and main). Lane B:
wording, strings, docs (independent). Launch A + B; merge B after A's strings land.
Conflict flag: i18n keys come from A's components. Owner rule (2026-10-09): one running
branch, so in practice sequential on this branch.

### Implementation task changes (eng)

- T2 adds: watchers keyed by `webContents`, dropped on reload and crash (A2).
- T3 adds: path text taken from the source by node `position` (Q1), Windows test row.
- T4 adds: rewrite `test/ask-files.test.cjs:126` for chips; keep :21, :38, :90, :112 (Q2).
- T5 adds: `App.tsx:523` column `display` and `columnShown` both allow `'file'` (A1).
- Test files as in Section 3. No task for P1 (kept as is, D1 C).

### Completion summary (eng)

- Step 0: Scope Challenge, scope accepted as-is
- Architecture Review: 2 issues found
- Code Quality Review: 2 issues found
- Test Review: diagram produced, 18 gaps identified, all with planned tests
- Performance Review: 1 issue found (accepted risk)
- NOT in scope: written (CEO section, unchanged)
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, skipped (owner rule)
- Parallelization: 2 lanes, 1 parallel / 1 sequential (one running branch in practice)
- Lake Score: 0/1 (D1 chose C over the 10/10 option B)

## Design review (2026-10-10)

Mockup: `.gstack/tmp/open-file-tab-mockup.html` (HTML/CSS with tokens.css; owner rule,
no AI image designer). Initial design completeness 7/10.

- **DD1 chip direction: A, approved** (owner D1, 2026-10-10). Soft chip: `neutral-soft`
  fill, `r-sm`, 24 px tall, padding 0 8, gap 6; 14 px `file`/`sheet` icon in `ink-3`;
  name 12 px 500 `ink`, ellipsis at 200 px, full path as tooltip; action word 600
  `indigo-text` ("Open", or "Show in Finder"/"Show in folder"). The whole chip is one
  button (label `askMe.fileOpenLabel` etc.); hover `indigo-soft`; focus ring 2 px
  `indigo`, offset 1. Missing: no fill, `line` ring, all `ink-3`, "Not found", not a
  button.
- Outside design voices: skipped (owner Codex rule).
- **DD2 top bar overflow: shrink to fit, approved** (owner D3). File tabs are
  `flex: 0 1 auto`, min about 72 px (icon, start of name, x), name ellipsis at 160 px,
  full name as tooltip; the three fixed tabs, the clock pill and Needs you never shrink
  or move; a separator (`line-2`, 1 x 18 px) sits between Who talks to whom and the first
  file tab.
- **DD3 empty file: approved** (owner D4). A 0-byte file shows one `ink-3` line, "Empty
  file", in the body; live refresh replaces it when the file is written.
- **DD4 folder line: approved** (owner D5). The header's second line reads in office
  terms, "Office / IT" or "<team member> / reports", from the root `fs:readAskFile`
  reports (`root: 'office' | { member: id }`); full path as tooltip; ellipsis at the end.

### Passes

| Pass | Before | After | Notes |
|---|---|---|---|
| 1 Information architecture | 7 | 9 | DD2; header hierarchy: name (14/600), folder line (12 `ink-3`), actions right |
| 2 States | 7 | 10 | DD3 added; Reading, Not found, Too large, Empty, refreshing all specified |
| 3 Journey | 8 | 9 | DD4; read on the left, answer on the right (F1) |
| 4 AI slop | 9 | 9 | app UI, no cards added, one accent (`indigo-text`) |
| 5 Design system | 7 | 9 | DD1 tokens; view tab style §7.2 reused for file tabs |
| 6 Responsive and a11y | 7 | 9 | chip and tab buttons labelled; select and close separate; focus ring `indigo`; logical properties for RTL; DD2 for narrow windows |
| 7 Decisions | 4 open | 0 open | DD1 to DD4 resolved |

Storyboard: owner reads Michael's reply (5 s: the chip says what and Open) → clicks
(a tab appears beside Who talks to whom, Reading... then the report) → reads with Ask me
on the right and answers → closes the tab or leaves it; it updates if the team rewrites
the file.

Design tasks added: T3 chip per DD1; T5 shrink-to-fit tabs and separator per DD2; T6
Empty file state (DD3) and folder line (DD4); T2 read result carries the root (DD4);
T8 strings "Empty file", "Office", "Open in app".


## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | 6 proposals, 4 accepted, 0 deferred |
| Outside Review | codex (plan-review) | Independent 2nd opinion | 0 | skipped | owner rule: Codex only for adversarial review; no completed external review |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 5 issues, 0 critical gaps (all folded into tasks; P1 accepted risk) |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 7/10 → 9/10, 4 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | n/a |

- **OUTSIDE COVERAGE:** codex skipped by owner rule in the CEO, eng and design reviews (design outside voices too); no outside findings.
- **VERDICT:** CEO + DESIGN CLEARED. Eng review logged ISSUES OPEN for 5 findings, all assigned to tasks or accepted as risk, 0 unresolved; eng review required by the dashboard rule.

NO UNRESOLVED DECISIONS
