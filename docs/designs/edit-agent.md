# Edit agent: only what can change on someone already hired

> 2026-10-23: D3 ("no section headings, field labels only") stands; the groups now sit on soft
> panels, with labels that outrank their text. See `docs/designs/edit-agent-hierarchy.md` (H1).

> 2026-10-23: the job is read only now. "What X handles" and the Work style change through
> "What should change?" and its preview; see `docs/designs/work-style-change-request.md`.
> Sections below that describe typing them are history.

Status: built in the working tree (2026-10-02), not yet run in the app. Owner decisions D1 to D3 below.

## Problem

Owner, 2026-10-02: "edit agent screen is a mess. It does not make sense to change
an agent to some other agent like pam to michael or toby to jim. Each agent has a
role and job function so picking a random agent, with a random role should be
possible only for new agent wizard. Also what is the significance of picking a
color for an agent?"

## What exists today

`src/renderer/src/components/EditAgentModal.tsx`, two columns:

- **Identity** (Name, Character, Color). Character lists the whole cast, Michael
  included; picking one also renames the agent (`setName(c.displayName)`), so
  Pam becomes a second "Michael" in one click. Color is six swatches saved as
  `accent`.
- **Engine** (Provider, Model), under Identity on the left.
- **Briefing** (Role, What X handles, Work style) on the right.

What the two fields actually do in the v2 design:

- `character` draws a portrait only in Michael's panel (CommandCenterPanel) and
  in focus mode, which is hidden in this build. Avatars everywhere else are
  letters in the department's colors. `departmentOf` falls back to the
  character when the role says nothing, so changing it can move someone to
  another department.
- `accent` is passed to the person panel's tabs, which ignore it; the office,
  the pods and Who talks to whom use department colors. Two old avatar tints
  in Michael's panel are the only things that draw it. The hire wizard has no
  color picker; it assigns one (`teamAccent`).

Michael edits through the same dialog.

## Decisions

- **D1, Character (owner, 2026-10-02): removed from Edit agent.** The character
  is chosen once, in the hire wizard. No cast grid, no renaming by picking a
  face, no way to make a second Michael. The saved `character` is kept as is.
- **D2, Color (owner, 2026-10-02): removed.** Department colors, set by the
  job, are the one color system for people. The saved `accent` stays as data
  (new hires keep getting one automatically) so the old tints in Michael's
  panel still draw; nothing on Edit agent sets it.
- **D3, Layout (owner, 2026-10-02): one column.** Top to bottom: Name, Role,
  What X handles, Work style, Provider, Model, then the existing note that a
  new engine takes effect at the next start. No section headers or hints
  ("Identity", "Briefing", "Engine"); field labels only, explanations behind
  the existing info icons. The dialog narrows to a single column width so the
  Work style box gets the whole width.

- **D4, room for the job (owner, 2026-10-02, after the build).** Provider and
  Model fold into one "Engine" line, closed by default, that names what the
  agent runs on. The dialog is 640 wide and takes the window's full height
  (`Dialog` `fill`), laid exactly over the person's panel it edits (`over`, the panel
  card's box and radius), else on the right edge (`align="end"`, left in RTL); What X handles starts at five rows and the Work style box
  fills the height that is left (at least 320).

Kept as is: Name stays editable (a rename, with its existing error line); the
Work style required check for team members; the plain words rewrite on save;
Save changes and Cancel.

## Layout

```
+------------------------------------------+
| Edit agent                            x  |
+------------------------------------------+
| Name                                     |
| [Pam                                   ] |
| Role                                     |
| [Executive Admin                       ] |
| What Pam handles  (i)                    |
| [ ...                                  ] |
| Work style  (i)                          |
| [                                      ] |
| [   full width, grows                  ] |
| Putting the job into plain words...      |
| Provider                                 |
| [Claude Code                         v ] |
| Model                                    |
| [Opus 5.5 · 1M                       v ] |
| A new engine or model takes effect ...   |
+------------------------------------------+
| Cancel                     Save changes  |
+------------------------------------------+
```

## NOT in scope

- The hire wizard's character and job choice: unchanged, it is where they belong.
- Removing the `character` and `accent` fields from the data model: kept, other
  views and `departmentOf` read them.
- Michael's own panel portrait and tints.

## Implementation Tasks

- [x] **T1 (P1, human: ~2h / CC: ~15min)** Edit agent: drop the Character and
  Color rows and their state; save no longer writes `character` or `accent`.
  - Surfaced by: D1, D2
  - Files: `src/renderer/src/components/EditAgentModal.tsx`
  - Verify: a test that the modal source has no cast grid or swatches and the
    save patch has no `character` or `accent`; manual check that Pam stays Pam
- [x] **T2 (P1, human: ~1h / CC: ~10min)** One column in the order above, no
  section headers or hints, single column dialog width.
  - Surfaced by: D3
  - Files: `src/renderer/src/components/EditAgentModal.tsx`
  - Verify: manual run, light and dark, at 1280 x 800
- [x] **T3 (P2, human: ~30min / CC: ~5min)** DESIGN.md: describe Edit agent as
  Name, job, work style and engine only; colors come from the department.
  - Surfaced by: design system pass
  - Files: `branding/DESIGN.md`
  - Verify: the Settings and hire wizard section (7.26) matches

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | |
| Outside Review | none | Independent 2nd opinion | 0 | skipped (three decision change) | |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | not run | |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 3/10 → 8/10, 3 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | |

Passes: Information architecture 3 → 8, States 6 → 8, Journey 4 → 8, AI slop
7 → 8, Design system 5 → 8, Responsive and a11y 7 → 8. Mockups: none (the
design generator's key is rejected).

- **OUTSIDE COVERAGE:** none; outside voices skipped for a three decision change.
- **VERDICT:** DESIGN CLEARED. Small enough to build without an eng review; run
  one if you want the usual gate.

NO UNRESOLVED DECISIONS
