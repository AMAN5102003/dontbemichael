# Edit agent: scheduled jobs that read as scheduled jobs

## Owner request (2026-10-23)

Looking at Edit Kelly after the job change flow landed: "there is no indication that check
emails is actually a scheduled job. and might be more confusion when there are multiple
schedule jobs doing different things".

## What is there today

- `ScheduledJobsList` (`src/renderer/src/components/ScheduledJobs.tsx`), rendered `compact`
  in Edit agent (`EditAgentModal.tsx`, the `schedules` row) and with a "Scheduled jobs"
  heading on the Profile tab (`ProfileTab.tsx`, `ScheduledJobsSection`).
- Each job is one line: the label in 600, ": ", then "Focus: <focus>" or "No focus area",
  and " (paused)" in ink 3 when switched off. No time, no count, no heading in Edit agent,
  no way to the place schedules are set (Access tab, "On a schedule",
  `CapabilitiesTab.tsx` `AgentSchedules`).
- Wide Edit agent puts the list straight under "What Kelly handles" in the left column, so
  it reads as more of the duties text.
- Reusable: `whenText()` (`triggers/ScheduleList.tsx`) writes "Every hour", "Weekdays at
  8:30"; DESIGN.md §2 sets schedule "when" lines in IBM Plex Mono; the Access tab's "On a
  schedule" rows (DESIGN.md, Access groups) already show name, next run and when line.

## Mockup

`/Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/designs/edit-agent-jobs-20261023/edit-agent-jobs.html`
(HTML with DESIGN.md light tokens; owner rule: HTML mockups only). Sections: 1 today, 2
proposed rows, 3A and 3B placements, 4 one column.

## Design review (2026-10-23)

Scope (D1 A): every gap on this list, in Edit agent and the Profile tab. Outside voices
skipped (D2 B). Decisions numbered SJ so they don't clash with the job change review.

| ID | Issue | Decision (owner answer) |
|---|---|---|
| SJ1 | No label | A "Scheduled jobs" heading with the count ("Scheduled jobs 3", count in ink 3) and an (i): "Work {{name}} does on a timer. When a job runs, {{name}} works on its focus, the way How {{name}} works says. Add or change jobs on the Access tab." Same Row label style as the other fields. (D3 A) |
| SJ2 | Placement | Wide Edit agent: its own group in the left column under What X handles, 14 px gap above, before the engine; the right column keeps How X works and What should change? only. One column: Role, What X handles, How X works, What should change?, Scheduled jobs, Engine. (D4 A, mockup 3A and 4) |
| SJ3 | No way to change | "Change on Access" at the right of the heading, a link style button. It closes Edit agent through the existing leave guard (Discard changes? when Name, Role, the engine or a typed change is unsaved) and opens the member's Access tab with On a schedule unfolded and scrolled into view. Michael's opens his Office schedule tab. (D5 A) |
| SJ4 | No time | Each job's when line from `whenText()` ("Every hour", "Weekdays at 8:30") at the right of its name, IBM Plex Mono 12 px, ink 2. No next run here. (D6 A) |
| SJ5 | Several jobs | One row per job: line one the name (13 px, 600) and the when line; line two the focus (12.5 px, ink 2) without the "Focus:" prefix, cut at two lines; "No focus area" in ink 3 when there is none. Rows split by a `line` hairline. Paused: a `neutral-soft` "Paused" pill (10.5 px, 600, ink 3) after the name, name and focus in ink 3. Every job shows, ordered by next run (paused last). (D7 A) |
| SJ6 | Empty, loading, failed | The heading always shows for a member who can hold schedules. No jobs: "None yet" (ink 3) and the link reads "Add on Access". Loading: nothing under the heading. Failed read: "Couldn't read the schedules." with Try again (`useMissions().retry`), `role=alert`. Research holds no schedules, so its group is hidden. (D8 B) |
| SJ7 | Narrow widths | The name wraps whole and is never cut; the when line never breaks (nowrap) and drops under the name when both don't fit. (D9 A) |

Accessibility (part of SJ1, SJ3, SJ7): the group is `role="group"` named by its heading and
count; jobs are a `ul` of `li`, each read as name, when, focus, then "Paused"; the link is a
real button in the tab order; the focus cut is visual only (screen readers read it whole).
The Profile tab uses the same component: its section heading becomes this heading, with the
count and the link, and SJ5 to SJ7 apply there too.

### Pass ratings

| Pass | Before | After | What's left |
|---|---|---|---|
| 1 Information architecture | 2 | 9 | live check that the left column doesn't crowd at 1280 by 800 |
| 2 Interaction states | 4 | 9 | none material |
| 3 Journey | 5 | 9 | the Access tab landing (unfolded, in view) is checked live |
| 4 AI slop | 8 | 8 | none: text rows, no cards, utility copy |
| 5 Design system | 6 | 9 | DESIGN.md §7.26 text lands with the build |
| 6 Responsive and a11y | 4 | 9 | live check in the narrow panel |

### Storyboard

| Step | Owner does | Owner feels | Plan specifies |
|---|---|---|---|
| 1 | Opens Edit Kelly | "What runs on its own?" | SJ1, SJ2: a labelled group apart from the duties |
| 2 | Scans the jobs | "How often does each run?" | SJ4, SJ5: name and when line, focus under it |
| 3 | Spots a paused job | "Is this one off?" | SJ5: Paused pill |
| 4 | Wants a job hourly instead | "Where do I change it?" | SJ3: Change on Access, lands on On a schedule |
| 5 | A member with no jobs | "Does Pam have any?" | SJ6: None yet, Add on Access |

### States

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Scheduled jobs group | heading only | "None yet", Add on Access | "Couldn't read the schedules." Try again | rows by next run | paused rows with the pill, last |

### Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|---|---|---|---|
| Edit agent and Profile scheduled jobs | /Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/designs/edit-agent-jobs-20261023/edit-agent-jobs.html | sections 2, 3A, 4 and 5 | HTML with DESIGN.md light tokens (owner rule); 3B was not chosen |

### NOT in scope

- Editing a job in Edit agent (D5 C): the Access tab stays its one home.
- The next run time in Edit agent (D6 B): it stays on the Access tab rows.
- Changing a schedule through What should change?: schedules change only through their own controls (owner, 2026-09-25).

### What already exists

`ScheduledJobsList` and `useScheduledJobs` (`ScheduledJobs.tsx`), `whenText()` and
`nextRunAt()` (`triggers/ScheduleList.tsx`, `shared/missions.ts`), `useMissions()` status and
retry, the Access tab's On a schedule group (`CapabilitiesTab.tsx`, its fold state),
`setSidebarTab`, Edit agent's leave guard, the `neutral-soft` "Read only" tag style.

## Implementation Tasks

Updated by the eng review (2026-10-23): F1 drops the Michael link, F2 adds the fullscreen
exit, R1 adds the when line wrap, and the tests are the proof of SJ1 to SJ7 and R1.

- [x] **T1 (P1, human: ~3h / CC: ~15min)** ScheduledJobs group: heading with count and (i), two line rows, when line wrapping only between its parts (R1), Paused pill, `orderedJobs()` in `shared/missions.ts` used here and by the Access list (`ScheduleList.tsx:669`), None yet with Add on Access, failed read with Try again, narrow wrap (SJ1, SJ4 to SJ7)
  - Surfaced by: design SJ1, SJ4 to SJ7; eng R1, Section 2
  - Files: `src/renderer/src/components/ScheduledJobs.tsx`, `src/shared/missions.ts`, `src/renderer/src/components/triggers/ScheduleList.tsx`, locales en, ar, zh-CN
  - Verify: `test/scheduled-jobs-group.test.cjs`; no dashes in new strings
- [x] **T2 (P1, human: ~2h / CC: ~10min)** Edit agent placement and Change on Access: own group in the left column; one column order; the link closes through the leave guard (Keep editing does nothing), calls `setFullscreen(null)` when `docked={false}` (F2), sets the Access tab and a one-shot `{agentId, seq}` request like `editAgentRequest`; `CapabilitiesTab` unfolds On a schedule, scrolls it into view and clears the request; Research shows no group (SJ2, SJ3, SJ6)
  - Surfaced by: design SJ2, SJ3, SJ6; eng Section 1, F1, F2
  - Files: `src/renderer/src/components/EditAgentModal.tsx`, `src/renderer/src/store/store.ts`, `src/renderer/src/components/CapabilitiesTab.tsx`
  - Verify: `test/scheduled-jobs-group.test.cjs`; update the order pins in `test/agent-role-fields.test.cjs` and `test/edit-agent-engine.test.cjs`
- [x] **T3 (P2, human: ~30min / CC: ~5min)** Profile tab uses the same group in place of its section (SJ1, SJ5 to SJ7)
  - Surfaced by: design D1 scope
  - Files: `src/renderer/src/components/ProfileTab.tsx`
  - Verify: `test/scheduled-jobs-group.test.cjs`; rewrite the FA1 pins in `test/schedule-focus-areas.test.cjs`
- [x] **T4 (P2, human: ~30min / CC: ~5min)** DESIGN.md §7.26: the Scheduled jobs group, rows, states and the link
  - Surfaced by: design Pass 5
  - Files: `branding/DESIGN.md`
  - Verify: read

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW: COMPLETION SUMMARY                     |
  +====================================================================+
  | System Audit         | DESIGN.md present; UI scope: 1 list, 2 tabs |
  | Step 0               | 3/10; all gaps (D1 A)                       |
  | Pass 1  (Info Arch)  | 2/10 to 9/10 after fixes                    |
  | Pass 2  (States)     | 4/10 to 9/10 after fixes                    |
  | Pass 3  (Journey)    | 5/10 to 9/10 after fixes                    |
  | Pass 4  (AI Slop)    | 8/10 to 8/10                                |
  | Pass 5  (Design Sys) | 6/10 to 9/10 after fixes                    |
  | Pass 6  (Responsive) | 4/10 to 9/10 after fixes                    |
  | Pass 7  (Decisions)  | 0 open, 0 deferred                          |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (3 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 1 drawn (HTML), sections 2, 3A, 4, 5        |
  | Decisions made       | 7 added to plan (SJ1 to SJ7)                |
  | Decisions deferred   | 0                                           |
  | Overall design score | 2/10 to 8/10                                |
  +====================================================================+
```

Unresolved design decisions: none.

## Eng review (2026-10-23)

Target: `docs/designs/edit-agent-scheduled-jobs.md`, reviewed by /plan-eng-review.

Scope record: feature answers: none asked (no cuts proposed); structure: A, original
arrangement (owner, D1), 9 files (ScheduledJobs, EditAgentModal, CapabilitiesTab,
ProfileTab, store, 3 locales, DESIGN.md), 0 new classes, a one-shot store request like
`editAgentRequest` (`store.ts:1272`) to open On a schedule unfolded; accepted scope: the
design review's SJ1 to SJ7 as written; pending remedies: R1.

Factual corrections (no behavior change, no question):

- F1 (P2, 9/10) `AgentDetailPanel.tsx:66` `if (agent.isGod) return <CommandCenterPanel agent={agent} />;`
  and `FullscreenTerminal.tsx` (Michael gets `CommandCenterPanel`): Michael never opens Edit
  agent, so SJ3's "Michael's opens his Office schedule tab" has no path to run. Dropped from
  the tasks.
- F2 (P3, 9/10) `store.ts:1453` "Focus mode is hidden in this build: nothing opens it": the
  fullscreen Edit agent (`docked={false}`) can't be reached today; the link there also calls
  `setFullscreen(null)` so it still lands on the panel if focus mode returns.

## Decision ledger

### R1: a when line too long for its row
Finding: 1, P2, confidence 8/10, `triggers/ScheduleList.tsx:224` `if (times) return formatTimes(times, words);` joins every time line, Claude core review
Plan baseline: SJ7 (owner D9 A): "the when line never breaks (nowrap) and drops under the name when both don't fit".
Runtime evidence: `formatTimes` (`shared/scheduleTimes.ts:258`) lists every "at" and "every" line of a job, so one job can read "Weekdays at 8:30, 12:00 and 17:00, every 2h from 9:00 to 17:00", wider than the 440 px panel; with nowrap it runs past the panel edge.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 long when line | nowrap, overflows | breaks only between its parts, never inside one ("8:30" stays whole) | one line cut with an ellipsis, the full line in a tooltip |
| SJ1 to SJ7 | approved | unchanged | unchanged |
Question D2:
D2: What happens when one job's "when" line is longer than its row? <gstack-qid:plan-eng-review-long-when-line>
Project/branch/task: docs/designs/edit-agent-scheduled-jobs.md on mit/1-1-scroll-expanded-response-f89475.
ELI10: You chose that a job's time never breaks, and drops under the name when both don't fit (SJ7). But one job can have several times, and the app writes them all on one line ("Weekdays at 8:30, 12:00 and 17:00, every 2h from 9:00 to 17:00", triggers/ScheduleList.tsx:224). In the narrow panel that line is wider than the row, so with no breaks it runs past the edge. Option A lets it break only between its parts, never inside one, so "8:30" or "every 2h" always stays whole. Option B keeps one line and cuts it with "...", the full line in a tooltip.
Stakes if we pick wrong: a job's times spill out of the panel, or the owner can't see all of them without hovering.
Recommendation: A, because every time stays readable at any width and SJ7's intent (never split a time) still holds.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Break between parts only (recommended)
  ✅ Every time of the job shows at every width, with nothing hidden behind a hover
  ✅ Keeps SJ7's rule that a single time like 8:30 is never split
  ❌ A job with many times takes two or three lines (human: ~1h / CC: ~5min)
B) One line, cut with an ellipsis, full text in a tooltip
  ✅ Every row keeps the same height however many times a job has
  ❌ Later times hide behind a hover, which needs a mouse and isn't read on a touchpad glance (human: ~30min / CC: ~3min)
Net: all times visible versus even rows.
Header: Long times
Options:
A) Break between parts (Recommended)
Wrap only at the commas between times; each time stays whole; no overflow.
B) Ellipsis and tooltip
One line, cut with "...", full text on hover.
State: approved
Actual answer: A, Break between parts (owner, 2026-10-23, D2)
Accepted scope: the when line may wrap only between its parts (after each ", " and before "and"); each part keeps its words together (no break inside "8:30", "every 2h", "Weekdays at 8:30"); no overflow at any panel width. SJ7 otherwise unchanged: the name wraps whole and the when line drops under it when both don't fit.
History: none

### Eng review outputs

Test plan: `/Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/moblizeit-mit-1-1-scroll-expanded-response-f89475-eng-review-test-plan-20261023-073939.md`.

Failure modes:

| Path | Realistic failure | Handling | Test | User sees |
|---|---|---|---|---|
| Change on Access | request not keyed or not cleared, Access unfolds on a later visit | `{agentId, seq}`, used once | T2 pin | nothing odd |
| Change on Access, dirty | link skips the leave guard and loses a typed change | goes through `requestClose` | T2 pin | Discard changes? |
| Reading schedules | `useMissions` error | SJ6 line with Try again | T1 pin | clear line, retry |
| Long when line | overflows the narrow panel | R1 wrap between parts | T1 pin, live at /ship | whole times |

Critical gaps: 0.

Worktree parallelization: sequential implementation, no parallelization opportunity (T1 to T3
share `src/renderer/src/components` and the locales).

NOT in scope (eng): a rendered click test of the link (no renderer harness in this repo; the
store and tab are pinned and the path is checked live at /ship).

Approval readiness: PASS. Checked D1 A (structure), R1 D2 A, D3 B (outside voice skipped);
design SJ1 to SJ7 carried from the design review (D3 to D9).

REALITY: premise-table pass unverified=0 (Michael path, focus mode, whenText join, request pattern, local fold all read) src/renderer/src/components/AgentDetailPanel.tsx:66
REALITY: already-done pass no origin/main commits since 2026-10-23 on the named files src/renderer/src/components/ScheduledJobs.tsx:17
REALITY: surface-check pass no CLI or IPC named; store and tab APIs read src/renderer/src/store/store.ts:1272
REALITY: binding-decisions pass no-chat-driven-schedule-changes honored (link, not text) docs/designs/edit-agent-scheduled-jobs.md:1
REALITY: numbers pass 9 files and 0 classes counted from the plan; efforts estimated docs/designs/edit-agent-scheduled-jobs.md:1
REALITY: deferred-asks pass no linked issue docs/designs/edit-agent-scheduled-jobs.md:1
REALITY: pr-count pass one land on the running branch docs/designs/edit-agent-scheduled-jobs.md:1

Eng completion summary:
- Step 0: Scope Challenge, scope accepted as-is (structure A, D1)
- Reality rows: 7/7 emitted, 0 unverified premises
- Architecture Review: 0 issues (2 factual corrections, F1 and F2)
- Code Quality Review: 0 issues
- Test Review: diagram produced, 14 gaps identified (all new paths)
- Performance Review: 0 issues
- NOT in scope: written
- What already exists: written (design section)
- TODOS.md updates: 0 items proposed
- Failure modes: 0 critical gaps
- Unresolved decisions: 0
- Outside voice: Codex, skipped (owner D3 B)
- Parallelization: 1 lane, 0 parallel / 4 sequential
- Lake Score: 1/1 (D2 picked the 10/10 option)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | |
| Outside Review | Codex gpt-5.4 (design and eng outside voice) | Independent 2nd opinion | 2 | skipped | owner D2 B (design), D3 B (eng) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | issues_open | 14 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 2 | clean | score: 2/10 to 8/10, 7 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | |

- **OUTSIDE COVERAGE:** Codex, design phase and plan review phase, both skipped by the owner (keep Codex to the ship adversarial pass); no outside coverage for this plan.
- **VERDICT:** DESIGN CLEARED; eng review complete with every finding mapped to T1 to T4 and 0 unresolved (status issues_open counts the 14 mapped test gaps); ready to implement.

NO UNRESOLVED DECISIONS
