# Ask me: answering options and several questions

Status: design and eng reviewed (owner, 2026-10-15); built on `mit/delete-team-member` the same day.

## Problem

Almost every Ask me card ends in a numbered list and one text box. The owner can't tell
how to answer it: "1", "option 1", or the whole sentence. The list also means two
different things, and one box serves neither well.

From the MoblizeIT reference office (157 asks in `tasks.json`, 2026-10-15):

| Shape | Asks | Example |
|---|---|---|
| A choice: pick one, often with "(recommended)" | 107 | Pete's permission card: "I'll open Pete's chat" or "Leave Pete paused" |
| Several questions, each needing its own answer | 31 | "Maheep: staff, contractor or remove?", "Who can sign in to `it@`?" |
| Mixed: some items choices, some questions | 14 | Follow ups, close date, deal types |
| No list | 5 | |

Real answers show the guesswork: "4. yes", "1. removed 2. maheep is no longer in google",
"leave it", "yes go ahead".

The card can't help because the options exist only as text inside the question
(`humanQA[i].q`). Michael is told to "give each option its own bullet or number"
(`src/main/hive.ts`), and `AskMeTab.tsx` renders the question as markdown above one
`GrowingTextarea` and a Reply button.

## Decisions

Every decision below was the owner's, one at a time, on 2026-10-15.

| # | Decision | Choice |
|---|---|---|
| D1 | Scope | Choices and several questions; mixed lists and to-dos get a lighter pass |
| D2 | Answering a choice | Pick, then Reply. Nothing is sent until Reply; free text stays on every card |
| D3 | Reply placement (A1) | Text box full width under the options; Reply on its own row at the end of the card; its label follows the pick |
| 1 | Where options come from (1A) | Michael writes them as fields on the ask; older asks with no fields look exactly like today |
| 2 | Partial answers (owner, eng review D1; replaces 2A) | Reply never needs every question answered. It settles the whole ask; Michael routes the answers and the unanswered questions to the raiser, who files back only what it still needs |
| 3 | Draft picks (3A) | A pick, a note and question lines are kept like a typed draft |
| 4 | Recommended option (4B) | Nothing starts picked; the recommendation is a green tag |
| 5 | Answer wording (5A) | The option's own words plus which option, never a bare number |
| 6 | Design system (6A) | The new parts are specified in DESIGN.md §7.8 with existing tokens |
| 7 | Keyboard (7A) | Standard radio group; Cmd or Ctrl+Enter sends from anywhere in the card |
| 8 | Mixed lists (8A) | A question can carry its own small choice chips plus a line to type |
| 9 | To-do asks (9A) | Michael gives them a "Done, I did it" option, plus others as fit; no new card kind |

## The ask, as Michael writes it (1A)

A `humanQA` entry keeps `q`, `askedAt`, `raisedBy`. `q` keeps the bold first sentence
and the short context, and no longer repeats the options or questions as a list. Two
optional fields are new:

```json
{ "q": "**Pete has stopped on a permission prompt that only you can answer.** ...",
  "options": [
    { "label": "I'll open Pete's chat and answer it", "recommended": true },
    { "label": "Leave Pete paused for now" }
  ] }
```

```json
{ "q": "**Dwight needs three calls on the live deals.**",
  "parts": [
    { "q": "Follow ups: where should Dwight start?",
      "options": [{ "label": "Batches of 20, contacted first", "recommended": true }, { "label": "Not now" }] },
    { "q": "Close date: all 246 sit on 15 Oct. New date?", "options": [{ "label": "Leave it" }] },
    { "q": "Allucent: subscription, retainer or project?",
      "options": [{ "label": "Subscription" }, { "label": "Retainer" }, { "label": "Project" }] }
  ] }
```

- `options` makes the ask a **choice**. `parts` makes it **several questions**; a part
  with its own `options` is a mixed question (8A). An entry has one or the other.
- A **to-do** (9A) is a choice whose first option is "Done, I did it", with others as
  fit ("Not yet, remind me tomorrow").
- An entry with neither field, or with fields the app can't read, shows exactly as
  today: markdown question, one box, Reply. Nothing changes for asks already waiting.

## The answer, as the app records it (5A, 2A)

- A choice: `a` is "Picked: <option label>" plus ". Note: <note>" when one was typed,
  and `picked` is the option's index. Free text with no pick: `a` is the text, as today.
- Several questions: one Reply settles the whole ask, however many questions were
  answered (eng review D1). `a` lists each answered question with its answer and names
  the ones left unanswered, for example "1: remove. 2: only me, not sure about
  Cloudflare. Not answered: 3, 4, 5". `partAnswers` holds each answered part's text
  (null for an unanswered one), written only in the same patch as `a`. A part answered
  with a chip records "<chip label>", plus " (<typed text>)" when both were given.
- What Michael gets, and what goes into the raiser's memory notes, is the same labeled
  text, for example "Picked: I'll open Pete's chat and answer it" or
  "1: remove. 2: only me. Not answered: 3. Also: check Cloudflare too".

## The card (A1)

Approved mockup: see Approved Mockups below.

Open card, top to bottom: title, person chip and time (unchanged); the question
markdown; then by kind:

- **Choice:** the option rows (a radio group), then the full width box, then Reply on
  its own row, at the end. The box's placeholder is "Or write your own answer", and
  "Add a note (optional)" once an option is picked.
- **Several questions:** each part as its number, its question, its choice chips if
  it has any, and a one line field ("Your answer", or "Or your own answer" under
  chips). Then "Anything else (optional)" full width, then Reply on its own row.
- Holding up N tasks, and the See full context footer, are unchanged.

Reply's label says what will go:

| State | Label | Enabled |
|---|---|---|
| Nothing picked or typed | Reply | No |
| Own text only | Reply | Yes |
| Option n picked | Reply with option n | Yes |
| Option n picked and a note | Reply with option n and note | Yes |
| Several questions, k of m open ones answered (k < m) | Reply to k of m | Yes |
| Several questions, all open ones answered | Reply | Yes |
| Sending | Sending… | No |

Picking an option never sends. Clicking a picked option again unpicks it. Nothing
starts picked (4B). Folded cards are unchanged: the headline only, and the Draft tag
when anything is picked or typed (3A).

## DESIGN.md §7.8 addition (6A)

Add to the Open bullet of §7.8, with these tokens (all existing):

- Option row: `card` fill, 1 px `line-2` ring, `r-md`, padding 8 × 10, gap 9; a 16 px
  radio dot (1.5 px `line-input` ring); the option number at 11 / 600 `ink-3`, then the
  label at 12.5 / 18 `ink`. Rows 6 px apart, 10 px above the box. Hover: `card-2` fill,
  `line-input` ring. Picked: `indigo-soft` fill, 1.5 px `indigo` ring, dot filled
  `indigo` (8 px). Focus: 2 px `indigo` ring.
- Recommended tag: pill, `green-soft` fill, `green-text`, 10.5 / 600, 18 px tall,
  6 px after the label. Text "Recommended".
- Choice chip (a part's options): 26 px pill, `card` fill, 1 px `line-2` ring,
  11.5 px `ink`, 5 px apart; pressed like a picked row (`indigo-soft`, 1.5 px `indigo`).
  The Recommended tag inside a chip is 16 px tall at 10 px.
- Question line: the number at 11 / 600 `ink-3` in a 20 px column, end aligned; the
  question at 12.5 / 18; its field the existing `.cth-input` at 30 px tall; parts 10 px
  apart.
- Reply: the existing primary `sm` button, 34 px, on its own row, end aligned, 8 px
  below the box.

## States

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Choice card | Card shows as today while Needs you loads | No options field: legacy card | Reply failed: "Your reply could not be saved" (existing `askMe.mailFailed`); pick and note kept | Card leaves; "Your answer" under All clear shows the labeled answer | n/a |
| Several questions card | as above | No parts field: legacy card | as above; every typed line kept | Card leaves on Reply, whatever was answered | Reply with some questions blank: "Reply to k of m"; the card leaves and the blank ones go to the team member through Michael |
| Draft | n/a | n/a | n/a | Pick, chips and lines survive fold and tab switch; Draft tag on the folded card (3A) | n/a |
| Withdrawn while drafting | n/a | n/a | Existing path: nothing is sent, the draft is kept, the board reloads | n/a | n/a |

## Journey

| Step | Owner does | Owner feels | Supported by |
|---|---|---|---|
| 1 | Opens the newest card | Oriented: what is asked, by whom | Bold first sentence, person chip (unchanged) |
| 2 | Scans the choices | Clear what the options are | Numbered rows with a radio dot; green Recommended tag |
| 3 | Picks one | Safe: nothing has gone yet | Row turns indigo; Reply now reads "Reply with option 1" |
| 4 | Adds a note, or writes their own | Free to say more | Box stays open on every card |
| 5 | Presses Reply | Certain what was sent | Label named it; "Your answer" shows the labeled text |
| 6 | Weeks later, opens Task detail | Understands the decision | History reads "Picked: …", never "1" (5A) |

## Behavior changes (agent and orchestration)

Listed as their own items for the owner, as the standing rule asks.

1. **Michael's ask instructions change** (both places: the house rules in `hive.ts` and
   the PROTOCOL text). Today: "Give each option its own bullet or number." Proposed: a
   choice goes in `options` (one marked `recommended` when he has a recommendation);
   several questions go in `parts`, each with its own `options` when it is a choice; the
   question text keeps only the bold sentence and short context; a to-do gets a
   "Done, I did it" option first. Who: Michael. What the owner sees: option rows and
   question lines instead of a numbered list.
2. **Unanswered questions go to the team member, not back to the owner** (eng review
   D1). Today Michael is told to re-ask unanswered questions at once (askMeRouting.ts:98).
   Proposed: Michael sends the answers and the unanswered questions to the raiser; the
   raiser works out what it can and files back to Michael only what it still needs;
   Michael asks the owner again only then. Who: Michael and every team member. What the
   owner sees: the card leaves on Reply, and a question comes back only when the team
   could not settle it.
3. **Answers reach Michael and memory notes labeled** (5A): "Picked: <option>" or
   "1: …. 2: …". Who: Michael and the raiser's memory. What the owner sees: the same
   text under "Your answer" and in Task detail.

## NOT in scope

- Changing older asks already waiting: they keep today's card (1A).
- The app guessing options from markdown (1B, 1C declined).
- Number key shortcuts (7B declined).
- A dedicated Mark done button or ask kind (9B declined).
- Preselecting the recommended option (4A declined).
- Reports ("Got it" cards), schedule requests, Work style offers and mail proposals:
  separate card types, unchanged.

## What already exists

- `AskMeTab.tsx`: card shell, fold and open, drafts in the store (`answerDrafts`),
  Cmd or Ctrl+Enter, failed reply message, All clear with "Your answer".
- `askMeRouting.ts`: `openAskIndexes`, `isAnswered`, `isWithdrawn`, `answerMessages`,
  `raiserOf`; the merge that lands an answer only on the same open question.
- `GrowingTextarea`, `PixelButton` (primary `sm`), `.cth-input`, `FileText` (file chips
  and named links inside the question and part text).
- `TasksKanban.tsx` Task detail history, which shows each `humanQA` entry.
- DESIGN.md §7.8, which this extends.

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a decision above.

- [ ] **T1 (P1, human: ~1d / CC: ~30min)**: askMeRouting: `options` and `parts` on HumanQA
  - Surfaced by: decision 1 (1A), 2 (2A), 5 (5A)
  - Files: `src/shared/askMeRouting.ts`, `src/renderer/src/components/hiveTasks.ts`, `src/main/hive.ts` (HumanQA type)
  - Read and validate the fields (unreadable means legacy); build the labeled answer text naming answered and unanswered questions; merge `partAnswers` only with the entry's `a`; `answerMessages` sends it and tells Michael to route the unanswered ones to the raiser.
  - Verify: unit tests for parsing, the labeled text, the merge, and an agent-written `partAnswers` being ignored.
- [ ] **T2 (P1, human: ~2d / CC: ~1h)**: AskMeTab: choice rows, question lines, chips, Reply label
  - Surfaced by: D2, D3, decisions 3, 4, 7, 8, 9
  - Files: `src/renderer/src/components/AskMeTab.tsx`, `src/renderer/src/store/store.ts` (draft shape), new small components as needed
  - Radio group (arrows, Space), chips with `aria-pressed`, Reply on its own row with the state table labels and an accessible name that includes the option text; drafts keep picks; partial replies patch only answered parts.
  - Verify: tests on the component source and the draft store; run the app and answer each mockup case.
- [ ] **T3 (P1, human: ~3h / CC: ~20min)**: Michael's ask instructions and the raiser's follow up
  - Surfaced by: decision 1, 9; eng review D1 (R1); Behavior changes 1 to 3
  - Files: `src/main/hive.ts` (house rules and PROTOCOL)
  - Michael writes `options` / `parts`; the answer note routes unanswered questions to the raiser; team members settle what they can and file back only the rest.
  - Verify: prompt text tests; the live check in the eng review test section.
- [ ] **T4 (P2, human: ~2h / CC: ~15min)**: Task detail shows parts and picks
  - Surfaced by: decision 5
  - Files: `src/renderer/src/components/TasksKanban.tsx`
  - Verify: history shows "Picked: …" and each part with its answer.
- [ ] **T7 (P3, human: ~5min / CC: ~1min)**: reword the stale "Slack options" comment
  - Surfaced by: eng review, Code quality
  - Files: `src/renderer/src/components/hiveTasks.ts`
  - Verify: read.
- [ ] **T5 (P2, human: ~1h / CC: ~10min)**: strings in en, ar, zh-CN, no dashes
  - Surfaced by: D3 labels, decision 4 tag, states table
  - Files: `src/renderer/src/i18n/locales/*.json`
  - Verify: i18n key and no dash tests.
- [ ] **T6 (P2, human: ~30min / CC: ~5min)**: DESIGN.md §7.8 addition
  - Surfaced by: decision 6
  - Files: `branding/DESIGN.md`
  - Verify: read back against the mockup.

## Questions for eng review

Not design decisions; for `/plan-eng-review` to settle:

- Settled in eng review D2: no limits; only unreadable fields fall back to the legacy card.
- Settled in eng review D1: a reply settles the whole ask.

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|----------------|-------------|-----------|-------|
| Ask me card, all kinds | `/Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/designs/ask-me-options-20261015/ask-me-options.html` | A1 choice card, to-do, several questions, mixed with chips | The dashed "Michael gets" line is a review aid, not part of the design. The several questions card's green "Answered: remove" line is superseded by eng review D1: a reply settles the whole ask, so no answered line shows on an open card. Rounds 1 and 2 kept beside it for history |

## Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW: COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | DESIGN.md §7.8 exists; UI scope: Ask me card |
  | Step 0               | 4/10; focus: choices + several questions     |
  | Pass 1  (Info Arch)  | 5/10 → 8/10 after fixes                      |
  | Pass 2  (States)     | 4/10 → 8/10 after fixes                      |
  | Pass 3  (Journey)    | 6/10 → 9/10 after fixes                      |
  | Pass 4  (AI Slop)    | 8/10 → 8/10 (no issues)                      |
  | Pass 5  (Design Sys) | 5/10 → 9/10 after fixes                      |
  | Pass 6  (Responsive) | 4/10 → 8/10 after fixes                      |
  | Pass 7  (Decisions)  | 2 resolved, 0 deferred                       |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (6 items)                            |
  | What already exists  | written                                      |
  | TODOS.md updates     | 0 items proposed                             |
  | Approved Mockups     | 3 rounds generated, round 3 approved         |
  | Decisions made       | 11 added to plan                             |
  | Decisions deferred   | 0                                            |
  | Overall design score | 4/10 → 8/10                                  |
  +====================================================================+
```

Outside voices were skipped: the owner's standing rule keeps Codex to the adversarial
pass only.

### Unresolved Decisions

None.

## Eng review (2026-10-15)

Target: this plan, `docs/designs/ask-me-options.md`. Report file: this file.

Scope Challenge: scope accepted as-is. Structure: the plan's arrangement, kept
without a layout question (owner's standing rule: no file or module arrangement
questions).

REALITY: premise-table finding 3 premises checked, unverified=0 src/shared/askMeRouting.ts:147
REALITY: already-done pass no options work on origin/main since 2026-10-14 src/renderer/src/components/AskMeTab.tsx:1
REALITY: surface-check pass IPC hive:patchTask accepts only humanQA src/main/index.ts:5385
REALITY: binding-decisions pass 2026-10-04 open-until-answered rule and 11 design decisions kept src/shared/askMeRouting.ts:100
REALITY: numbers pass [measured: tasks.json 2026-10-15] 157 asks, max 8 items, label p50 67 p90 144 max 326 docs/designs/ask-me-options.md:12
REALITY: deferred-asks n/a no linked issue docs/designs/ask-me-options.md:1
REALITY: pr-count pass one land on the running branch, no ship-policy.json docs/designs/ask-me-options.md:1

Premises:

| Premise | Claim | Receipt | Verdict |
|---|---|---|---|
| Answers land per entry only | mergeHumanQA takes `a` and `answeredAt` on the entry, nothing deeper | src/shared/askMeRouting.ts:147 | true |
| An ask is open until its entry has `a` | openIndexes checks entry `a` and `dismissedAt` | src/shared/askMeRouting.ts:125 | true |
| Owner answer provenance is per entry | answerKeysOf keys entries with `q`, `a`, `answeredAt` | src/main/index.ts:5365 | true |
| No field called `options` exists today | none in code or the 157 stored asks (the "Slack options" comment in hiveTasks.ts is stale) | src/renderer/src/components/hiveTasks.ts:117 | true |

## Decision ledger

### R1: How a partial answer to several questions is stored
Finding: 1, P1, confidence 9/10, src/shared/askMeRouting.ts:147 and :98, reviewer: Claude
Plan baseline: decision 2A (owner): answered parts are sent, the rest stay open on the card. Storage not decided.
Runtime evidence: mergeHumanQA lands only entry-level `a`; openIndexes keys openness on entry `a`; answerMessages tells Michael to re-ask unanswered questions as a new ask (askMeRouting.ts:98).
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R1 storage | none | each part keeps its own `a`/`answeredAt`; the entry is open while any part is open; entry `a` is written when the last part is answered | each reply closes the entry and the app adds a new ask holding the unanswered parts |
| Michael's re-ask line (askMeRouting.ts:98) | re-ask in a new ask | removed: the open parts stay on the same ask | kept, but the app does it |
| R2 provenance | per entry | pending | pending |
| R3 limits | none | pending | pending |

Question D1: How should a partial answer to several questions be saved?
Header: Part storage
Options:
A) Answers per question (recommended)
Each question keeps its own answer; the ask stays open until all are answered; Michael's re-ask line goes.
B) App re-asks the rest
Each reply closes the ask and the app adds a new ask with the unanswered questions.

State: approved
Actual answer: owner's own answer to D1 (2026-10-15): "user should never be forced to reply to all the open questions in an ask me card. if user answers just one out of 5 fully and one partially and leave rest 3 then michael should route those to agent and eventually agent should route back to michael remaining questions or additional info if agent is unable to figure out"
Accepted scope: one Reply settles the whole ask, with any number of questions answered (fully or partly) and the rest left blank. The entry closes as today: entry `a` holds the labeled answer, listing answered questions with their answers and naming the ones left unanswered; the answered parts' texts ride along in `partAnswers`, written only in the same patch. mergeHumanQA, openIndexes and owner answer provenance stay per entry. Michael routes the answers and the unanswered questions to the raiser; the raiser works out what it can and files back to Michael only what it still needs, and Michael re-asks the owner only then. Michael's line at askMeRouting.ts:98 changes from "re-ask the unanswered questions" to "send them to the raiser with the answers". Reverses design decision 2 (2A), on the owner's word.
History: Options offered were A) answers per question, the ask stays open (recommended) and B) the app re-asks the rest. The owner chose neither and gave the behavior above.

### R2: Owner answer provenance for the new answer shape
Finding: 2, P1, confidence 9/10, src/main/index.ts:5365, reviewer: Claude
Plan baseline: existing contract: every owner answer is fingerprinted when it lands (answerKeysOf) so the launch catch-up can tell it from text an agent wrote.
Runtime evidence: keys are per entry (`q`, `a`, `answeredAt`).
Disposition: no question needed. With R1 the answer is still one entry-level `a`, so the existing fingerprint covers it. Required proof carried forward: `partAnswers` is accepted only in the patch that lands the entry's `a`, and a test shows an agent-written `partAnswers` on an open ask is ignored and never shown.

### R3: Limits before an ask falls back to the plain card
Finding: 3, P2, confidence 8/10, docs/designs/ask-me-options.md (Questions for eng review), reviewer: Claude
Plan baseline: decision 1 (1A): unreadable fields mean the legacy card. Limits not decided.
Runtime evidence: [measured: tasks.json 2026-10-15] 157 asks; largest list 8 items; 2 asks over 6; item length p50 67, p90 144, max 326 characters.
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R3 limits | none | 2 to 8 options or questions; option label up to 200 characters, question up to 400; outside that, the plain card | no limits; render whatever arrives |

Question D2: What limits make an ask fall back to the plain card?
Header: Limits
Options:
A) 2 to 8, labels 200 (recommended)
2 to 8 options or questions; option labels up to 200 characters, questions up to 400; anything else shows as today's plain card.
B) No limits
Render every option and question however many or long.

State: approved
Actual answer: B) No limits (owner, 2026-10-15)
Accepted scope: no count or length limits on options or questions. The reader still falls back to the plain card only when the fields are unreadable: not an array, or an entry without a string label or question.
History: The brief said limits of 200 characters "fit all 157 real asks"; that was wrong (the longest real item is 326 characters). Corrected here; it does not change the owner's choice.

Approval readiness: PASS (R1: owner's own answer to D1; R2: carried-forward provenance contract, no new choice; R3: B, owner answer to D2).

### Data flow

```
Michael writes ask ──> tasks.json humanQA[i] { q, options? | parts?[ {q, options?} ] }
                                  │
              hiveTasks.parseTasks (keeps every field; reader validates)
                                  │
             askMeRouting.readAskShape(entry) ── unreadable ──> legacy card (today)
                    │ choice / parts / mixed
                    v
        AskMeTab renders rows, chips, lines; draft {pick, note, lines} in store
                    │ Reply (Cmd/Ctrl+Enter)
                    v
   askMeRouting.labeledAnswer() ──> "Picked: …" | "1: … 2: … Not answered: 3"
                    │
   hive:patchTask { humanQA } ──> mergeHumanQA: lands entry a, answeredAt,
                    │              picked / partAnswers ONLY with that a
                    v
   answerKeysOf fingerprint (unchanged) ──> answerMessages to Michael
                    │                        (answers + unanswered questions)
                    v
   Michael routes to raiser ──> raiser settles what it can ──> files back to
   Michael only what it still needs ──> Michael re-asks the owner if needed
```

### 1. Architecture review

- [P2] (confidence 8/10) docs/designs/ask-me-options.md "The ask, as Michael writes it": option labels will carry markdown. Michael is told to put amounts and names in backticks, and real items do ("`GammaTile`, HubSpot optimization, `$10,000`"). Labels and part questions render through the same inline markdown and file chips as the question (`FileText`), not as raw text. Necessary implementation of approved decisions 1 and 6; no new choice.
- [P2] (confidence 8/10) src/main/hive.ts: the team member side of R1. A raiser that gets answers plus unanswered questions must try to settle them and file back to Michael (triage) only what it still needs. This is new text in the team member instructions, beside Michael's. Accepted in R1.
- Failure: Michael keeps the instructions he started with until he restarts, so asks keep arriving as lists for a while. They show as today's plain card. Handled by the legacy fallback.
- Security: labels are agent text. React renders them as text through FileText (no HTML). `picked` and `partAnswers` are accepted only with the entry's `a` in the owner's patch (R2), so an agent cannot put words in the owner's mouth.

Dispositions: both accepted as necessary implementation (decisions 1, 6; R1).

### 2. Code quality review

- [P3] (confidence 9/10) src/renderer/src/components/hiveTasks.ts:117: the comment "Slack options and thread ids ride along" names a field nothing writes. Reword it when this lands, since `options` gets a real meaning.
- [P2] (confidence 9/10) src/renderer/src/store/store.ts:341: `answerDrafts: Record<string, string>` becomes `{ text, pick?, lines? }`. In memory only, so no migration. Necessary for decision 3.
- The labeled answer text is built once, in askMeRouting.ts, and used by AskMeTab and the tests: one shared helper with two real callers (renderer send, tests), no extraction elsewhere.

Dispositions: both accepted as necessary implementation.

### 3. Test review

```
CODE PATHS                                              USER FLOWS
[+] src/shared/askMeRouting.ts                          [+] Choice card
  ├── readAskShape(entry)                                 ├── [GAP] pick, Reply "Reply with option 1"
  │   ├── [GAP] options → choice                          ├── [GAP] pick + note
  │   ├── [GAP] parts (with and without options) → parts  ├── [GAP] own text only
  │   ├── [GAP] both fields / neither → legacy            └── [GAP] unpick by clicking again
  │   └── [GAP] non-array, missing label → legacy       [+] Several questions / mixed
  ├── labeledAnswer()                                     ├── [GAP] answer 1 of 5, Reply "Reply to 1 of 5"
  │   ├── [GAP] picked + note                             ├── [GAP] chip + typed text on one part
  │   └── [GAP] parts with "Not answered: …"              └── [GAP] all answered → "Reply"
  ├── mergeHumanQA()                                    [+] Errors and drafts
  │   ├── [★★★ TESTED] entry a lands once, ask-me-replaced.test.cjs  ├── [GAP] failed Reply keeps pick and lines
  │   ├── [GAP] picked/partAnswers only with a            └── [GAP] fold and reopen keeps pick (Draft tag)
  │   └── [GAP] agent partAnswers on an open ask ignored
  └── answerMessages()                                  [+] Keyboard
      ├── [★★ TESTED] request to Michael                  ├── [GAP] arrows move and pick in the group
      └── [GAP] unanswered questions routed to raiser     └── [GAP] Cmd/Ctrl+Enter sends from any field
[+] src/main/hive.ts instructions
  ├── [GAP] [→EVAL] Michael writes options / parts, "Done, I did it" for to-dos
  └── [GAP] [→EVAL] raiser settles unanswered questions, files back the rest
[+] src/renderer/src/components/TasksKanban.tsx
  └── [GAP] history shows "Picked: …" and the parts
[+] i18n
  └── [GAP] new keys in en, ar, zh-CN, no dashes (extend i18n-keys-exist)

COVERAGE: 2/24 paths tested | GAPS: 22 (2 eval)
```

Tests to add (each with its value card in the Test Plan artifact):

- `test/ask-me-options.test.cjs` (unit, loadTs): readAskShape cases, labeledAnswer cases, mergeHumanQA with `picked` and `partAnswers` (lands only with `a`; agent-written ones on an open ask ignored), answerMessages carries the unanswered questions and the routing line.
- Extend `test/ask-me-replaced.test.cjs`: the AskMeTab source renders option rows as a radiogroup, chips with `aria-pressed`, Reply on its own row with the label table, and the draft shape.
- Extend `test/i18n-keys-exist.test.cjs` coverage through the new `t()` keys; a no-dash check on the new strings.
- Prompt text tests in the existing hive instruction tests for Michael's fields and the raiser's line.
- [→EVAL] live check, not a suite: after the build, Michael posts one choice ask and one several-questions ask with fields, and a partial reply comes back from the raiser only for what it could not settle. The repo has no prompt eval suite; this live check is the evidence.

Tests made obsolete: none. The existing "Ask me shows a row per open question" assertions stay true.

### 4. Performance review

No issues found. Asks are a few dozen at most; parsing and rendering add a loop over at most a few options per open ask, on the existing 5 second poll.

### Outside voice

Skipped: the owner's standing rule keeps Codex to the adversarial pass only, with no Claude subagent in its place. No outside coverage for this plan review.

### Failure modes

| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| Reader | Michael writes `options` as a string, or labels as objects without text | readAskShape fallback + test | Today's plain card |
| Reply | The ask was withdrawn or changed while drafting | existing merge refusal + kept draft | "Your reply could not be saved", draft kept |
| Routing | Raiser never files back an unanswered question it could not settle | Michael's existing stuck card and open request checks | Nothing until Michael notices; a silent gap if both miss it |
| Provenance | An agent writes `partAnswers` on an open ask | merge accepts it only with the owner's `a` + test | Nothing: it is ignored |

Critical gaps: 0. The routing row has error handling through Michael's existing checks, so it is not silent by design, but it depends on agent behavior; the live check covers it.

### Worktree parallelization

| Step | Modules touched | Depends on |
|---|---|---|
| Ask shape and labeled answer | src/shared, src/main (merge) | none |
| Card UI and drafts | src/renderer/components, src/renderer/store | Ask shape |
| Instructions | src/main/hive.ts | Ask shape (field names) |
| History, strings, DESIGN.md | src/renderer/components, i18n, branding | Card UI |

Sequential implementation, no parallelization opportunity: every step depends on the ask shape, and the owner keeps one running branch.

### Eng completion summary

- Step 0: Scope Challenge: scope accepted as-is
- Reality rows: 7/7 emitted, 0 unverified premises
- Architecture Review: 2 issues found (both necessary implementation, accepted)
- Code Quality Review: 2 issues found (accepted)
- Test Review: diagram produced, 22 gaps identified (2 eval, covered by one live check)
- Performance Review: 0 issues found
- NOT in scope: written (design review section, unchanged)
- What already exists: written (design review section, unchanged)
- TODOS.md updates: 0 items proposed
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: skipped (owner rule: Codex for the adversarial pass only)
- Parallelization: 0 lanes, sequential
- Lake Score: 0/1 (D1 answered with the owner's own behavior; D2 picked the 6/10 option)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | none | none |
| Outside Review | codex, `/plan-eng-review` | Independent 2nd opinion | 0 | skipped (owner rule: Codex adversarial only) | none |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 6 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score: 4/10 → 8/10, 11 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | none | none |

- **OUTSIDE COVERAGE:** codex, plan review: skipped by the owner's standing rule (Codex only for the adversarial pass); design outside voices also skipped. No outside provider ran.
- **VERDICT:** DESIGN CLEARED. ENG REVIEWED: 6 findings, all mapped to tasks, 0 unresolved, 0 critical gaps; issues_open means mapped work, not a blocker. Ready to implement.

NO UNRESOLVED DECISIONS
