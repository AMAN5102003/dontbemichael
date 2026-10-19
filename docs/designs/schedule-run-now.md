# Run a scheduled job now

Status: built (RN1 to RN6). Builds on `per-agent-schedules.md` and
`schedule-focus-areas.md`.

## Problem

An owner who sets up a job on a clock cannot see it work until the clock comes
round. "Check the support inbox" every hour means waiting up to an hour for the
first run; "Send the weekly money summary" on Mondays at 9 means waiting up to a
week. If the job's name or focus area needs a change, the owner edits it and
waits again. The only way to try a job today is to retime it to a minute from
now and set it back afterwards, which also moves its real slots.

## What the owner sees

A **Run now** button in the open schedule row, beside Close and Save:

```
┌ Check the support inbox ─────────────────── next in 45 min ┐
│ every 1h                                                    │
│ fired 15 min ago                                            │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Do what?   [Check the support inbox              ]      │ │
│ │ When       [every 1h ...]                               │ │
│ │ Focus area [refund emails first                  ]      │ │
│ │                                                         │ │
│ │ Sent to Kelly.                                          │ │
│ │ [Delete]                    [Run now] [Close] [Save]    │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

| State | Button | Line above the buttons |
|---|---|---|
| Ready | Run now | (none) |
| Unsaved edits in the row | Run now, disabled | Save your changes to run them. |
| Waiting for main | Sending..., disabled | (none) |
| Sent | Run now | Sent to {{name}}. (for 4 seconds) |
| Ran less than a minute ago | Run now | It ran less than a minute ago. Try again in a minute. (for 4 seconds) |
| Anything else failed | Run now | ! Didn't run. Try again. (coral, as an alert) |

An unsaved edit outranks an earlier run's answer: the line says why Run now is
off, never a "less than a minute ago" left over from a click before the edit.

The row's own "fired" line updates to the new run through `missions:updated`,
so the record of the run stays after the confirmation goes.

## Decisions

### RN1. A run now is a real run, sent exactly as the clock sends it

Main runs the job through `sendMission()`, the function the scheduler's own
timer calls. The agent gets the same message (`firePayload`: the job, its focus
area and any older instructions), from the same sender (`scheduler`), and
`lastFiredAt` is stamped the same way. A run now is therefore a faithful test:
what the owner sees is what the clock will do. It also counts as the job's last
run everywhere a last run matters (the row, catch up, the interval).

### RN2. Jobs only

Only a dispatch schedule (a job) offers Run now. The heartbeat is the office's
own pulse with an adaptive timer of its own (`armHeartbeat`), and a compact row
sends nothing. `runNowCheck` refuses both as `not a job`, and the row does not
show the button on them. The read only office schedule shows no buttons at all,
as before.

### RN3. A paused job can be run

The owner can try a job before turning it on. Running a paused job does not
turn it on, and it arms no timer: `syncMissions` skips paused rows.

### RN4. Never sent twice

A double click, or a click just after the clock fired, would send the job
twice. Main refuses a run now within `RUN_NOW_GAP_MS` (one minute) of the job's
last run, answering `just ran`, and the row says so. The check is in main, not
only in the button, so no other caller can skip it. A last run in the future (a
clock set back) never blocks the job.

### RN5. The row and the timer agree afterwards

An interval job counts from its last run: `nextRunAt` shows `lastFiredAt +
interval`, and `armPlan` waits `interval - (now - lastFiredAt)`. Stamping a run
now without re-arming would leave the old timer in place, so the row would say
11:30 while the job fires at 11:00. Main calls `syncMissions()` after the send,
as every other schedule change does, so both say 11:30.

A job on the clock (weekly or several "when" lines) keeps its slots: a run now
at Monday 09:30 does not move next Monday 09:00. Because the run is stamped, a
slot it already covered (09:00 missed while the app was closed) is not caught up
again.

| Job | Before run now | Run now at 10:30 | Next run |
|---|---|---|---|
| every 1h, last ran 10:00 | next 11:00 | sent, stamped 10:30, re-armed | 11:30 |
| Mondays 09:00, missed today | would catch up now | sent, stamped | next Monday 09:00 |
| weekdays 14:00 | next 14:00 | sent, stamped | 14:00 (unchanged) |

### RN6. Only what is saved runs

Main reads the job from the config at the moment of the click, never from the
screen, so a view opened earlier cannot send an old version (the same rule as
eng review R2 for edits). While the row holds unsaved edits, Run now is disabled
and says "Save your changes to run them", so the owner never tests text that is
not the job's yet.

## How it works

```
ScheduleRow (renderer)             preload                  main
  Run now ───────────────▶ runMissionNow(id) ───▶ ipcMain 'missions:runNow'
                                                    1. id is a string
                                                    2. hive.enabled()       else 'office not open'
                                                    3. runNowCheck(config)  else 'not found' / 'not a job' / 'just ran'
                                                    4. sendMission(job)     hive.send + stamp + missions:updated
                                                    5. syncMissions()       re-arm every timer
  runNowOutcome(result) ◀──────────────────────── { ok } or { ok: false, error }
  'sent' / 'justRan' / 'failed'
```

| Piece | Where |
|---|---|
| Rules: who may run, the gap, what the row says | `src/shared/missions.ts`: `runNowCheck`, `RUN_NOW_GAP_MS`, `runNowOutcome` |
| IPC handler | `src/main/index.ts`: `missions:runNow`, beside the other schedule operations |
| Bridge | `src/preload/index.ts`: `window.cth.runMissionNow(id)` |
| Button and states | `src/renderer/src/components/triggers/ScheduleList.tsx`: `ScheduleRow` |
| Words | `schedulesSection.runNow*` in `en.json`, `ar.json`, `zh-CN.json` |
| Tests | `test/schedule-run-now.test.cjs` |

The handler returns the same `MissionOpResult` shape as the other schedule
operations. Its errors: `invalid id`, `office not open`, `not found`,
`not a job`, `just ran`, or the message of an exception from the send. A send
that went out is never reported as a failure: a failed re-arm afterwards is
logged, the same rule `applyMissions` follows for a save.

Without an office folder (`hive.enabled()` false) `sendMission` would drop the
message but still stamp the run, so main refuses first and nothing is stamped.

During an office break the job is sent as the clock would send it: it lands in
the agent's inbox and the break only holds the nudge that delivers it (the rule
the scheduler already follows).

## Tests

`test/schedule-run-now.test.cjs`, 16 tests:

- Who can run: a job, a paused job and a former everyone job run; an unknown
  id, the heartbeat and a compact row are refused; the stored row is the one
  sent.
- The gap: refused at 0, 30 and 59.999 seconds after the last run, allowed at
  60 seconds, never blocked by a last run in the future.
- Same run as the clock: the payload is `scheduledRunBody` or `relayRunBody`,
  and main sends through `sendMission`.
- Afterwards: an interval job's row and re-armed timer both wait a full
  interval; a weekly job keeps its next slot and does not catch up the slot the
  run covered.
- What the row says for each answer, and the wiring: the office check comes
  before the send, the re-arm after it, the bridge channel, the jobs only and
  saved only guards in the row, and every string in every language without
  dashes.

Each guard was checked by breaking it: dropping the re-arm, the office check,
the gap, the jobs only check, or the unsaved edits guard makes a test fail.

### In the app (macOS, `npm run dev`)

On Pam's "Tomorrow's jobs" (Mon to Sat at 18:00), with the office stopped for a
Claude sign in:

1. The open row shows Run now beside Close and Save.
2. Run now: "Sent to Pam.", the row went from "not yet fired" to "fired now",
   and "next in 5 hr." did not move (RN5).
3. Pam's inbox held exactly one message from `scheduler`, subject "Tomorrow's
   jobs", with the job's focus area: the clock's own run message (RN1). It
   waits there while the office is stopped.
4. Run now again within the minute: "It ran less than a minute ago. Try again
   in a minute.", and no second message (RN4).
5. An edit to the job's name: Run now disabled, "Save your changes to run
   them." (RN6). This step found the line still showing the earlier "less than
   a minute ago"; the unsaved edit now outranks it and that answer clears
   after 4 seconds, pinned by its own test.

## Not in scope

- A Run now on the collapsed row. The row reads as three quiet lines (owner,
  2026-10-01); running is a deliberate action on one job, next to its other
  actions.
- Running a job with a one time focus area. The run is the job as saved (RN6).
- Run now from Michael's Office schedule. That list is read only; each job is
  run from its own agent's Access tab.
- Agents asking for a run now. They ask Michael for work, and schedule changes
  go through schedule requests.
