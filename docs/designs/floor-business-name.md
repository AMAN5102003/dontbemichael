# The business name on the office floor

Status: plan, eng review 2026-10-22.

## The ask

Owner, 2026-10-22, with a screenshot of the empty ground in front of the studio platform's right
face (below and right of its front corner):

> at this area put text "GAACC  AI Labs "

## What exists

- **The studio scene**: `src/renderer/src/scene/studio/StudioStage.tsx` draws one SVG on a fixed
  1060 x 816 stage (`iso.ts:9-12`) scaled by `k` to the window (`StudioStage.tsx:199-203`), with the
  platform first (`<Platform T={T} />`, `:414`). The stage SVG is `aria-hidden` (`:407`).
- **The platform**: `Platform` in `StudioArt.tsx:57-79`, a 10 x 10 cell slab, `A = 5`, 22 px thick.
  Its front corner is `P(5, 5)` = (545, 675), its right corner `P(5, -5)` = (1045, 425); the right
  face runs between them and drops 22 px. The area in the screenshot is the ground below that face,
  about x 600 to 1000, y 560 to 790 on the stage, empty today.
- **Theme**: the scene's colors come from `SceneTokens` (`theme.ts`), with light and dark sets.
- **Compact layout**: a narrow window draws a grid of pods with no platform (`StudioStage.tsx:385`);
  there is no floor there to write on.
- **The business name**: `config.businessName`, "the business's own name ... as the owner typed"
  it, used to personalise the office (title bar, Michael's voice) (`src/main/config.ts:253-257`).
  The owner sets it at setup and changes it in Settings, Company profile
  (`CompanyProfileSettings.tsx:19, 35`). The onboarding studio already shows it above its platform
  (`OnboardingStudio.tsx:50`).
- **Owner rule (MoblizeIT is a reference office)**: fix in code for every install, never
  office specific code or data; neutral examples in UI and tests.

## The plan

```
 StudioStage
   <svg viewBox 0 0 1060 816>   (aria-hidden)
     <Platform />
     <FloorName text={name} T={T} />   new, right after the platform, under pods and people
        text laid on the ground along the right face, parallel to its bottom edge:
          baseline from about (600, 735) toward (1000, 535), 26.57° up (the 2:1 iso slope)
          transform="matrix(1, -0.5, 0, 1, x, y)": letters stand on the ground line
          Sora 600, about 30 px, letter spacing 0.04 em, fill a platform tone at low opacity
          (light and dark from SceneTokens)
        long names: shrink to fit about 380 px of baseline, then cut with an ellipsis
        no name: nothing drawn
   compact layout: nothing (no floor)
```

1. **What it says**: see decision R1 (the text's source).
2. **Where**: on the ground in front of the platform's right face, laid along it like lettering
   painted on the floor, so it reads as part of the room and scales with the stage.
3. **Look**: quiet: a platform tone at low opacity, so it never competes with pods, people or the
   cards; light and dark themes.
4. **Text handling**: right to left names (Arabic) set with `direction="rtl"`; long names shrink to
   a floor size and then cut with an ellipsis; nothing when there is no name.
5. **Access**: inside the stage's `aria-hidden` SVG, like the rest of the scene. The office view shows
   the business name nowhere else today (only notification titles use it, `src/main/index.ts:621`),
   so this is the one place it appears; screen readers keep hearing the view tabs, not the floor.

## NOT in scope (proposed)

- A logo image on the floor.
- The compact layout (it has no floor).
- The onboarding studio, which already shows the name above its platform.

## Tests (proposed)

- `test/floor-view.test.cjs` (extend): the stage draws `FloorName` after `Platform`, with the
  chosen text, in the platform tones; nothing for an empty name; long name shrinks then cuts; RTL.

---

# Eng review (2026-10-22)

Target: this plan, `docs/designs/floor-business-name.md` (drafted in this review from the owner's ask
above; the text above this line is the original plan, with one correction in point 5 made before
review: the title bar does not show the name). Report file: this file.

## Scope Challenge

**What already solves it:** the stage SVG and its scale (`StudioStage.tsx:199-203, 405-414`), the
iso projection `P` (`iso.ts:15-17`), scene tokens for light and dark (`theme.ts`), and
`config.businessName` (`src/main/config.ts:257`). Nothing new to build beyond one SVG group.

**Minimum change:** one `FloorName` group in `StudioArt.tsx`, drawn by `StudioStage.tsx` after the
platform, and its test. Fewer than 8 files and no new class or service: the complexity gate does not
trip.

**Search check:** no new architectural pattern. Skipped.

**TODOS:** nothing related in `TODOS.md`.

Findings:
1. [P1] (confidence: 9/10) owner ask — the exact text "GAACC  AI Labs" written into the scene would
   show on every install, against the owner's rule that office specific text never goes into code
   (MoblizeIT is a reference office). Where the text comes from is R1.
2. [P3] (confidence: 8/10) `StudioStage.tsx:385` — the compact layout has no platform, so no name
   there. Recorded in NOT in scope.

REALITY: premise-table pass 7 premises, unverified=0 src/renderer/src/scene/studio/iso.ts:9
REALITY: already-done pass nothing draws text on the studio floor today src/renderer/src/scene/studio/StudioArt.tsx:57
REALITY: surface-check pass P, pts, SceneTokens, config.businessName exist src/main/config.ts:257
REALITY: binding-decisions pass owner rule: no office specific code (MoblizeIT reference office) docs/designs/floor-business-name.md:20
REALITY: numbers pass platform corners from P(5,5) and P(5,-5) measured src/renderer/src/scene/studio/StudioArt.tsx:58
REALITY: deferred-asks pass no linked issue docs/designs/floor-business-name.md:5
REALITY: pr-count pass one change on the running branch docs/designs/floor-business-name.md:1

Scope Challenge result: scope accepted as-is, with D1 C (the fixed program mark). Finding 2 recorded in NOT in scope.

## 1. Architecture review

```
 src/shared/appName.ts      PROGRAM_MARK = 'GAACC AI Labs'   (beside APP_NAME; the program the app is part of)
 StudioArt.tsx              FloorMark({ T }): one <g>, a <text> on the ground
                              anchor: 34 px below the right face's bottom edge, starting 60 px right of the
                              front corner: about (605, 701) on the stage, rising along the 2:1 slope
                              transform matrix(1, -0.5, 0, 1, x, y): letters stand on the ground line
 StudioStage.tsx:414        <Platform T={T} /> then <FloorMark T={T} />   (under pods, posts, people)
 compact layout             not drawn (no platform)
```

1. [P2] (confidence: 7/10) `StudioStage.tsx:193-203` — the stage leaves room for the floating bottom
   bar (`box.h - 70` for the top offset, `box.h - 40` for the scale), and the label sits in the
   lowest part of the stage. On a short window the bottom bar could cover part of it. The anchor is
   kept close to the face (34 px below its edge, so its lowest point is about y 701 of 816) and the
   dev app check covers 1440 x 900 and a short window. Necessary placement work; no question.
2. Mail posts stand along the front left edge (`layout.ts:142-145`, `POST_GY = 4.4`); the label is in
   front of the right face: no overlap. Decor sits on the platform (`StudioArt.tsx:185-190`).
3. Production failure: none new; a static decorative text in an `aria-hidden` SVG.

Dispositions: 1 accepted as necessary placement; 2 and 3 noted.

## 2. Code quality review

1. [P3] (confidence: 8/10) `src/shared/appName.ts:6` — the program mark is product branding like
   `APP_NAME`; it lives beside it as `PROGRAM_MARK`, not in a locale file, because a proper name is
   not translated. No question.
2. With fixed Latin text, the plan's right to left and long name handling (plan point 4) is not
   needed: dropped from the build. The text is set with `direction="ltr"` so an Arabic window
   (`document.documentElement.dir = 'rtl'`) never reverses it.

Dispositions: 1 accepted; 2 accepted as a simplification of the approved D1 C.

## 3. Test review

```
CODE PATHS                                         USER FLOWS
[+] StudioStage                                    [+] Open the office
  ├── [GAP] FloorMark drawn after Platform            ├── [GAP] the mark shows in front of the platform,
  │         (under pods, posts, people)               │         light and dark (dev app)
  └── [GAP] compact layout draws none                 └── [GAP] an Arabic window keeps it left to right
[+] FloorMark
  ├── [GAP] text is PROGRAM_MARK, ltr, scene tones
  └── [GAP] inside the aria-hidden stage SVG
[+] Regression
  └── [★★ TESTED] floor view tabs and board covering the office, test/floor-view.test.cjs:17-40
COVERAGE: 1/7 paths tested | GAPS: 6
```

Proposed test (extend `test/floor-view.test.cjs`, source pins; the stage needs React and Electron):
- the mark: `PROGRAM_MARK === 'GAACC AI Labs'`; StudioStage draws `<FloorMark` right after
  `<Platform` inside the non compact SVG; FloorMark sets `direction="ltr"` and uses scene tokens.
  Value: protects=the program mark shows on the floor in every office, under the scene, left to right; fails_when=it moves above the people, into the compact grid, or flips in Arabic; why_new=new mark; seam=source pins (React scene); no_claim=its look on a real window (dev app)

Tests made obsolete: none.

## 4. Performance review

No issues found: one static `<text>` in the stage SVG, drawn with the scene; no new state, timer or
observer.

## Decision ledger

### R1: where the floor text comes from
Finding: 1, P1, 9/10, owner ask and the reference office rule, reviewer Claude
Plan baseline: the owner's ask: the text "GAACC  AI Labs"
Runtime evidence: `config.businessName` is the owner's business name from setup, editable in Settings, Company profile (`src/main/config.ts:253-257`, `CompanyProfileSettings.tsx:19, 35`)
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 floor text | none | the business name from setup and Settings, Company profile; set it to "GAACC AI Labs" there | a new "Name on the floor" field in Settings, Company profile, empty means the business name | the fixed text "GAACC  AI Labs" in the code |
Question D1:
D1 — Where should the name on the office floor come from?
Project/branch/task: eng review of the floor name plan on mit/dock-scroll-follow (running branch).
ELI10: You want "GAACC AI Labs" written on the floor in front of the office. If those words go into the app's code, every office that installs the app shows "GAACC AI Labs", which breaks your rule that one office's details never go into code. Instead the floor can show each office's own business name, the one typed at setup and changed in Settings. If "GAACC AI Labs" is your business name there, your floor shows exactly that.
Stakes if we pick wrong: with fixed text, every customer's office says GAACC AI Labs; with the business name, your floor shows whatever name is in Settings now.
Recommendation: A because it shows your words on your floor and every other office's own name on theirs, with nothing new to set.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Business name (recommended)
  ✅ Your floor shows the name you set at setup or in Settings, and every office shows its own.
  ✅ Nothing new to fill in; changing the name in Settings changes the floor (human: ~3 hours / CC: ~15 min).
  ❌ If your business name in Settings isn't "GAACC AI Labs", you change it there, which also changes how Michael names the business.
B) Its own floor field
  ✅ The floor can show a brand, like GAACC AI Labs, apart from the business name Michael and the documents use.
  ✅ Empty means the business name, so offices that never touch it still get their name.
  ❌ One more field in Settings to explain and keep in step (human: ~1 day / CC: ~30 min).
C) Fixed text in the code
  ✅ Exactly the words you asked for, with no setting to touch.
  ✅ The smallest change of the three.
  ❌ Every office that installs the app shows GAACC AI Labs, against your reference office rule.
Net: each office's own name, a separate floor brand, or your words on everyone's floor. <gstack-qid:plan-eng-review-floor-name-source>
Header: Floor text
Options:
A) Business name (recommended)
The floor shows config.businessName from setup and Settings, Company profile; set it to GAACC AI Labs there.
B) Its own floor field
A new Name on the floor field in Settings, Company profile; empty means the business name.
C) Fixed text in the code
The floor always shows GAACC  AI Labs, in every office.

State: approved
Actual answer: C (owner answer to D1, 2026-10-22): "C as it is actually the open source ai lab program by greater austin asian chamber of commerce initiative."
Accepted scope: the floor shows the fixed text "GAACC AI Labs" in every install: the program the app is part of (Greater Austin Asian Chamber of Commerce, open source AI Lab), product branding like the app's name, so the reference office rule does not apply. One constant, a proper name not translated; the owner's "GAACC  AI Labs " is normalized to single spaces and no trailing space.
History: finding 1 assumed the text was one office's data; the owner's answer shows it is the program's mark

### R2: outside voice on this plan
Finding: the review's default second opinion; the owner's rule keeps Codex to the ship adversarial pass and asks before any other use
Plan baseline: none
Runtime evidence: `codex_reviews` enabled; Codex installed
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 floor text | approved D1 C | unchanged | unchanged |
| R2 outside voice | not run | skipped; Codex reviews the built code at ship | Codex gpt-5.4 read only reads the plan once |
Question D2:
D2 — Run Codex as an outside voice on this small floor label plan?
Project/branch/task: eng review of the floor name plan on mit/dock-scroll-follow (running branch).
ELI10: The review's last step can ask a second AI to look for gaps. This plan is one line of text on the floor, already checked for overlaps and Arabic windows, so there is little for a second reader to find. Your rule keeps Codex to the ship adversarial pass unless you say yes here.
Stakes if we pick wrong: skipping could miss a gap in placement, which the dev app check would show anyway; running costs a few minutes of your Codex plan.
Recommendation: A because the change is one text element and the dev app check shows its placement directly.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Skip it (recommended)
  ✅ Keeps Codex to the ship adversarial pass, as your standing rule sets.
  ✅ The review finishes now; the dev app check shows the label where it lands.
  ❌ No second reader on the plan before it is built.
B) Run Codex once
  ✅ A second model reads the plan for gaps, read only, on gpt-5.4 as your rule requires.
  ✅ Its findings come back here as questions before any code is written (about 5 minutes).
  ❌ Uses Codex outside the ship pass for a one element change.
Net: finish now, or a second look at a very small plan. <gstack-qid:plan-eng-review-floor-name-outside>
Header: Outside voice
Options:
A) Skip it (recommended)
No outside voice on this plan; Codex reviews the built code at ship as usual.
B) Run Codex once
Codex gpt-5.4, read only, reviews this plan once; findings come back here as questions.

State: approved
Actual answer: A, "Skip it" (owner answer to D2, 2026-10-22)
Accepted scope: no outside voice on this plan; Codex reviews the built code at ship.
History: none

Approval readiness: PASS. Checked R1 (D1 C), R2 (D2 A); placement and the constant's home are necessary work of D1 C; no regression contract changes (existing floor view tests stay).

## Approved plan (after review)

```
 src/shared/appName.ts    export const PROGRAM_MARK = 'GAACC AI Labs'
                          (the Greater Austin Asian Chamber of Commerce open source AI Lab program; D1 C)
 StudioArt.tsx            FloorMark({ T }): <g><text direction="ltr" ...>{PROGRAM_MARK}</text></g>
                          on the ground in front of the platform's right face, 34 px below its bottom
                          edge, from about (605, 701) rising along the 2:1 slope,
                          transform matrix(1, -0.5, 0, 1, x, y), Sora 600 about 30 px, letter spacing
                          0.04 em, a platform tone at low opacity from SceneTokens (light and dark)
 StudioStage.tsx          <Platform T={T} /> then <FloorMark T={T} />; not in the compact layout
 test/floor-view.test.cjs the pins in Test review
 dev app                  check at 1440 x 900 and a short window, light and dark, and Arabic
```

## NOT in scope

- Each office's own business name on the floor (D1 chose the program mark).
- The compact layout, which has no floor.
- The onboarding studio, which shows the business name above its platform.
- A logo image.

## What already exists

- The stage SVG, its scale and `aria-hidden` (`StudioStage.tsx:199-203, 405-414`), reused.
- The iso projection `P` and `pts` (`iso.ts:15-17, 25`), reused for the anchor.
- `SceneTokens` light and dark (`theme.ts`), reused for the color.
- `APP_NAME` beside which the mark's constant lives (`src/shared/appName.ts:6`).

## Failure modes

| Path | Realistic failure | Handling | Test | Owner sees |
|---|---|---|---|---|
| placement | a short window lets the bottom bar cover part of the mark | anchored close to the face; dev app check | dev app | part of the mark under the bar |
| Arabic window | text reversed | `direction="ltr"` | source pin | left to right mark |
| compact layout | mark floating with no floor | not drawn | source pin | nothing |

0 critical gaps.

## Worktree parallelization strategy

Sequential implementation, no parallelization opportunity.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [x] **T1 (P1, human: ~2h / CC: ~10min)** — scene — PROGRAM_MARK constant, FloorMark after the platform, scene tones, ltr
  - Surfaced by: R1, D1 C; Architecture 1; Code quality 1 and 2
  - Files: `src/shared/appName.ts`, `src/renderer/src/scene/studio/StudioArt.tsx`, `src/renderer/src/scene/studio/StudioStage.tsx`
  - Verify: dev app at 1440 x 900 and a short window, light and dark, Arabic
- [x] **T2 (P1, human: ~1h / CC: ~5min)** — tests — the pins in Test review
  - Surfaced by: Test review
  - Files: `test/floor-view.test.cjs`
  - Verify: `npm test`
- [x] **T3 (P2, human: ~15min / CC: ~2min)** — docs — CHANGELOG line
  - Surfaced by: owner rules
  - Files: `CHANGELOG.md`
  - Verify: no dash suite

## Unresolved decisions

None in this review.

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 applicable rows emitted, 0 unverified premises
- Architecture Review: 1 issue found
- Code Quality Review: 1 issue found
- Test Review: diagram produced, 6 gaps identified
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: skipped by the owner (D2 A; owner rule keeps Codex to the ship pass)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: N/A (no answer scored for Completeness)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | ISSUES OPEN (other plan, 2026-10-22) | 3 proposals, 1 accepted, 0 deferred |
| Outside Review | Codex via `/plan-eng-review` | Independent 2nd opinion | 12 | skipped (owner D2) | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 12 | ISSUES OPEN | 8 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 8 | — (none for this plan) | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** Codex, plan review phase, skipped by the owner (D2 A); no outside findings.
- **VERDICT:** ENG REVIEW done with both decisions answered; ISSUES OPEN means mapped work (tasks T1 to T3). No design review has looked at the mark's type and color yet.

NO UNRESOLVED DECISIONS

## Change after build (owner, 2026-10-22)

The owner asked for the mark "much smaller and adjusted within the foundation border area": it now
sits on the platform's right side face, not the ground in front of it. Centered on the face at
`P(5, 0, -12)`, 10 px Sora 600, between the face's top edge and the light band 16 px down, along the
same 2:1 slope; white on the light face, a muted violet on the dark one (`markFill`, `markOp`). The
bottom bar overlap risk (Architecture 1) no longer applies: the face is well above the stage bottom.

Then, same day: "bring it towards the left rather middle": it starts 30 px from the front corner (`P(5, 4.4, -12)`, anchored at its start) and runs right along the face.

Then, same day, with a screenshot: "move it more to the left and ensure the text is not cut. it is ok to reduce the size if needed". On the right face the team pod (slot 8, `layout.ts:52`) covered "AI Labs" and the 10 px letters reached past the slab's top edge. The mark moved to the front left face, which no pod reaches over: it ends just before the front corner (`P(4.5, 5, -12)`, anchored at its end), 8 px, low in the band; a violet on the paler left face in light (`#8A82C9`), the same muted violet in dark.

Then, same day: "keep it on the side it was earlier and make it a link to go to https://austinasianchamber.org/". Back on the right side from near the front corner (`P(5, 4.6, -12)`), 8 px, white on the light face. Pods near the right edge (the team, front right and right slots) hang over that side, so no spot there is clear in every office: the mark is now an HTML link laid over the scene SVG (above the pods, under the day's light), skewed to the side's slope, so it is never cut. `target="_blank"` goes through the window open handler (`src/main/index.ts:3658`), which opens http(s) links in the browser; the link is keyboard focusable, underlined on hover and focus, titled with the chamber's full name.

Then, same day: "tops still cut" (6f2e47b2). The mark is SVG text on its own baseline, 7 px
(`MARK_SIZE`), from `P(5, 4.6, -13)`, in its own overlay above the scene and under the day's
light, so nothing cuts it.

Ship review (2026-10-23): the owner chose a readable mark. Its letters are now `#4E4791` on the
light face (`#C6C0E6`, 4.6 to 1) and `#8A83C3` on the dark face (`#1C1A2C`, 5.0 to 1), at full
opacity, so the link text meets DESIGN §12's 4.5 to 1.

