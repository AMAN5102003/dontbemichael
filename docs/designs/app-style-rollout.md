# One field style across the app

## Owner request (2026-10-23)

After Edit agent moved to soft panels and a label over body ramp
(`docs/designs/edit-agent-hierarchy.md`, 2B): "the entire app should use this new style
where ever possible to avoid inconsistencies".

Scope (design D1 A): every form and read only field screen: Settings (all tabs), the Access
tab, the schedule editor, the company profile (setup and Settings), Add a mailbox, the
Profile tab, the Command Center tabs, setup and the hire wizard. Ask me and Needs you cards,
the task board, chat, the floor and the terminal keep their card styles (DESIGN.md §7.8 and
on), since they are not forms.

## What is there today

| Where | Field label | Group container | Group heading |
|---|---|---|---|
| Edit agent, hire wizard (`components/fieldText.tsx`) | 13/18 600 ink | soft panel, `bg`, r-xl | none |
| Settings (`SettingsModal.tsx:177` `sectionHead`, used 21 times) | varies | hairline between sections (`sectionRule`) | 10 px 600 uppercase `ink-500` |
| Access tab (`triggers/ui.tsx` `TriggerCard`) | n/a | white card, 1 px `line` ring, r-xl | 13 px 600 ink, blurb 11.5 `ink-3` |
| Schedule editor (`triggers/ui.tsx:174` `Field`) | 10 px 600 uppercase `ink-3` | none | n/a |
| Company profile (`CompanyProfileFields.tsx:223` `Field`, `Head`) | 14 px 600 `ink-2`, hint 14 `ink-3` | none | 14 px 600 ink |
| Add a mailbox (`AddMailboxDialog.tsx:201` `Field`) | 12 px 600 `ink-2` | none | n/a |
| Profile tab (`ProfileTab.tsx:253` `Section`) | n/a | none | 13 px 600 `ink-700` |
| Command Center (`CommandCenterPanel.tsx:1337` `Section`) | n/a | none | 10 px 600 `ink-500` |
| Pulse (`pulse/PulseView.tsx:176` `Section`) | n/a | none | 13 px 600 |

Uppercase labels also appear in 20+ other components (`textTransform: 'uppercase'`).

## Mockup

`/Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/designs/app-style-rollout-20261023/app-style-rollout.html`
(HTML with DESIGN.md light tokens; owner rule). Before and after: a Settings section, an
Access group, the schedule editor, the company profile.

## Design review (2026-10-23)

Scope D1 A (above). Outside voices skipped (D2 B). Decisions numbered AS.

| ID | Issue | Decision (owner answer) |
|---|---|---|
| AS1 | Field labels | Every field label 13/18 600 ink, sentence case, from `fieldText.tsx` `fieldLabel`: the schedule editor's 10 px capitals, Add a mailbox's 12 px grey and the company profile's 14 px grey all go. (D3 A) |
| AS2 | Group containers | Every group on the shared soft panel (`bg`, r-xl, 14 by 16, no border or shadow): the Access tab's `TriggerCard` loses its ring and white fill but keeps its fold; Settings sections become panels instead of `sectionRule` hairlines; the schedule editor and the company profile sit on one panel. (D4 A) |
| AS3 | Group names | Where a group has a name (Settings sections, Access groups, Profile and Pulse sections, Command Center sections): 15/20 600 ink (`t-panel`, -0.02em) at the top of its panel, an `h3`. Retires the 10 px small caps (`sectionHead`), the 13 px `ink-700` and the 14 px heads. Edit agent's panels stay unnamed (2B). (D5 A) |
| AS4 | Hints and blurbs | One hint style: 12/17 400 ink 3, right under the field or group name; replaces the company profile's 14 px hints and the Access blurbs' 11.5 px. (D6 A) |
| AS5 | Keeping it | A test fails on an inline field label, group name, uppercase label or ringed group card outside `fieldText.tsx`, with a named exception list (cards per DESIGN.md §7.8 and on, chat, the floor, the terminal, pills, badges and chips, which keep `t-micro`); a DESIGN.md §4.2 rule says the same. (D7 A) |

Constraint (mechanics of AS2): the panel color is the page ground, so panels sit only
inside white surfaces (dialogs, the person and Michael panels, Settings), never on the stage.
Accessibility: group names are `h3`; ink 3 hints on the panel are about 5:1.

### Pass ratings

| Pass | Before | After | What's left |
|---|---|---|---|
| 1 Information architecture | 3 | 9 | live check of each converted screen |
| 2 Interaction states | 8 | 8 | none: states keep their wording, inside panels |
| 3 Journey | 6 | 9 | none |
| 4 AI slop | 8 | 9 | none: fewer rings and lines |
| 5 Design system | 3 | 9 | DESIGN.md §4.2, §7.12 and §7.26 text lands with the build |
| 6 Responsive and a11y | 5 | 9 | live check in dark mode (panel on card) |

### Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|---|---|---|---|
| Settings, Access, schedule editor, company profile | /Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/designs/app-style-rollout-20261023/app-style-rollout.html | the "Proposed" side of each pair | HTML with DESIGN.md light tokens (owner rule) |

### NOT in scope

- Cards, chat, the floor and the terminal (D1).
- Moving hints behind info icons (D6 B).
- Pills, badges and chips: they keep their uppercase `t-micro` (DESIGN.md §4.2).

### What already exists

`components/fieldText.tsx` (`fieldLabel`, `readBody`, `partLabel`, `JobParts`), Edit agent's
`Panel`, `TriggerCard` (fold behavior kept), `sectionHead` and `sectionRule` in Settings (to
retire), `Field` helpers in `triggers/ui.tsx`, `CompanyProfileFields.tsx`, `AddMailboxDialog.tsx`,
the `Section` helpers in ProfileTab, CommandCenterPanel and PulseView.

## Implementation Tasks

Updated by the eng review (2026-10-23): phased landing (D1), F1 (TriggerCard's three
screens), R1 (Command Center body white), WorkersTab's `sectionHead`. One commit per task,
in this order; the guard test lands last.

- [x] **T1 (P1, human: ~2h / CC: ~10min)** fieldText: `groupName` (t-panel h3), `hint` (12/17 ink 3), shared `Panel` and `Field` (label, optional info, hint, child); Edit agent and the hire wizard switch to them (AS1 to AS4)
  - Files: `components/fieldText.tsx`, `EditAgentModal.tsx`, `AddAgentModal.tsx`
  - Verify: `test/field-style-guard.test.cjs` contract tests for Field, Panel, groupName; existing Edit agent and wizard pins
- [x] **T2 (P1, human: ~4h / CC: ~20min)** `TriggerCard` becomes a soft panel with a group name and hint, fold kept, on Access, the Command Center and the Office schedule; the Command Center tab body and empty state turn white (AS2 to AS4, F1, R1)
  - Files: `triggers/ui.tsx`, `CapabilitiesTab.tsx`, `CommandCenterPanel.tsx`, `triggers/TriggersTab.tsx`
  - Verify: `test/michael-tabs.test.cjs`, `test/multi-mailbox-ui.test.cjs` rewritten where they pin the card
- [x] **T3 (P1, human: ~1 day / CC: ~45min)** Settings: every tab's sections on panels with group names; labels and hints from fieldText; `sectionHead` and `sectionRule` retired (AS1 to AS4)
  - Files: `SettingsModal.tsx`, MailboxesSettings, ClaudeConnectorsSettings, ResearchPrivacySettings, AiEnginesSettings, McpDefaultsSettings, IntegrationsRegistry, KnowledgeDocList, SettingsHeroCard as they apply
  - Verify: `test/settings-one-save.test.cjs`, `test/hidden-surfaces.test.cjs` rewritten where they pin the old heads
- [x] **T4 (P1, human: ~4h / CC: ~20min)** Schedule editor, company profile (setup and Settings), Add a mailbox: fields from fieldText on one panel (AS1, AS2, AS4)
  - Files: `triggers/ui.tsx` `Field`, `triggers/ScheduleList.tsx`, `CompanyProfileFields.tsx`, `AddMailboxDialog.tsx`, `OnboardingWizard.tsx` where it shows fields
  - Verify: `test/onboarding-currency-defaults.test.cjs`, `test/schedule-focus-areas.test.cjs` rewritten where they pin labels
- [x] **T5 (P2, human: ~3h / CC: ~15min)** Profile tab, Command Center, Workers and Pulse sections use `groupName` (AS3)
  - Files: `ProfileTab.tsx`, `CommandCenterPanel.tsx`, `WorkersTab.tsx`, `pulse/PulseView.tsx`, `GitTab.tsx` if shown
  - Verify: `test/scheduled-jobs-group.test.cjs` (Profile heading) and section pins
- [x] **T6 (P1, human: ~2h / CC: ~10min)** The guard test (inline labels, capitals and ringed group cards outside fieldText, a named file exception list for cards, chat, floor and terminal, and a `/* style-guard: micro */` line marker for pills and badges); DESIGN.md §4.2, §7.12 and §7.26 (AS5)
  - Files: `test/field-style-guard.test.cjs`, `branding/DESIGN.md`
  - Verify: the guard passes on the whole renderer; a planted inline label fails it

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW: COMPLETION SUMMARY                     |
  +====================================================================+
  | System Audit         | DESIGN.md present; UI scope: about 20 files |
  | Step 0               | 3/10; all form and field screens (D1 A)     |
  | Pass 1  (Info Arch)  | 3/10 to 9/10 after fixes                    |
  | Pass 2  (States)     | 8/10 to 8/10                                |
  | Pass 3  (Journey)    | 6/10 to 9/10 after fixes                    |
  | Pass 4  (AI Slop)    | 8/10 to 9/10 after fixes                    |
  | Pass 5  (Design Sys) | 3/10 to 9/10 after fixes                    |
  | Pass 6  (Responsive) | 5/10 to 9/10 after fixes                    |
  | Pass 7  (Decisions)  | 0 open, 0 deferred                          |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (3 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 1 drawn (HTML), 4 pairs                     |
  | Decisions made       | 5 added to plan (AS1 to AS5)                |
  | Decisions deferred   | 0                                           |
  | Overall design score | 3/10 to 8/10                                |
  +====================================================================+
```

Unresolved design decisions: none.

## Eng review (2026-10-23)

Target: `docs/designs/app-style-rollout.md`, reviewed by /plan-eng-review.

Scope record: feature answers: none asked; structure: A, original arrangement landed in
phases (owner, D1): shared pieces, then one commit per screen with its tests, the guard test
last; about 22 files, 0 new classes; accepted scope: AS1 to AS5; pending remedies: R1.

Factual correction (no behavior change): F1 (P2, 9/10) `TriggerCard` is used by
`CapabilitiesTab.tsx`, `CommandCenterPanel.tsx` and `triggers/TriggersTab.tsx`, so AS2's
"Access cards become panels" changes Michael's Command Center and Office schedule groups too;
T3 now names all three.

## Decision ledger

### R1: soft panels on the Command Center's tinted body
Finding: 1, P1, confidence 9/10, `CommandCenterPanel.tsx:1334` `background: 'var(--cth-paper-200)'` (the tab scroll body, = `card-2` #FAFAFD); the soft panel is `bg` #F7F7FB, Claude core review.
Plan baseline: AS2 (D4 A) panels everywhere, and its constraint "only inside white surfaces".
Runtime evidence: Michael's tabs render on paper-200, not white; a #F7F7FB panel on #FAFAFD is about 1 percent apart, so the groups would vanish there.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 panel visibility on the Command Center | invisible | the Command Center tab body turns white (`card`), like every other panel, so one panel color works | a second, darker panel tone (`chrome` #F1F0F8) for tinted bodies |
| AS1 to AS5 | approved | unchanged | unchanged |
Question D2: Michael's Command Center tabs sit on an off-white background where soft panels would disappear. Which fix? Options: A) White body (Recommended): Command Center tab body turns card white; one panel color. B) Darker panel tone: keep off-white body; panels use chrome #F1F0F8 there.
State: approved
Actual answer: A, White body (owner, 2026-10-23, D2)
Accepted scope: the Command Center tab body (`CommandCenterPanel.tsx:1334`, and its empty state at :1348) uses `--cth-card`; panels keep the one `bg` color app-wide.
History: none

### Eng review outputs

Failure modes:

| Path | Realistic failure | Handling | Test | User sees |
|---|---|---|---|---|
| Panels | a panel on a tinted surface vanishes | R1 white body; AS2 constraint | T2 pins; live check | grouped panels |
| TriggerCard | the fold breaks when the ring goes | fold markup kept, only the frame changes | michael-tabs, multi-mailbox-ui | folds as before |
| Guard | a legitimate pill flagged | `/* style-guard: micro */` line marker | T6 planted failure | none |

Critical gaps: 0. Worktree parallelization: sequential (T2 to T5 share `components/` and
the locales; phased commits per D1).

Approval readiness: PASS. Checked D1 A (structure, phased), R1 D2 A, D3 B (outside voice skipped); design AS1 to AS5 carried.

REALITY: premise-table pass unverified=0 (TriggerCard callers, paper-200 body, sectionHead users read) src/renderer/src/components/CommandCenterPanel.tsx:1334
REALITY: already-done pass no origin/main commits since 2026-10-23 on the named files src/renderer/src/components/triggers/ui.tsx:221
REALITY: surface-check pass no CLI or IPC named src/renderer/src/components/fieldText.tsx:1
REALITY: binding-decisions pass Edit agent 2B (soft panels, field labels only) carried, not reopened docs/designs/edit-agent-hierarchy.md:36
REALITY: numbers pass about 22 files counted from greps; efforts estimated docs/designs/app-style-rollout.md:1
REALITY: deferred-asks pass no linked issue docs/designs/app-style-rollout.md:1
REALITY: pr-count pass one land on the running branch, about 6 commits docs/designs/app-style-rollout.md:1

Eng completion summary:
- Step 0: Scope Challenge, scope accepted as-is (structure A phased, D1)
- Reality rows: 7/7 emitted, 0 unverified premises
- Architecture Review: 1 issue (R1, approved) and 1 factual correction (F1)
- Code Quality Review: 0 issues (WorkersTab added to T5)
- Test Review: diagram in tasks, 7 existing tests to rewrite, 1 new test file
- Performance Review: 0 issues
- NOT in scope: written
- What already exists: written (design section)
- TODOS.md updates: 0 items proposed
- Failure modes: 0 critical gaps
- Unresolved decisions: 0
- Outside voice: Codex, skipped (owner D3 B)
- Parallelization: 1 lane, sequential, about 6 commits
- Lake Score: 0/0 (no coverage-scored choices)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | |
| Outside Review | Codex gpt-5.4 (design and eng outside voice) | Independent 2nd opinion | 2 | skipped | owner D2 B (design), D3 B (eng) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 8 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score: 3/10 to 8/10, 5 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | |

- **OUTSIDE COVERAGE:** Codex, design phase and plan review phase, both skipped by the owner; no outside coverage for this plan.
- **VERDICT:** DESIGN CLEARED; eng review complete, every finding mapped to T1 to T6, 0 unresolved (issues_open counts R1 and the 7 test rewrites); ready to implement in phases.

NO UNRESOLVED DECISIONS
