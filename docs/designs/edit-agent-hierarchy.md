# Edit agent: a layout you can read at a glance

## Owner request (2026-10-23)

Looking at the wide Edit Kelly: "it is still very hard to read and clearly understand the
page layout, different sections due to so similar text size of body and headings and not
much visual cues."

## What is there today

- Field labels: 12 px, 600, `ink-2` (`EditAgentModal.tsx` `Row` and `ReadRow`; `JobChangeReview`
  box label; `ScheduledJobs` label style). Read only text in the wide panel: `t-read`, 14/22,
  400, `ink` (DESIGN.md §4.2). The label is smaller and lighter than the text it labels.
- No section headings: owner, 2026-10-02 (docs/designs/edit-agent.md D3), "field labels
  only"; pinned by `test/edit-agent-engine.test.cjs` (no `<Section`, no `hint=`).
- Wide layout: left column Name, Role, What X handles, Scheduled jobs, Engine, Danger zone;
  right column How X works, What should change? (DR4, SJ2).
- How X works: the plain words keep their run in labels ("The job:", "How the work is
  done:", "Asks the owner first:") at body weight, in one `pre-wrap` block, folded to four
  lines.
- Scheduled jobs: its label (12 px grey) is outranked by each job name (13 px 600 ink).

## Mockup

`/Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/designs/edit-agent-hierarchy-20261023/edit-agent-hierarchy.html`
(HTML with DESIGN.md light tokens; owner rule). Sections: 1 today, 2A section headings with
a three step ramp, 2B soft panels with the same ramp.

## Design review (2026-10-23)

Scope (D1 A): the whole screen, both widths, and the hire wizard's matching fields. Outside
voices skipped (D2 B). Decisions numbered H so they don't clash with earlier reviews.

| ID | Issue | Decision (owner answer) |
|---|---|---|
| H1 | Grouping | Soft panels, field labels only (owner, 2026-10-23, after seeing 2A built: "i liked 2B"): each group on the ground color (`bg`), r-xl, 14 by 16 padding, no border or shadow; Name and Role, the job (What X handles, How X works), Scheduled jobs; What should change? sits under the job panel, the Engine line and Danger zone below the panels. edit-agent.md D3 (no section headings) stands. History: first answered A, section headings (D3 A), built in 8dcf4ca6, then changed to B. |
| H2 | Where What X handles sits | Under "Kelly's job" in the right column: What Kelly handles, How Kelly works, What should change?. Left column: Name, Role, Scheduled jobs, Engine, Danger zone. Supersedes the column split of SJ2 for the duties line only. One column: Name, Role, Kelly's job (handles, how she works, what should change), Scheduled jobs, Engine, Danger zone. (D4 A) |
| H3 | Type ramp | Section heading `t-panel` 15/20 600 ink, tracking -0.02em; field label `t-ui` 13/18 600 ink; read only body `t-read` 14/22 400 ink 2 in the wide layout, `t-ui` 13/20 400 ink 2 in one column. The Scheduled jobs heading uses the section step; each job name stays 13 600 ink. (D5 A) |
| H4 | How X works parts | The plain words split on their part labels ("The job:", "How the work is done:", "Asks the owner first:" with or without words after them, or any short "Label:" alone on its line, so a sentence with a colon never splits; build note): each part's name on its own line (12/16 600 ink), its words under it in body, 10 px between parts. Folded, the whole first part shows, then Show all; text without labels shows as one block, folded at four lines as before. (D6 A) |
| H5 | Hire wizard | The same label, body and parts treatment on the hire wizard (its `Row` and `ReadRow`, so every step's field labels), and on the shared change box; no section headings there. (D7 A) |

Spacing (mechanics of H1): panels 14 px apart, fields within a panel 14 px apart.

### Pass ratings

| Pass | Before | After | What's left |
|---|---|---|---|
| 1 Information architecture | 2 | 9 | live check at 1280 by 800 and the narrow panel |
| 2 Interaction states | 8 | 8 | none: static text |
| 3 Journey | 5 | 9 | none |
| 4 AI slop | 8 | 9 | none: headings and hairlines, no cards |
| 5 Design system | 5 | 9 | DESIGN.md §4.2 and §7.26 text lands with the build |
| 6 Responsive and a11y | 5 | 9 | live check in the narrow panel |

### Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|---|---|---|---|
| Edit agent wide | /Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/designs/edit-agent-hierarchy-20261023/edit-agent-hierarchy.html | section 2B | HTML with DESIGN.md light tokens (owner rule); 2A built first, then replaced; body 14 px in the build (mockup drew 13.5); panel color `bg` (the mockup's #F6F5FA) |

### NOT in scope

- Section headings (first chosen as D3 A, replaced by 2B).
- Uppercase micro labels (D5 B).
- Section headings in the hire wizard (D7: its steps are the sections).

### What already exists

`t-panel`, `t-ui`, `t-read` (DESIGN.md §4.2), the `line` hairline, `ReadRow` and `Row`
(EditAgentModal, AddAgentModal), `JobChangeReview`'s box label, `ScheduledJobsList`'s
`heading="section"` style.

## Implementation Tasks

Updated by the eng review (2026-10-23): R1 adds the shared `fieldText.tsx`, R2 the parts in the preview.

- [x] **T1 (P1, human: ~1h / CC: ~5min)** `components/fieldText.tsx`: `sectionHeading`, `fieldLabel`, `readBody(wide)`, `partLabel`, and `JobParts` (folded or not); `plainParts()` in `shared/workStyleText.ts` (R1, R2, H3, H4)
  - Verify: `test/job-layout.test.cjs` unit tests `plainParts` (own line and inline labels, no labels, text before the first label, "9:00" and links not split, "：")
- [x] **T2 (P1, human: ~3h / CC: ~15min)** Edit agent: Name and Role at the top, `h3` "{{name}}'s job" with What X handles, How X works (JobParts, folded to the first part) and What should change? on the right; `h3` Scheduled jobs (heading step), Engine, Danger zone on the left; hairlines; one column order (H1, H2, H3)
  - Files: `EditAgentModal.tsx`, `ScheduledJobs.tsx` (a `panel` heading), locales (`jobChange.jobOf`)
  - Verify: rewrite the order pins in `test/agent-role-fields.test.cjs`, `test/edit-agent-engine.test.cjs`; pins in `test/job-layout.test.cjs`
- [x] **T3 (P1, human: ~1h / CC: ~10min)** Hire wizard and the shared change box: labels and read text from fieldText, How Jordan works as JobParts; the preview's whole new job as JobParts with no fold (H5, R2)
  - Files: `AddAgentModal.tsx`, `JobChangeReview.tsx`
  - Verify: pins in `test/job-layout.test.cjs`
- [x] **T4 (P2, human: ~30min / CC: ~5min)** DESIGN.md §4.2 (label step) and §7.26; edit-agent.md D3 marked superseded by H1
  - Files: `branding/DESIGN.md`, `docs/designs/edit-agent.md`
  - Verify: read

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW: COMPLETION SUMMARY                     |
  +====================================================================+
  | System Audit         | DESIGN.md present; UI scope: 2 dialogs      |
  | Step 0               | 3/10; whole screen (D1 A)                   |
  | Pass 1  (Info Arch)  | 2/10 to 9/10 after fixes                    |
  | Pass 2  (States)     | 8/10 to 8/10                                |
  | Pass 3  (Journey)    | 5/10 to 9/10 after fixes                    |
  | Pass 4  (AI Slop)    | 8/10 to 9/10 after fixes                    |
  | Pass 5  (Design Sys) | 5/10 to 9/10 after fixes                    |
  | Pass 6  (Responsive) | 5/10 to 9/10 after fixes                    |
  | Pass 7  (Decisions)  | 0 open, 0 deferred                          |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (3 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 1 drawn (HTML), section 2A approved         |
  | Decisions made       | 5 added to plan (H1 to H5)                  |
  | Decisions deferred   | 0                                           |
  | Overall design score | 2/10 to 8/10                                |
  +====================================================================+
```

Unresolved design decisions: none.

## Eng review (2026-10-23)

Target: `docs/designs/edit-agent-hierarchy.md`, reviewed by /plan-eng-review.

Scope record: feature answers: none asked; structure: A, original arrangement (owner, D1),
about 10 files (EditAgentModal, AddAgentModal, JobChangeReview, ScheduledJobs,
`shared/workStyleText.ts`, 3 locales, DESIGN.md, edit-agent.md), 0 new classes; accepted
scope: H1 to H5 as written; pending remedies: R1, R2.

## Decision ledger

### R1: one shared style for headings, labels and read text
Finding: 1, P2, confidence 9/10, Claude core review. The label style `{ fontSize: 12, fontWeight: 600, color: 'var(--cth-ink-2)' }` is written out in 7 places: `EditAgentModal.tsx:668` (ReadRow), `:682` (Row), `:422` (Engine), `AddAgentModal.tsx:1440` (ReadRow), `:1455` (Row), `JobChangeReview.tsx:218` (box label), `:268` (preview handles), plus `ScheduledJobs.tsx:106` `labelStyle`.
Plan baseline: H3 and H5 (owner D5 A, D7 A): one ramp in Edit agent, the hire wizard, the change box and the jobs heading.
Runtime evidence: the copies are identical today; nothing ties them together, so a later tweak in one leaves the others behind.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 where the ramp lives | 7 inline copies | one module `components/fieldText.ts` (sectionHeading, fieldLabel, readBody) used by all 7 | each copy edited in place |
| H1 to H5 | approved | unchanged | unchanged |
| R2 parts in the preview | pending | pending | pending |
Question D2: Put the heading, label and read-text styles in one shared place? Options: A) One shared file (Recommended): fieldText.ts with heading, label and read-text styles, used by all 7. B) Edit in place: change each of the 7 copies where it is.
State: approved
Actual answer: A, One shared file (owner, 2026-10-23, D2)
Accepted scope: `src/renderer/src/components/fieldText.ts` exports `sectionHeading` (t-panel 15/20 600 ink, -0.02em), `fieldLabel` (13/18 600 ink), `readBody(wide)` (14/22 or 13/20, 400, ink 2) and `partLabel` (12/16 600 ink); the 7 copies use it; tests pin the module.
History: none

### R2: the preview's whole new job in parts
Finding: 2, P3, confidence 8/10, Claude core review. `JobChangeReview.tsx:277` shows "See the whole new job" as one `pre-wrap` block of `ok.plain`, the same plain words H4 now splits into parts in Edit agent and the hire wizard.
Plan baseline: H4 (owner D6 A) names How X works in Edit agent and the hire wizard; the preview isn't named.
Runtime evidence: one block today.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 preview whole job | one block | same parts as How X works (no fold; it's already a disclosure) | one block as today |
| R1, H1 to H5 | approved | unchanged | unchanged |
Question D3: Should the preview's "See the whole new job" show the same parts? Options: A) Same parts (Recommended): whole new job shown in parts, no fold. B) One block: leave the preview as it is.
State: approved
Actual answer: A, Same parts (owner, 2026-10-23, D3)
Accepted scope: one `JobParts` renderer (in `components/fieldText.tsx`, beside the styles) draws the plain words in parts for How X works in Edit agent and the hire wizard (folded to the first part) and for the preview's whole new job (no fold), so the pack update card shows parts too.
History: none

### Eng review outputs

Failure modes:

| Path | Realistic failure | Handling | Test | User sees |
|---|---|---|---|---|
| plainParts | a time or link read as a part label | label must start with a letter, no `/`, not before `//` | T1 unit | whole text |
| plainParts | model writes no labels | one part, four-line fold as before | T1 unit | the text as today |
| Layout | a test still pins the old order | rewritten pins | T2 | none |

Critical gaps: 0. Worktree parallelization: sequential implementation, no parallelization
opportunity (all tasks share `src/renderer/src/components`).

NOT in scope (eng): a rendered layout test (no renderer harness; checked live at /ship).

Approval readiness: PASS. Checked D1 A (structure), R1 D2 A, R2 D3 A, D4 B (outside voice skipped); design H1 to H5 carried from the design review.

REALITY: premise-table pass unverified=0 (the 7 label copies and the preview block read at their lines) src/renderer/src/components/JobChangeReview.tsx:277
REALITY: already-done pass no origin/main commits since 2026-10-23 on the named files src/renderer/src/components/EditAgentModal.tsx:668
REALITY: surface-check pass no CLI or IPC named src/shared/workStyleText.ts:1
REALITY: binding-decisions pass reverses edit-agent.md D3 by owner D3 A (design review), logged docs/designs/edit-agent-hierarchy.md:36
REALITY: numbers pass 11 files with fieldText, 0 classes; efforts estimated docs/designs/edit-agent-hierarchy.md:1
REALITY: deferred-asks pass no linked issue docs/designs/edit-agent-hierarchy.md:1
REALITY: pr-count pass one land on the running branch docs/designs/edit-agent-hierarchy.md:1

Eng completion summary:
- Step 0: Scope Challenge, scope accepted as-is (structure A, D1)
- Reality rows: 7/7 emitted, 0 unverified premises
- Architecture Review: 0 issues
- Code Quality Review: 2 issues (R1 shared styles, R2 preview parts), both approved
- Test Review: diagram produced, 10 gaps identified (all new paths)
- Performance Review: 0 issues
- NOT in scope: written
- What already exists: written (design section)
- TODOS.md updates: 0 items proposed
- Failure modes: 0 critical gaps
- Unresolved decisions: 0
- Outside voice: Codex, skipped (owner D4 B)
- Parallelization: 1 lane, 0 parallel / 4 sequential
- Lake Score: 2/2 (D2 and D3 picked the 10/10 option)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | |
| Outside Review | Codex gpt-5.4 (design and eng outside voice) | Independent 2nd opinion | 2 | skipped | owner D2 B (design), D4 B (eng) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 12 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score: 2/10 to 8/10, 5 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | |

- **OUTSIDE COVERAGE:** Codex, design phase and plan review phase, both skipped by the owner; no outside coverage for this plan.
- **VERDICT:** DESIGN CLEARED; eng review complete, every finding mapped to T1 to T4, 0 unresolved (issues_open counts the 2 approved code findings and 10 test gaps); ready to implement.

NO UNRESOLVED DECISIONS
