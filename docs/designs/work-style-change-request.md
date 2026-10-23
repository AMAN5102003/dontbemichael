# Edit agent: say what should change, the app rewrites the job

Status: eng review done (2026-10-23), 9 owner decisions, not built. Target: the draft below, from the
owner's request in this session. Revises `docs/designs/edit-agent.md` (Briefing
fields) and closes the TODO "Show the rewritten instructions before saving a work
style".

## Owner request (2026-10-23)

"I am thinking it is still technical or complex for a business owner to edit what
agent handles as well as work style. They do not always understand the technical
nuance behind what matters to orchestrator and what to an agent. The way I envision
is, to keep 'what agent does' auto generated based on the work style. Further, work
style is a bit complicated when it comes to editing it as owner needs to understand
it fully and then figure out how to make non conflicting edits to it. May be a
better idea would be to keep the work style read only preview as well and asking
owner to provide only what they want to add or change and then use that to
intelligently update work style and what agent does part."

## Original plan (unchanged draft)

1. Edit agent shows both as read only, in plain words: what this member does, and
   how they do it.
2. One box: "What should change?" (for example "Also handle the refund emails, and
   ask me before any refund over $200.").
3. The app rewrites both together and shows the result before saving: a short
   summary ("Pam will now handle refund emails", "Pam will ask you before refunds
   over $200"), with Apply and Cancel.
4. "What X handles" is generated from the Work style every time, so the two can
   never disagree.

Things it needs to get right:

- Overlap with teammates: run the hire flow's overlap check on edits too; if the
  new duties overlap another member's, say which and stop before saving.
- Contradictions: if the change conflicts with the current Work style, ask one
  plain question instead of guessing.
- Specific duties: Michael routes by the generated role, so it must name real
  things (the inbox, the customers, the kind of request) and keep those names
  exactly as written.
- Undo: keep the previous version and offer "Undo last change".
- Agent behavior change: the role Michael reads comes from the model, not the
  owner's typing. Listed under Behavior changes at ship.

Runtime delivery is unchanged: the app still saves the same two things (the Work
style instructions as `goal`, and the role line in the office registry), and
agents and Michael receive them exactly as today.

Open decisions in the draft:

- Keep an "Edit full text" link for the rare owner who wants it, or read only with
  no link.
- Hiring: the same "describe once, generate both" flow now, or Edit agent first.
- Feed the Company foundations answers (brand voice and so on) into the rewrite.

## Scope record

Feature answers: D1 B (read only, no "Edit full text" link); D2 A (hiring gets the
same flow now, not later); D3 B (the rewrite checks a change against the Company
foundations answers and asks on a contradiction; it never copies them into a Work
style). Structure: D4 B (smaller arrangement: the existing `workStyle:convert`
channel gains a `revise` request; no new IPC or preload entry; about 12 files, 2
new units: the revise function and a shared preview component). Accepted scope:
the original plan above with those four answers. Pending remedies: none at this
point. Scope Challenge result: scope accepted as-is (D2 widened it; nothing cut).

## Scope Challenge findings

What already exists (reuse, not rebuild):

- `convertWorkStyle` (`src/main/workStyleConvert.ts:65`): plain to instructions and
  back, keeps old wording through `previous`, falls back to rules when the model
  can't run, picks Michael's engine (`runHiddenModel`).
- `checkDistinct` (`src/main/hireCheck.ts:56`): the hire overlap check, a model call
  with an instant rules fallback (`rulesVerdict`).
- `checkFocusArea` (`src/main/workStyleConvert.ts:125`): the pattern for "does this
  conflict with the Work style", returning `checked: false` when it can't run.
- `WorkStyleUpdateCards` (`src/renderer/src/components/WorkStyleUpdateCards.tsx`):
  the existing "see the new text, Use the new one or Keep mine" card.
- `sendTypedFirstTask` (`EditAgentModal.tsx:206`): one-time work typed into a Work
  style goes to Michael as a card, not into the standing instructions.
- `hivePatchAgentRole` (`src/main/hive.ts:1637`): writes the role line Michael
  routes by, effective on his next message.

Findings:

1. [P1] (confidence: 9/10) `src/renderer/src/components/AddAgentModal.tsx:499`:
   `setRouting((r) => appendOnce(... lines.own))`. The hire overlap fix appends a
   binding line (a mailbox, topic or connection) to "What X handles". Once that
   field is generated from the Work style, a regeneration can drop the binding and
   bring the overlap back. Necessary for D2 (no new choice): the binding is a
   structured input to the rewrite and is appended to the generated text by code,
   verbatim, after generation; a test pins it.
2. [P1] (confidence: 9/10) `EditAgentModal.tsx:107` `describe()`: the plain words the
   owner sees are a fresh model paraphrase of the instructions on every open
   (`to: 'plain'`, Haiku). With editing gone (D1), that paraphrase is the only view
   of the job. Choice D5 below.
3. [P2] (confidence: 8/10) The draft says "What X handles" is generated from the
   Work style every time. A rewrite that doesn't touch duties would still reword
   the line Michael routes by. Choice D6 below.
4. [P2] (confidence: 9/10) `EditAgentModal.tsx:206` `firstTaskSection(goal)`: one-time
   work in today's free text goes to Michael as a card. A change like "this week,
   chase the overdue invoices" must keep doing that. Necessary to preserve current
   behavior (no new choice): the revise result has a `oneTimeTask` field routed
   through `sendTypedFirstTask`, never written into the Work style.
5. [P2] (confidence: 8/10) Michael and his assistant have no "What X handles"
   (`EditAgentModal.tsx:157`: no Work style is required for them). Necessary: for
   them the rewrite returns only the Work style; no role line is generated.
6. Agent behavior change (record for ship): the role line Michael routes by is
   written by the rewrite, not typed by the owner.

## Decision ledger

### R5: what the read only view shows
Finding: 2, P1, confidence 9/10, `EditAgentModal.tsx:107`, Claude core review
Plan baseline: the draft shows the job "read only, in plain words"; no source named.
Runtime evidence: today the plain words are a Haiku paraphrase made on every open (`describe()`), shown at once as a rules rewrite, replaced when the model answers.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R5 view source | paraphrase on every open | plain words saved with each change | paraphrase on every open |
| D1 to D4 | approved | unchanged | unchanged |
| R6 handles stability | pending | pending | pending |
Question D5: Where should the read only plain words come from? (full brief as sent)
Header: Plain view
Options:
A) Save with each change (recommended)
The rewrite returns the plain words too; they're saved with the job and shown as is. Old members get theirs made once, the first time the dialog opens.
B) Paraphrase on each open
Keep today's behavior: a fresh model paraphrase every time the dialog opens.

State: approved
Actual answer: A (owner, 2026-10-23, D5)
Accepted scope: the rewrite returns the plain words with the instructions; they are saved with the member (a new durable field) and shown as is; a member without saved plain words gets them written once, the first time Edit agent opens; undo and pack updates keep them in step.
History: none

### R6: does "What X handles" change when duties don't
Finding: 3, P2, confidence 8/10, draft step 4, Claude core review
Plan baseline: draft: "generated from the Work style every time".
Runtime evidence: Michael routes by the registry role line (`hive.ts:1637`), re-sent to him when it changes.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R6 handles on a change | regenerated every time (draft) | kept word for word unless duties change | regenerated every time |
| R5 view source | approved: saved plain words | unchanged | unchanged |
| D1 to D4 | approved | unchanged | unchanged |
Question D6: Should "What X handles" stay word for word when a change doesn't touch duties? (full brief as sent)
Header: Handles
Options:
A) Keep unless duties change (recommended)
The rewrite says whether duties changed; if not, the line stays exactly as it was and Michael sees no change.
B) Regenerate every time
Every change rewrites the line, as drafted.

State: approved
Actual answer: A (owner, 2026-10-23, D6)
Accepted scope: the rewrite reports whether duties changed; when they didn't, "What X handles" is kept exactly as stored and the preview says it is unchanged; when they did, the new line is generated (binding lines appended verbatim by code, finding 1) and the overlap check runs on it.
History: none

### R7: a pack's new job description and the owner's changes
Finding: Section 1 A2, P1, confidence 9/10, `src/renderer/src/shell/workStyleOffers.ts:41` (`updateAgent(offer.agentId, { goal: offer.goal, description: offer.description })`), Claude core review
Plan baseline: not covered by the draft.
Runtime evidence: "Use the new one" replaces the Work style and role line wholesale; today an owner who typed edits loses them the same way.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R7 owner changes on "Use the new one" | silently replaced | the member's past change requests are reapplied to the new default, shown in the same preview | replaced, and the card says your changes will be replaced |
| R5, R6, D1 to D4 | approved | unchanged | unchanged |
Question D7: When a pack ships a new job description, what happens to the owner's changes? (full brief as sent)
Header: Pack update
Options:
A) Reapply my changes (recommended)
Each member keeps the list of change requests the owner applied; "Use the new one" runs the rewrite on the new default with that list and shows the result in the same preview before saving.
B) Replace, but say so
The card says "This replaces the changes you made to Pam's job" when there are any; plain words updated too.

State: approved
Actual answer: A (owner, 2026-10-23, D7)
Accepted scope: each member keeps the ordered list of change requests the owner applied (a new durable field, appended on Apply, trimmed by Undo); "Use the new one" runs the rewrite on the new default with that list and shows the result in the same preview before anything saves; "Keep mine" is unchanged.
History: none

### R8: members edited before this ships (outside voice OV1)
Finding: OV1, High, confidence 9/10, `store.ts:66`, `EditAgentModal.tsx:198`, Codex
Plan baseline: D7 A, reapply the member's change list on "Use the new one".
Runtime evidence: no change list exists for any member today; a member whose Work style differs from its pack default may hold typed edits.
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R8 earlier edits with no list | not covered | card says earlier edits can't be carried over, before the preview | keep D7 as is, silently drop them | investigate reconstructing them | defer |
| R7 (D7) | approved | unchanged | unchanged | unchanged | unchanged |
Question D8: What should "Use the new one" do for a member edited before this ships? (full brief as sent)
Header: Older edits
Options:
A) Apply: say they can't carry over (recommended)
B) Keep D7 as is
C) Investigate before choosing
D) Defer this change only

State: approved
Actual answer: A (owner, 2026-10-23, D8)
Accepted scope: on "Use the new one", a member whose Work style differs from the pack default it was hired with and has no change list gets one line on the card before the preview, "Your earlier edits to Pam's job will be replaced"; members with a change list follow D7.
History: none

### R9: stopping a rewrite that is still running (outside voice OV5)
Finding: OV5, Medium, confidence 9/10, `src/preload/index.ts:704`, Codex
Plan baseline: Section 4 said the call is aborted when the dialog closes; D4 B said no new IPC or preload entry.
Runtime evidence: `workStyleConvert` is a plain invoke with no request id or stop; `workStyle:suggestStop` shows the existing stop pattern.
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R9 rewrite stop | cannot stop | add a request id and one stop entry to the convert channel, like suggestStop | not stoppable; a late result is discarded | investigate | defer |
| D4 | approved B, no new entry | one stop entry added (amends D4) | unchanged | unchanged | unchanged |
Question D9: Should a rewrite stop when the owner closes the dialog? (full brief as sent)
Header: Stop rewrite
Options:
A) Apply: add a stop (recommended)
B) Keep: let it finish, discard
C) Investigate before choosing
D) Defer this change only

State: approved
Actual answer: A (owner, 2026-10-23, D9)
Accepted scope: the convert channel's revise request carries a request id; one stop entry (preload and main handler, the `workStyle:suggestStop` pattern) aborts it; Edit agent, the hire wizard and the pack card stop a running rewrite on close or cancel. Amends D4 by that one entry.
History: D4 B said no new IPC or preload entry.

Approval readiness: PASS. Checked D1 B, D2 A, D3 B, D4 B, D5 A, D6 A, D7 A, D8 A, D9 A
(owner answers, 2026-10-23); necessary work under them: findings 1, 4, 5, A1, A3,
A4, C1 to C4, P1, OV2 to OV4.

## Review sections

### 1. Architecture

```
Edit agent / hire wizard / pack update card
   |  owner types "What should change?" (or describes a new job, or taps Use the new one)
   v
workStyle:convert  { to: 'revise', current: {instructions, plain, handles, title},
   |                 changes: [..], bindings, foundations (check only), isLead }
   v
reviseWorkStyle (main, Michael's engine, Sonnet, 90 s, abortable)
   |-- model can't run / junk -----------> { error }  -> nothing saved, plain retry line
   |-- contradiction (job or foundations) -> { question } -> owner answers in the box, resubmit
   '-- ok --> { instructions, plain, handles | unchanged, summary[], oneTimeTask? }
                 |
                 | handles changed?  yes -> hire:checkDistinct (existing) -> overlap? block Apply, name who
                 v
        JobChangeReview preview: summary lines, Apply / Cancel
                 |
          Apply  | base unchanged since the rewrite started? no -> "changed meanwhile, try again"
                 v
   save previous version (undo) + change list; updateAgent(goal, plain, description);
   hivePatchAgentRole (Michael's routing line, only if handles changed);
   oneTimeTask -> sendTypedFirstTask (a card for Michael, never the Work style)
```

Findings:

- A1 [P1] (confidence: 9/10) `src/main/workStyleConvert.ts:66`: `convertWorkStyle` falls
  back to rules text when the model can't run. A free text change cannot be applied
  by rules. Necessary (no new choice): `revise` has no rules fallback; it returns an
  error, nothing saves, and the owner sees one plain line to try again.
- A2 [P1] pack updates: resolved by D7 (R7).
- A3 [P2] (confidence: 8/10) The preview can sit open while a pack update or another
  window changes the same member. Necessary: Apply compares the stored instructions
  and role with the ones the rewrite started from and refuses if they moved.
- A4 [P2] (confidence: 8/10) `src/main/hireCheck.ts:56`: the overlap check runs only
  when duties changed (D6) and blocks Apply on an overlap, naming the teammate, as
  the draft says. The hire wizard keeps its binding choice (finding 1).

Dispositions: A1, A3, A4 accepted as necessary work for the approved behavior; A2
approved as D7 A.

### 2. Code quality

- C1 [P2] (confidence: 9/10) `src/renderer/src/components/AddAgentModal.tsx:269`
  `suggestWorkStyle` needs "What X handles" first (`suggestNeedsHandles`). With D2 the
  hire wizard asks for one description and generates both, so Suggest me and the two
  text boxes go; a pack job shows its prefilled job read only with the same change
  box. Necessary for D2.
- C2 [P2] (confidence: 8/10) One shared `JobChangeReview` component (summary lines,
  overlap and question states, Apply and Cancel) serves Edit agent, the hire wizard
  and the pack update card. Three verified callers; written once.
- C3 [P3] (confidence: 9/10) The revise prompt lives in `src/shared/workStyleText.ts`
  beside `toInstructionsPrompt` and `toPlainPrompt`, so the three stay consistent.
- C4 [P3] Copy: no dashes (standing rule), fields only with explanations behind
  InfoTip (less verbose UI), roles named, never people, in generated text (no agent
  names in job text).

Dispositions: all accepted as necessary work.

### 3. Tests

```
CODE PATHS                                              USER FLOWS
[+] workStyleConvert.ts reviseWorkStyle (new)           [+] Edit agent: change a job
  ├── [GAP] request reader accepts/rejects revise        ├── [GAP] type change -> preview -> Apply saves 4 fields + role
  ├── [GAP] ok result parsed, handles unchanged kept     ├── [GAP] Cancel saves nothing
  ├── [GAP] question result (job / foundations)          ├── [GAP] Undo restores instructions, plain, handles, role
  ├── [GAP] model fails -> error, no rules text          ├── [GAP] overlap -> Apply blocked, teammate named
  ├── [GAP] binding lines appended verbatim              ├── [GAP] base moved meanwhile -> refused
  └── [GAP] oneTimeTask split out                        └── [GAP] one-time task -> card to Michael, not Work style
[+] workStyleText.ts toRevisePrompt (new)               [+] Hire wizard
  └── [GAP] [->EVAL] keeps names, never copies            ├── [GAP] describe once -> both generated -> hire
        foundations, roles not names                     └── [GAP] binding survives a regenerate
[+] workStyleOffers.ts decideWorkStyleOffer             [+] Pack update card
  └── [GAP] Use the new one reapplies the change list    └── [GAP] preview before save; Keep mine unchanged
EXISTING, MUST STAY GREEN: rename-in-edit-agent, edit-agent-engine, agent-role(-fields),
  work-style-text, work-style-suggest (retire the Suggest me cases), hire-wizard, hire-check-convert
COVERAGE: 0/17 new paths tested today (all new)
```

Proposed tests (each with its value card in the test plan artifact):

- `test/work-style-revise.test.cjs` (new, unit): reader, parser, unchanged handles,
  question path, failure path, bindings, one-time task, prompt text checks.
- `test/edit-agent-change.test.cjs` (new, renderer logic through the store and
  source pins as in `rename-in-edit-agent.test.cjs`): Apply, Cancel, Undo, stale
  base, overlap block, First task card.
- Extend `test/hire-wizard.test.cjs`: describe once, binding survives.
- Extend the pack offer test beside `workStyleUpdates`: reapply on Use the new one.
- [->EVAL] Live check at /ship with a real model on three changes (add a duty, a
  tone change, a contradiction), recorded like the foundation upload's live check;
  there is no eval harness in this repo.
- Retire: the Suggest me cases in `test/work-style-suggest.test.cjs` that assume
  "What X handles" is typed first.

### 4. Performance

- P1 [P3] (confidence: 8/10) One Sonnet call per change (90 s cap), plus a Haiku
  overlap check only when duties change; D5 removes the Haiku paraphrase that ran on
  every open today. The call is aborted when the dialog closes, like the hire check
  (`HireCheckDeps.signal`). No other hot path changes.

Dispositions: accepted.

## Outside voice (Codex, gpt-5.4, read only, 2026-10-23)

Five findings, all checked against the code:

- OV1 High: D7's change list doesn't exist for anyone edited before this ships
  (`store.ts:66` agent shape; `EditAgentModal.tsx:198` saves only `goal` and
  `description`). Choice D8 below.
- OV2 High: the stored role is one string, `Role: description` (`agentRole.ts:79`); a
  title only change must still be possible. Clarification, no new choice: the Role
  title stays a typed field, like Name; D6 governs only the "What X handles" part.
- OV3 High: other writers change `goal` and `description` (`store.ts:1094`
  `rewriteInstructions`, `typedFirstTask.ts:21` fallback, pack updates). Necessary for
  D5, no new choice: the saved plain words carry a fingerprint of the instructions
  they describe; any mismatch (another writer changed them) rewrites the plain words
  once, on the next open, through D5's written once path.
- OV4 Medium: Undo and side effects. Clarification: Undo restores the job text only
  (instructions, plain words, handles, role line); a one time task card already sent
  to Michael stays, as any card does.
- OV5 Medium: `workStyleConvert` (`preload/index.ts:704`) has no request id or stop,
  unlike `workStyle:suggestStop`, so D4's channel can't abort a running rewrite.
  Choice D9 below.

## The plan as approved

Edit agent shows the member's job read only, in plain words, and one box, "What
should change?". The hire wizard asks for one description of the job (a pack job
shows its default read only, with the same box). The pack update card's "Use the
new one" goes through the same rewrite. Every path ends in the same preview
(summary lines, Apply, Cancel) before anything saves. Name and the Role title stay
typed fields; the engine row is unchanged.

The rewrite (`to: 'revise'` on `workStyle:convert`, Sonnet on Michael's engine, 90 s,
stoppable) returns the new instructions, the plain words, "What X handles" (or
"unchanged" when duties didn't change), the summary lines and any one time task, or
one plain question when the change contradicts the job or a Company foundations
answer. It never falls back to rules text. Binding lines are appended to a generated
"What X handles" by code. Michael and his assistant get no handles line.

Saved per member: the instructions (`goal`), the plain words with the fingerprint
of the instructions they describe, the role line, the previous version (one level
of Undo, text only) and the ordered list of applied change requests (D7).

## NOT in scope

- An "Edit full text" link (D1 B): every change goes through the rewrite.
- Reconstructing edits made before this ships (D8 A says so on the card instead).
- An eval harness for the rewrite prompt: none exists in the repo; a live check at
  /ship covers it this time.
- Gemini and other engines for the rewrite: it runs where `runHiddenModel` runs
  today (Claude and Codex); others get the plain error line.

## What already exists

See Scope Challenge findings: `convertWorkStyle` and its request reader (extended,
not copied), `checkDistinct` (reused as is), `checkFocusArea` (pattern only),
`WorkStyleUpdateCards` (keeps its card, gains the shared preview),
`sendTypedFirstTask`, `hivePatchAgentRole`, the `workStyle:suggestStop` stop pattern.
New: `reviseWorkStyle` and `toRevisePrompt`, the `JobChangeReview` component.

## Failure modes

| Path | Realistic failure | Handling | Test | User sees |
|---|---|---|---|---|
| Rewrite | model signed out or times out | error, nothing saved | revise test | one plain retry line |
| Rewrite | junk or partial JSON | treated as a failure | revise test | same line |
| Preview open | job changed meanwhile | Apply refused | edit test | "changed meanwhile, try again" |
| Duties change | overlaps a teammate | Apply blocked | edit test | the teammate named |
| Hire | regenerate drops a binding | code appends it after | hire test | nothing (kept) |
| Other writers | plain words go stale | fingerprint, rewritten once | edit test | current words on open |
| Close mid rewrite | model keeps running | stop entry | revise test | nothing |

Critical gaps: 0.

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|------|----------------|------------|
| T1 rewrite in main | src/main, src/shared, src/preload | none |
| T2 saved fields | src/renderer/src/store | none |
| T3 preview component | src/renderer/src/components, locales | T2 |
| T4 Edit agent | src/renderer/src/components | T1, T3 |
| T5 hire wizard | src/renderer/src/components | T1, T3 |
| T6 pack update | src/renderer/src/shell, src/shared | T1, T3 |

Lane A: T1. Lane B: T2 then T3. Launch A and B together; then T4, T5 and T6 in
sequence (they share `src/renderer/src/components` and the locales).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [x] **T1 (P1, human: ~1 day / CC: ~35min)** main: the revise request
  - Surfaced by: D4, D9, A1, C3, OV5, findings 1, 4, 5
  - Files: `src/main/workStyleConvert.ts`, `src/shared/workStyleText.ts`, `src/main/index.ts`, `src/preload/index.ts`
  - Verify: `test/work-style-revise.test.cjs` (reader, ok, unchanged handles, question, failure without rules text, bindings, one time task, stop)
- [x] **T2 (P1, human: ~3h / CC: ~15min)** store: plain words with fingerprint, previous version, change list
  - Surfaced by: D5, D7, OV3, OV4
  - Files: `src/renderer/src/store/store.ts`, `src/shared/agentProfile.ts`
  - Verify: persisted across reload; Undo restores text only
- [x] **T3 (P1, human: ~4h / CC: ~20min)** `JobChangeReview` preview, locales en, ar, zh-CN
  - Surfaced by: C2, C4, A3, A4
  - Files: `src/renderer/src/components/JobChangeReview.tsx`, `src/renderer/src/i18n/locales/*.json`
  - Verify: no dashes in new strings (existing locale lint), light and dark
- [x] **T4 (P1, human: ~1 day / CC: ~30min)** Edit agent: read only job, change box, preview, Undo
  - Surfaced by: D1, D5, D6, findings 4, 5, OV2
  - Files: `src/renderer/src/components/EditAgentModal.tsx`
  - Verify: `test/edit-agent-change.test.cjs`; `rename-in-edit-agent` and `edit-agent-engine` stay green
- [x] **T5 (P1, human: ~1 day / CC: ~30min)** hire wizard: describe once, pack job read only, bindings kept
  - Surfaced by: D2, finding 1, C1
  - Files: `src/renderer/src/components/AddAgentModal.tsx`
  - Verify: extended `test/hire-wizard.test.cjs`; retire the Suggest me cases in `test/work-style-suggest.test.cjs`
- [x] **T6 (P2, human: ~4h / CC: ~20min)** pack update: reapply the change list, older edits line
  - Surfaced by: D7, D8
  - Files: `src/renderer/src/shell/workStyleOffers.ts`, `src/shared/workStyleUpdates.ts`, `src/renderer/src/components/WorkStyleUpdateCards.tsx`
  - Verify: a pack offer test (reapply, warning, Keep mine unchanged)
- [x] **T7 (P2, human: ~2h / CC: ~10min)** docs: DESIGN.md Edit agent and hire, `edit-agent.md` and `hire-redesign.md` pointers, close the TODOS.md item, CHANGELOG, Behavior changes note (finding 6)
  - Surfaced by: finding 6, TODO cross reference
  - Files: `branding/DESIGN.md`, `docs/designs/edit-agent.md`, `docs/designs/hire-redesign.md`, `TODOS.md`, `CHANGELOG.md`
  - Verify: read
- [ ] **T8 (P2, human: ~1h / CC: ~15min)** live check at /ship with a real model: add a duty, a tone change, a contradiction
  - Surfaced by: Test review [->EVAL]
  - Files: none (recorded in the ship notes)
  - Verify: the three previews read right and Apply saves them

## Build notes (2026-10-23)

Built on the running branch: T1 to T7 and DT1 to DT4. T8, the live check with a real model,
waits for /ship. Suggest me is retired end to end (wizard, IPC, prompt and tests); the
`to: 'instructions'` direction of `workStyle:convert` has no caller left and stays for now.
D8's older edits line shows for every member without a change list: the pack default a
member was hired with isn't stored, so a member never edited can't be told apart from one
edited before this shipped.

## Completion summary

- Step 0: Scope Challenge: scope accepted as-is (D2 widened it to hiring; nothing cut)
- Reality rows: 7/7 applicable rows emitted, 1 unverified premise (D3's "agents get the foundations every session")
- Architecture Review: 4 issues found (A1 to A4)
- Code Quality Review: 4 issues found (C1 to C4)
- Test Review: diagram produced, 17 gaps identified (all new paths)
- Performance Review: 1 issue found (P1)
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed (the plan closes one existing item)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: Codex gpt-5.4, completed, 5 findings (2 decisions D8 and D9, 3 clarifications)
- Parallelization: 2 lanes, 2 parallel / 4 sequential
- Lake Score: 1/3 (scored questions D2, D6, D7; only D2's answer was a 10/10 option)

REALITY: premise-table finding 1 unverified premise (D3 foundations delivery) docs/designs/work-style-change-request.md:1
REALITY: already-done pass no commits on main since 2026-10-15 touch these files src/renderer/src/components/EditAgentModal.tsx:152
REALITY: surface-check pass workStyle:convert, hire:checkDistinct, workStyle:suggestStop exist src/main/index.ts:6093
REALITY: binding-decisions pass owner rules applied (no dashes, fields only, roles not names, Michael routes) src/main/hive.ts:1637
REALITY: numbers pass file counts estimated, 90 s timeout measured src/main/workStyleConvert.ts:27
REALITY: deferred-asks pass no linked issue docs/designs/work-style-change-request.md:1
REALITY: pr-count pass one land on the running branch docs/designs/work-style-change-request.md:1

## Design review (2026-10-23)

Decisions are numbered DR so they don't clash with the eng review's D1 to D9. DR1 chose
all seven passes; DR2 ran Codex (gpt-5.4) as the outside design voice.

| ID | Decision (owner answer) |
|---|---|
| DR3 | Apply saves the job at once ("Pam's job is updated."). The footer is Close until Name, Role or Engine is edited, then Cancel and Save changes. (A) |
| DR4 | Order: Name, Role, What Pam handles, What should change?, then How Pam works folded to four lines with Show all, Undo last change and the last change line. (A) Owner, 2026-10-23, after seeing it built: What should change? moves under How Pam works, the more natural place, in Edit agent and the hire wizard. |
| DR5 | A clash is answered with two or three option rows (the Ask me radio style), one marked Suggested, plus Something else for a typed answer. The revise result returns these choices. (A) |
| DR6 | Overlap: "Kelly already chases overdue invoices." with Leave it with Kelly (drops that part, previews again) and Edit my change (box, text kept). Changed meanwhile: the typed change stays; See what changes again reruns it. (A) |
| DR7 | Undo is instant: "Pam's job is back to before your last change."; Michael's routing line goes back too; no dialog. (A) |
| DR8 | The preview replaces the change box in place: `indigo-soft` fill, r-xl, no border or shadow; summary lines are plain text with a 6 px indigo dot. (A) |
| DR9 | Labels: See what changes; See Jordan's job (hire); Apply; pack card title "A better job description for Pam", line "Your 2 changes will be kept.", See it, then Use it in the preview, and Keep mine. (A) |
| DR10 | Keyboard and screen readers: Cmd or Ctrl+Enter in the box runs the preview; the working line is `role=status`; focus moves to each new state's heading; errors are `role=alert`; after Apply or Undo focus returns to the box and the line is `role=status`; See the whole new job is a disclosure with `aria-expanded`; option rows follow the Ask me radio pattern. (A) |
| DR11 | Small windows: the Dialog footer stays pinned and the body scrolls; the preview's Cancel and Apply row sticks to the preview's bottom; the summary shows up to six lines, then Show all; checked at 1280 by 800 and the panel's narrowest width. (A) |
| DR12 | Hire wizard: the job is described on the Role step (name, role title, "What will Jordan do?", its preview, then the overlap check); Finalize keeps folder and model only; the Role hint reads "Name, job, overlap check". A pack job shows read only with an optional "Anything to change?". (A) |
| DR13 | Hire wizard: See Jordan's job shows the preview, exactly as See what changes does in Edit agent; Next turns on after Apply and runs the overlap check. (B, recommended) |
| DR14 | The mockup was redrawn with DR3 to DR13 (below). (A) |

### Pass ratings

| Pass | Before | After | What's left |
|---|---|---|---|
| 1 Information architecture | 3 | 8 | the hire wizard's long Role step on small windows |
| 2 Interaction states | 6 | 9 | Stop mid rewrite in the hire wizard follows Edit agent |
| 3 Journey | 5 | 8 | first use on a pack job with no changes is untested with owners |
| 4 AI slop | 6 | 9 | none material |
| 5 Design system | 6 | 9 | DESIGN.md §7.26 text lands in T7 |
| 6 Responsive and a11y | 3 | 9 | live check at 1280 by 800 at /ship |

### Storyboard (Edit agent)

| Step | Owner does | Owner feels | Plan specifies |
|---|---|---|---|
| 1 | Opens Edit Pam | "Where do I change her job?" | DR4: the box sits under the one line of duties |
| 2 | Types the change, presses See what changes | unsure it's final | DR9: the label says it only shows |
| 3 | Waits (about 9 seconds since 2026-10-23, no hidden thinking) | impatient | DR10 status line "Working out what changes for Pam…", its real steps and the words as they are written, Stop |
| 4 | Reads the change lines | checking it understood | summary lines, handles "Unchanged" tag, See the whole new job |
| 5 | Hits a clash or an overlap | stuck | DR5 option rows; DR6 Leave it with Kelly or Edit my change |
| 6 | Presses Apply | done, wants proof | DR3 "Pam's job is updated.", focus back in the box |
| 7 | Regrets it | worried | DR7 Undo, instant, with a line |

### States

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Edit agent change | "Working out what changes for Pam…", Stop | button off until text | "Couldn't work out the change", words kept, Try again | "Pam's job is updated." | clash rows; overlap; changed meanwhile |
| Hire describe once | same line, "for Jordan" | Next off | same | Next turns on | same as Edit agent |
| Pack update preview | same | n/a | same, card stays | "Pam's job is updated.", card leaves | older edits line (eng D8) |
| Undo | none (instant) | link hidden with no previous version | "Couldn't undo", Try again | "Pam's job is back to before your last change." | n/a |

### Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|----------------|-------------|-----------|-------|
| Edit agent, preview states, hire Role step, pack card | /Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/designs/job-change-20261023/job-change-v2.html | one calm column, preview on indigo-soft in place of the box | HTML with DESIGN.md light tokens (owner rule: HTML mockups only); v1 beside it is superseded |

### Design review: NOT in scope

- Dark theme drawing of the mockup: the tokens switch with the theme; checked live at /ship.
- A diff view of the old and new job: the summary lines carry what changed (DR4, DR8).

### Design review: what already exists

DESIGN.md §7.26 Edit agent (one column, labels, info icons), §7.23 Dialog footer and
focus, §7.8 Ask me card and its option rows (`cth-askme-opt`), the `indigo-soft`
selection token, `WorkStyleUpdateCards` frame.

### Implementation Tasks (design review)

- [x] **DT1 (P1, human: ~4h / CC: ~20min)** JobChangeReview: DR5, DR6, DR8, DR10, DR11 states and look
  - Surfaced by: Passes 2, 4, 6
  - Files: `src/renderer/src/components/JobChangeReview.tsx`, locales
  - Verify: `test/edit-agent-change.test.cjs` covers focus targets and roles; live check at 1280 by 800
- [x] **DT2 (P1, human: ~3h / CC: ~15min)** Edit agent: DR3 footer, DR4 order and fold, DR7 Undo line, DR9 labels
  - Surfaced by: Passes 1, 2, 5
  - Files: `src/renderer/src/components/EditAgentModal.tsx`, locales
  - Verify: edit test; rename and engine tests stay green
- [x] **DT3 (P1, human: ~3h / CC: ~15min)** Hire wizard: DR12 Role step, DR13 buttons, Finalize without Work style, new hint
  - Surfaced by: Pass 7
  - Files: `src/renderer/src/components/AddAgentModal.tsx`, locales
  - Verify: extended `test/hire-wizard.test.cjs`
- [x] **DT4 (P2, human: ~1h / CC: ~10min)** Pack card copy (DR9) and DESIGN.md §7.26 and §7.8 text
  - Surfaced by: Pass 5
  - Files: `src/renderer/src/components/WorkStyleUpdateCards.tsx`, `branding/DESIGN.md`, locales
  - Verify: read; no dashes in new strings

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW: COMPLETION SUMMARY                     |
  +====================================================================+
  | System Audit         | DESIGN.md present; UI scope: 4 screens      |
  | Step 0               | 3/10; all seven passes                      |
  | Pass 1  (Info Arch)  | 3/10 to 8/10 after fixes                    |
  | Pass 2  (States)     | 6/10 to 9/10 after fixes                    |
  | Pass 3  (Journey)    | 5/10 to 8/10 after fixes                    |
  | Pass 4  (AI Slop)    | 6/10 to 9/10 after fixes                    |
  | Pass 5  (Design Sys) | 6/10 to 9/10 after fixes                    |
  | Pass 6  (Responsive) | 3/10 to 9/10 after fixes                    |
  | Pass 7  (Decisions)  | 2 resolved, 0 deferred                      |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (2 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 2 drawn (HTML), 1 approved (v2)             |
  | Decisions made       | 11 added to plan (DR3 to DR13)              |
  | Decisions deferred   | 0                                           |
  | Overall design score | 3/10 to 8/10                                |
  +====================================================================+
```

Unresolved design decisions: none.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | |
| Outside Review | Codex gpt-5.4 (eng outside voice; design outside voice) | Independent 2nd opinion | 2 | completed | eng: 5 findings, 2 decided (D8, D9); design: 9 findings, folded into DR3 to DR13 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 3 | issues_open | 26 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 2 | clean | score: 3/10 to 8/10, 11 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | |

- **OUTSIDE COVERAGE:** Codex gpt-5.4, plan-review phase, completed (5 findings); Codex gpt-5.4, design phase, completed (9 findings: save model, visual anchor, hire step, state structure, clash choices, labels, keyboard, small window, pack card).
- **CROSS-MODEL:** the native design passes and Codex agreed on the save model, the change box's place, clash choices and keyboard behavior; Codex's hire step rename conflicted with the existing Job step, so DR12 kept the Role step name and changed its hint.
- **VERDICT:** DESIGN CLEARED (every pass 8 or more); eng review mapped all issues to tasks T1 to T8 and DT1 to DT4; ready to build.

NO UNRESOLVED DECISIONS
