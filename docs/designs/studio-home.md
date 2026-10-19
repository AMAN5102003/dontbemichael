# Studio home: replacing the pixel floor

Status: direction chosen 2026-09-30 (design-shotgun round 2, "Studio"). The design system
that implements it is [`branding/DESIGN.md`](../../branding/DESIGN.md) v2; the approved
screens are copied to [`branding/reference/studio/`](../../branding/reference/studio/). Requirements mapping below;
open questions at the end. Mockups live in
`~/.gstack/projects/agentvivekkumar-dontbemichael/designs/business-first-redesign-20260930/`
(`variant-H` is the chosen direction; `variant-G` "Day Lanes" is the later Today view). The
faithful v2 screens, built after the decisions below: `studio-v2-home` (light), `studio-v2-home-dark`,
`studio-v2-kelly-access` (person panel, Access tab), `studio-v2-kelly-work` (Work tab: terminal,
Talk 1:1). Round 3, approved as is: `studio-v3-michael` (Michael's panel, Office schedule tab),
`studio-v3-tasks` (Tasks view with task detail), `studio-v3-graph` (Who talks to whom) and
`studio-v3-onboarding-team` (onboarding step 4, Your team, from the real Pro Services pack).
Generators: `gen_studio_v2*.py`, `gen_studio_v3_*.py`.

## Why

The main window matched upstream Munder Difflin one to one: pixel office floor in the middle, agent
card strip along the bottom, Command Center on the right. People read the fork as a copy. The Office
theme stays (Michael, the cast, "Michael should have learned to delegate"). The floor, the strip and
that three part layout go.

## The new shell

| Region | What it holds |
|---|---|
| Top bar | Struck M logo, view tabs (Office, Tasks, Who talks to whom), clock pill (office open, closing time), update badges, theme, Settings, coral **Needs you N** (focus mode hidden since 2026-10-01, `SHOW_FOCUS_MODE`) |
| Stage (Office view) | Isometric studio: Michael's glass pod in the center, one pod per team member, mailbox posts on the edge, work tokens moving on paths |
| Right column | Contextual inspector, resizable (keeps SidebarSplitter). Default: the Needs you feed. Pod selected: that person's panel. Michael's pod: Michael's panel |
| Bottom bar | Talk to Michael composer (today's Michael MessageQueueComposer: attach, queue; renamed from Brief Michael 2026-09-30), next scheduled job chip, Hire |

Other views: **Tasks** (kanban, as today) and **Who talks to whom** (today's Graph). Settings stays a
modal. A **Today** timeline (Day Lanes) is a later, separate piece.

## Mapping: every current function to its new home

IDs refer to the three inventories taken 2026-09-30 (floor F/V/S/C, panels A/P/C/M/T/CC/AM/AD/AP,
settings A/B/C/D).

### Office floor

| Today | Studio |
|---|---|
| F1 click avatar selects agent | Click pod or its label card; Tab and arrow keys move between pods (new, a11y) |
| F2 wall calendar opens Office schedule | Clock pill menu and the Next job chip open Office schedule |
| F3 cork boards open Tasks | Task board block on Michael's pod opens Tasks |
| F4 wall clock starts closing time | Clock pill menu: Closing time |
| F5, F6 Ask me board, count, pulse | Needs you button in the top bar (count, pulse) and the right column feed |
| F7 task notes, doing notes on desks | Task board block (To do, Doing, Blocked, Done) plus a sticky count on each pod |
| F8 task moves acted out | Token flies Michael to pod on assign; check token pod to board on done; coral beacon on blocked |
| F9 statuses | Pod state, always with a text pill too: working (screen lit, floor glow), thinking (dots bubble), waiting (screen on, no glow), needs you or blocked (coral beacon), compacting (violet box), looping (orange ring), success (check burst), idle (desaturated) |
| F10 thought cloud, tool icon | Label card caption (action, else last prompt) and a tool chip |
| F11 cheer after 60 s of work | Check burst on the pod |
| F12 envelopes by act, to the door when needs human | Paper tokens on paths, colored by act, max 16 in flight; needs human tokens fly to the right column |
| F13 lit monitors | Lit pod screens |
| F14 ambience (coffee, gossip, errands) | One in-character line at a time over an idle pod, fading out (cafeteriaLines.ts) |
| F15 pause when hidden or in focus mode | Keep: pause CSS and SVG animation the same way |
| F16 WebGL recovery | Not needed: SVG, no Pixi |
| F17 TV show themes (flag off) | Dropped |
| F18 seats, 15 desks, overflow at the door | Department pods, up to 4 people each; compact grid above about 30 |
| F19 multiple floors (New Floor window) | Removed (2026-10-03): one office window; the New Floor item and its setting are gone |
| F20 ghost status (unused) | Dropped |

### Views, strip, chrome

| Today | Studio |
|---|---|
| V1 OFFICE, TASKS, GRAPH toggle | Top bar view tabs: Office, Tasks, Who talks to whom |
| V3, V4 kanban and task detail | Tasks view, same functions; add Esc to close detail |
| V5 memory graph | Who talks to whom view: people drawn as their props, edge thickness by message count over a time range (Last 1 hour to Last 1 month, default Last 1 day), hover an edge for count and last message (others dim), Refresh, drag to pin; clicking a person opens their Memory. Topic nodes and the Topics switch removed (2026-10-03) |
| S1 to S5 card, select, status, typing, info line, context gauge | Pod label card: name, role, status pill, typing dot, caption, small context gauge |
| S6 doing sticky note | Sticky count on the pod; click opens the task |
| S7 private note | Person panel header |
| S8 Michael cost chip | Michael panel |
| S9 drag to reorder | Pods sit by department, then hire order; manual order stays in Michael's Advanced roster |
| S10 add agent | Hire button (bottom bar) |
| S11 restore team | Banner at the top of the right column: restore all, dismiss one |
| C1 to C8 title bar, updates, theme, settings, focus, toasts | Top bar and bottom right toasts, same behavior |
| C9 Michael booting, empty floor | Stage shows empty pods with Michael's pod "clocking in"; empty office shows the platform with a Hire call to action |
| C10 office folder missing, C11 quit and closing time | Office folder missing restyled; quitting now starts closing time at once, shown as a closing bar on the floor (2026-09-30) |
| C12 cleared banner | Person panel |
| C13 keyboard | Same, plus pod navigation; Esc on every overlay |
| C14 menu, notifications (only Michael) | Notifications unchanged. The menu is trimmed (2026-10-03): no File menu on the Mac, and Reload and the developer tools only in development |

### Person panel (was AgentDetailPanel)

Tabs: **Profile**, **Access** (was Capabilities: email, QuickBooks, own folder, token limit,
schedules), **Messages**, **Memory**, **Work** (the live terminal, Talk 1:1, message queue, Message
Michael about this person). Traces, Git, IDE, Open terminal stay behind their flags. Edit opens
EditAgentModal. The one sidebar tab choice stays shared across people, as today.

### Michael's panel (was CommandCenterPanel)

Ask me folds into the Needs you feed (answers, past answers, tasks blocked behind each ask,
schedule requests). Tabs: **Profile**, **Access**, **Work** (terminal plus composer, not locked),
**Office schedule**, **History** (only with a webhook), **Memory** (picker, search), **Advanced**
(monitor, dispatch, model and engine, archived, activity log).

### Settings, onboarding, platform

- Settings keeps every section and its save rules. Nav "Mailboxes" and "Schedules" in the mockup
  deep link to Settings, Connections and to Office schedule; no new top level pages.
- Onboarding keeps every step and check. The Team step lists the pack's people in pack order
  (defaults from `defaultPicks`, Michael always on, needs and optional connection chips, folder
  with change) and shows the studio filling with a pod per pick and a dashed "not picked" pod for
  the rest: the pack setup becomes the visible moment.
- i18n and RTL: the stage is art and does not mirror; the right column and bars flip.
- Dark mode: Studio needs a dark palette (the theme toggle stays).
- Window minimum 1280 x 800: the stage must fit beside a 360 px right column at that size.
- Accessibility: every state has text, not color only; add dialog role, focus trap and Esc to
  Settings and onboarding (missing today).

## What the mockup shows that does not exist yet

| In the mockup | Reality today |
|---|---|
| Approve / Decline on a $240 refund | No structured approval path. `control:approvalRequest` had no listener and was removed (2026-10-10, issue #103); spending rules are prompt text only |
| "Web off" per person | No per person web switch exists |
| "Spending asks you" chip | Prompt only, not enforced |
| Pack tool levels off / ask / auto | In pack data, not shown, not enforced |
| "14 handled today" per mailbox | No per mailbox count is kept |
| 38 delegated, 3 to you, 0 kept | Needs a definition and a counter (hive messages from Michael, human questions, tasks Michael kept) |
| Restore an archived person | Not possible today; only remove |

## Decisions (owner, 2026-09-30)

**This is a UI redesign, not a technical one.** No system behavior changes. The design shows only
what the app does today; anything in the "does not exist yet" table above stays out of the
mockups and the build.

1. **Needs you is the Ask me board, as it works today.** Work reaches a team member from Michael,
   a schedule, or an outside event (mailbox, webhook). Team members own their job and ask each
   other for information. A team member who hits a limit or a conflict goes to Michael. Michael
   re-delegates or unblocks with more context. Only when Michael can't settle it does he raise an
   Ask me card, tagged with the team member it belongs to, explaining what is needed. The owner
   answers in words: a decision, a standing rule for next time (answers go into that team
   member's memory), or "done" when the owner takes it off the office and handles it. Schedule
   requests are the only cards with Approve and Decline. Cards keep: task title (opens detail),
   tagged team member, Michael's question, answer box, reply, earlier
   answers, tasks blocked behind it. A pod shows a coral "1 for you" badge only when an Ask me card
   is tagged to that person; only Michael raises cards.
2. **Access panel shows today's capabilities only:** mailbox and Can send or Draft only,
   QuickBooks and Read only or Can make changes (when QuickBooks is on), own folder, schedules.
   No web switch, no spending chips.
3. **Terminal:** composer first. Talk to Michael from the bottom bar; each person's terminal, Talk
   1:1 and message queue live in their Work tab; focus mode hidden (2026-10-01).
4. **Team size:** department pods, up to 4 people per pod; a compact grid above about 30 people.
   Must fit a 1280 x 800 window.
5. **Idle life:** one occasional in-character quote bubble over an idle pod.
6. **Today timeline:** later, not in this release.

## Updates after the build

- 2026-10-01: an Ask me is cleared only by answering it; the board's dismiss is gone.
- 2026-10-01: focus mode hidden (`SHOW_FOCUS_MODE`); the code stays behind the switch.
- 2026-10-03: the second office window (New Floor) and its setting are removed, and the menus
  are trimmed to what an office owner uses.
- See branding/DESIGN.md §18 for every design change since 2026-09-30.
