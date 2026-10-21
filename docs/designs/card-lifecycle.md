# Michael owns every card until it ends

Status: built (2026-10-02).

## Problem

Owner, 2026-10-02: six cards sat in Blocked on the Tasks view while the pill said
"Nothing needs you". Every one had its newest question answered by the owner,
between 29 Sep and 2 Oct, and none moved. The owner's direction:

> As a system architecture, Michael is the orchestrator and his job is to keep
> things alive and tracked until they are moved to done by either actually done
> or with owner consent to not do them. Fix it architecturally rather than a
> patch or brute force.

And, on the first proposal (a history file and a duties engine):

> Cards are ideally tasks given to an agent that if can't be done is delegated
> to Michael who either redelegates or pushes it to the owner for assistance. As
> soon as that is acted on the task becomes active again for Michael to
> redelegate either to the same agent or someone else based on the response from
> the owner. So why can't the existing infrastructure of task management between
> orchestrator and worker agent support this?

## Root cause

The loop the owner describes exists. Work moves as messages: Michael sends a
`request` to a worker; a `request` carries `requires_reply` and stays open until
answered (`in_reply_to`, `awaitingReplies` at `src/main/hive.ts:2319-2331`); a
worker that cannot finish comes back to Michael, who redelegates or raises an Ask
me card.

The owner's answer leaves that loop at one hand-off. It is sent to Michael as an
`inform` from "human" (`src/renderer/src/components/AskMeTab.tsx:154`,
`src/shared/askMeRouting.ts:60-66`): in this protocol an `inform` is a note that
needs no reply, while a `request` is work that stays open. Michael read six notes,
his inbox emptied, and nothing held the cards open. The raiser was also told "It
has been added to your memory notes. Carry on with the work." (`askMeRouting.ts:56`),
so the worker could act on the answer without Michael routing it, the opposite of
"Michael redelegates".

Two smaller gaps sit next to it:

- A request is nudged into Michael's terminal once (`useHive.ts:800-838`); one he
  sets aside is never raised again.
- The only ending is Done, and the owner's dismiss deletes the card and its
  history (`TasksKanban.tsx:52-61`, `hive.ts:2219`).

## The fix

Michael stays the orchestrator; the app is the interface. It moves no card. It
sends the owner's answer into the work loop as work, and keeps Michael's open
work in front of him until he closes it.

### 1. The owner's answer is a request to Michael

When the owner answers an Ask me card, Michael receives a `request` with
`requires_reply`, about that card: the question, the answer, who raised it, and
"Route the follow-up: hand it to the same team member or another, or ask the
owner again; then close this with done." The card's ask is answered, so it
leaves Ask me (D3). Each answer is its own request: a card with two answered
questions holds two open requests until Michael closes each one.

An open question (no answer, no `dismissedAt`) never leaves Ask me any other
way (owner, 2026-10-04). Whatever the card's status and however many asks
follow it, it stays until the owner answers it or it is withdrawn with
`dismissedAt`. Michael withdraws with a short `dismissedReason`; a card the
owner closes, a mailbox that works again, and a card finished by voice withdraw
their open questions with `dismissedBy: 'card-closed'`, shown in Task detail in
the owner's language. The renderer can only add an answer: main merges it onto
the card on disk, so a stale Ask me view never undoes a withdrawal, and an
answer that did not land keeps the owner's draft.

The team member who raised the question is told the answer as a note
(`inform`): "Michael will route the follow-up." It no longer says "carry on",
so Michael is the one who puts the card back in motion (owner's model).

### 2. Michael's open requests from the owner stay in front of him

"Open" means: a request to Michael from the owner with no reply from him
(`in_reply_to` that id). It is read from the messages that already exist, the
same way `awaitingReplies` reads them, and cached in main on the fleet tick so a
prompt never scans folders.

- **Each turn:** the hook adds "Open requests from the owner" to Michael's
  context, one line per card with how long it has been open, at session start
  and whenever the list changes, so a compaction never loses it. Empty adds
  nothing.
- **The hourly standup** runs a turn, so the list is in front of him then too,
  without a second reminder system.
- **Closing:** Michael replies `done` with `in_reply_to` the request. The router
  records the closure and does not deliver it back to him ("human" routes to
  Michael, `hive.ts:1924`).

### 3. The Tasks view shows it (D3)

A card with an open owner request shows "With Michael" and how long, like any
team member's work. After 1 working day it reads "Michael hasn't moved this".
Only office work hours from the office pack count, and one working day is the
length of the pack's work day (with no hours known, 24 hours of office days).
Nothing goes to Ask me; the owner owes nothing.

### 4. Done is the only ending (D2)

A card ends as Done with a `result`, or Done by the owner's decision
(`closedBy: 'owner'`, a reason) when the owner agreed to stop unfinished work:
an answered Ask me question, the owner's move to Done in Task detail, or the
owner's dismiss on the Tasks view, which now closes the card instead of deleting
it. It sits in Done marked "Closed by owner". Michael is told when the owner
changes a card (status, Done, dismiss), as a note with what changed. Nothing in
the app deletes a card, by click or by voice. The owner's moves in Task detail
and by voice offer To do, Doing and Done; only Michael sets Blocked and Waiting
(sections 7 and 8).

### 5. Answers that never reached Michael (launch catch-up)

Once each launch, when Michael starts, each answered question (not withdrawn)
on a card that is not Done, with no owner request to Michael sent since that
answer, gets one:
Michael receives the same request as in section 1 (the send failed, or the app
quit first). Only answers the app itself recorded count. When the owner answers
on Ask me the app keeps the card, the answer time and a sha256 digest of the
question and answer, word for word, because agents write tasks.json too and
only the owner's own answer may be relayed as the owner's (security review,
2026-10-03). A card answered before the app kept that record is not relayed;
Michael sees it on his "Blocked cards with nothing asked" list (section 7).
Code, for every install; no data is edited by hand.

The catch-up runs again a minute after the owner's last answer, so a request
the app failed to send reaches Michael in the same launch; one that went is in
his inbox by then and is skipped.

### 6. Michael's standup how

Built with `schedule-focus-areas.md` (F6): Michael's default Work style, and
the standup's focus area: close your open requests from the owner, then check
the floor.

### 7. Blocked means waiting on the owner (2026-10-03)

The launch catch-up worked: Michael got all six requests and closed each with
"done", saying it was routed earlier. All six cards stayed Blocked with no
question on Ask me, while their notes named questions for the owner nobody had
asked and replies from outside the office. Closing the request was not enough;
nothing made Blocked mean anything.

- A card is Blocked only while its question for the owner is open on Ask me. A
  card waiting on someone outside the office, or on a team member, is Waiting
  (since 2026-10-04), with who it waits on in waitingOn. Michael's instructions say so, and that a
  closed owner request leaves its card in one of these states.
- "Blocked cards with nothing asked" (Blocked, no open ask, no open owner
  request) is computed from tasks.json on the fleet tick and shown in
  Michael's context every turn while any exist, once when the list empties.
- The standup focus works the list after the open requests. Offices still on
  the earlier built-in focus get the new one at launch.
- The Tasks view marks those cards "Nothing asked".

- A hire's first task (`first-task-card.md`) arrives the same way: the app
  adds the card and sends Michael an owner request about it, which he closes
  with done once he has handed it out. The card is his like any other until
  Done.

### 8. Waiting has its own column (2026-10-03)

Doing showed Kelly and Oscar as busy while neither was working: Kelly waited on
a customer's answer, and Oscar's card waited on a question parked on another
card. Section 7 had put "waiting on someone outside the office or a team
member" in Doing, so Doing could not tell work in progress from work on hold.

- A card waiting on someone outside the office, or on a team member, is
  `"waiting"`, with `waitingOn` naming who in a few words ("customer Gopi",
  "Nick"). It goes back to Doing when they answer. Doing means someone is
  working on it now. Michael's instructions and the nothing asked list say so.
- The Tasks view has a Waiting column between Doing and Blocked (yellow, `amber`), and
  each card shows "Waiting on {who}".
- Michael sets Waiting, as he does Blocked: the owner's status menu, the move
  IPC and voice do not offer it, because it needs who the card waits on.
- A Waiting card is nobody's work right now: it is not counted as Doing on
  Michael's board on the floor, nor as busy on the team roster.
- The hourly standup's focus moves each Doing card held on someone to Waiting,
  and a Waiting card back to Doing once they answer; until then Michael chases
  them. Until 2026-10-09 the built-in focus still said such a card goes to
  Doing, so no card ever reached Waiting. An office still on that focus, word
  for word, gets the current one at launch; a focus the owner wrote stays as it
  is.
- **A Waiting card comes back (owner, 2026-10-17; eng review D4 E, D5 B;
  research "Waiting task follow up ownership").** Until then nothing brought a
  Waiting card back: the standup said "else chase them" with no date. Now the
  job is split. The team member whose work waits tells Michael when to check
  back: a date the other side named ("next week" becomes the first working
  morning after it), else their own judgement. Michael keeps it on the card as
  `nextAt`. The app keeps the clock (`waitingChecks` in shared/cardGuards.ts,
  saved with the board guard, so a restart neither forgets nor repeats): a
  missing, unreadable, past or more than 30 days out time becomes three
  business days after the app first saw the card Waiting. When the time comes,
  Michael gets one "Follow up due" note (never the person directly) and the card
  sits on his WAITING CARDS GONE QUIET list every turn while overdue. Any
  change to the check back time after one came, a cleared one included, counts
  as a follow up (the same time written another way does not; owner,
  2026-10-18 ship review); after two with no
  reply, the note tells him to ask the owner on Ask me whether to keep waiting
  or close it. A card that leaves Waiting loses its clock, so one that comes
  back starts afresh. The standup's focus works the list; an office on the old
  "else chase them" text gets the new one at launch.

### 9. Questions held the wrong way (2026-10-04)

Since an open question stays until answered or withdrawn, Michael's context
lists each turn, beside "Blocked cards with nothing asked", the cards holding
questions the wrong way (`asksToTidy`, `ownerRequests.ts`): a card out of
Blocked with a question still open, and a card with more than one open
question. He moves a card he took out of Blocked back, folds several questions
into one, or withdraws what no longer matters. He never moves a card the owner
moved. Offices with questions left over from the old rule (a newer ask hid the
older one) are tidied this way too; there is no migration (owner, 2026-10-05).

### 10. A card is one activity's needs; the doer files it, Michael triages (2026-10-11)

Owner decisions, 2026-10-11, after cards turned into long umbrellas carrying up
to nine past questions and ten one question "held" cards appeared (the old
one question rule made Michael park the rest):

- **What a card is.** While a team member does an activity (an email check, a
  CRM review), what it needs from others becomes a card: one or more questions,
  related or not, with the context. Similar ones are merged. One activity's
  questions for the owner are one ask holding them as a numbered list,
  answered together on Ask me. Questions from a different activity get their
  own card; nothing is parked.
- **Split by who answers.** When one activity needs answers from the owner and
  from someone outside (a customer), it is two cards: the owner's in Blocked
  (Ask me), the outside party's in Waiting, naming them.
- **The doer files once, Michael triages and alone writes the board (ship
  review D8, 2026-10-12).** A team member never writes `tasks.json`. It files
  what its work needs as one new file in `triage/` in the hive, named by the
  time and its id, written once: a title, the context in "description",
  "filedBy", "filedAt", and either an "ask" for the owner (a numbered list) or
  "waitingOn" for an outside party. The owner never sees the folder. Michael
  sees the waiting filings each turn, oldest first by when each file was
  written (the app only lets a team member create a new file under its own
  id, never overwrite one, so a typed "filedAt" cannot jump the queue), and works
  them in that order against the board as it stands: answers it from memory
  or the board when he can, folds it into an existing card (rewriting it or
  its open ask), routes a question a teammate can answer, drops a duplicate,
  or makes a card (Blocked with the ask in Ask me shape, or Waiting), keeping
  the split by who answers; then moves the file to `triage/.done/`. When a
  team member's work moves (finished, waiting on someone, due again at a set
  time) it tells Michael, who moves the card: Michael is the only agent that
  writes the board, so no filing is lost and no stale copy overwrites a newer
  one. A card with status "triage" on the board (from before the folder) is
  handled the same way. Research behind the choice: orchestrator, shared board
  and file then triage patterns (Anthropic, LangGraph, CrewAI, blackboard
  papers, Kanban inbox practice).
- **Partial answers come back.** When the owner's answer leaves any question
  of a bundle unanswered, Michael adds one new ask on the same card holding
  only those questions, keeps the card Blocked, and only then closes the
  owner's request. The request stays in his context every turn until he does.
  When that card is already Done, he asks them on a new card instead.
- **Done is final.** A card ends in Done. Only the owner takes one out, to
  correct a card wrongly marked done: into To do, with a short reason. When an
  agent reopens a Done card, the app puts it back as it was when Done, keeping
  only a question asked on it meanwhile, which is not withdrawn, and tells Michael to move
  that question to a new card (D3). A Done card that vanishes from the board
  is put back as the app last saw it (D5). The app keeps its Done list in its
  private folder, so this holds across restarts, and a new office starts clean.
- **Triage is only a way in (D4).** A card already on the board that is moved
  back to "triage" returns to its last status, with who it waits on and its
  next time, and Michael is told.
- **A parked step wakes on time (D7).** A To do card with "nextAt" is a
  durable reminder, the pattern of Dapr and Orleans reminders, Temporal timers
  and Letta's wake tool: at that time the app sends the card's person one
  "Next step due" message threaded to the card (Michael when nobody has it),
  also after a restart when the time passed while the app was closed. If the
  card is still in To do four hours later, Michael gets one backstop note. No
  agent watches the clock and Michael never polls.
- **Routines need no card (D6).** A routine that repeats on a schedule lives
  in Schedules; what a run produces for the owner still goes on Ask me as a
  report card.

## What is not built

The first proposal's history file, duties engine and thresholds (gone quiet,
check back dates, unowned cards) are not built: the request loop covers the
failure we saw. They wait for a real case.

## Decisions (owner, 2026-10-02)

- **D1:** Michael is the orchestrator; the app is only the interface and never
  moves a card.
- **D2:** Closing unfinished work with the owner's yes is Done, like any other
  Done, marked as the owner's decision.
- **D3:** Michael's open work shows on the Tasks view like any agent's; anything
  the owner must respond to is always on Ask me.
- **D4:** Thresholds as recommended; with the re-scope only "overdue after 1
  working day" remains.
- **D5:** Superseded by `schedule-focus-areas.md`.
- **Eng D4:** Re-scope: fix the hand-off inside the existing request loop
  instead of adding a history file and a duties engine.

## Eng review (2026-10-02)

Target: docs/designs/card-lifecycle.md (this file), reviewed with `/plan-eng-review`.

### Scope record

feature answers: eng D1, the automatic recurring-job coverage check, cut and
replaced by `schedule-focus-areas.md`; eng D4, re-scope to the request loop
(the history file, duties engine and thresholds cut); structure: A, owner's
"do as you recommend" (eng D2); accepted scope: sections 1 to 6 above;
pending remedies: none. Scope Challenge result: scope reduced per
recommendation.

## Decision ledger

### R1: where the app records card history
State: superseded
Actual answer: owner asked why new tracking was needed at all (eng D3, 2026-10-02); the question was withdrawn in favour of eng D4.
Accepted scope: none (no history file).
History: asked as eng D3 with options A, a history file only main writes, and B, stamps in tasks.json.

### R2: re-scope to the existing request loop
Finding: root cause, P1, confidence 9/10, `src/shared/askMeRouting.ts:60-66` sends the owner's answer to Michael as `act: 'inform'`; reviewer: Claude (eng review), raised by the owner's question
State: approved
Actual answer: A, fix the loop (owner answer to eng D4, 2026-10-02)
Accepted scope: sections 1 to 5 above.
History: none

Approval readiness: PASS. R2 (eng D4: A), eng D1 (coverage check cut),
eng D2 (structure A); D1 to D4 from the owner's answers.

## Eng review findings

### 1. Architecture
- [P1] (confidence: 9/10) `askMeRouting.ts:60-66`: the answer reaches Michael
  as `inform`, outside the request loop. Accepted (eng D4).
- [P1] (confidence: 9/10) `askMeRouting.ts:56`: the raiser is told to "Carry on
  with the work", so a worker can act without Michael routing it. Follows from
  eng D4 and the owner's model: the raiser is told "Michael will route the
  follow-up".
- [P2] (confidence: 9/10) `hive.ts:1924`: "human" routes to Michael, so his
  `done` to the owner would come back to him. Mechanism of the approved
  behavior: the router records a `done` that answers an owner request and does
  not deliver it.

```
owner answers on Ask me
  -> card humanQA answered (leaves Ask me)
  -> request to Michael (requires_reply, card id)      -> open
  -> raiser's memory notes (no message: the owner only talks to Michael, 2026-10-04)
Michael: redelegate (request to a worker) or ask again
  -> done, in_reply_to the owner request               -> closed (filed, not delivered)
open > 1 working day -> Tasks view: "Michael hasn't moved this"
```

### 2. Code quality
- Reuse: "open" is read like `awaitingReplies` (`hive.ts:2319`); the context
  line rides the hook's existing additionalContext (`hooks.ts:525-640`); the
  cache rides the fleet tick (`index.ts:6302`). No new module beyond a small
  pure `openOwnerRequests(messages)` in `src/shared/`.
- The `raisedBy` loss in `parseTasks` (found in this research) is already
  fixed, with a test.

### 3. Tests

```
CODE PATHS                                       USER FLOWS
[+] answerMessages (askMeRouting.ts)             [+] Owner answers an ask
  |-- [** TESTED] raiser and Michael messages      |-- [GAP] Michael gets a request, card leaves Ask me
  |     (ask-me-routing.test.cjs, as inform)       |-- [GAP] raiser told Michael will route it
  |-- [GAP] Michael's message is a request        [+] Michael closes it
[+] openOwnerRequests (new, pure)                  |-- [GAP] done in_reply_to closes, not delivered
  |-- [GAP] open, replied, other senders          [+] Left open
[+] router: done to the owner                      |-- [GAP] his context lists it each turn
  |-- [GAP] filed, not delivered                   |-- [GAP] Tasks view: With Michael, then overdue
[+] launch catch-up (answered, no request)       [+] Owner closes unfinished work
  |-- [GAP] one request each, once                 |-- [GAP] dismiss closes as Done by owner
[+] Done by owner (closedBy)                       |-- [GAP] Michael told what changed
  |-- [GAP] dismiss and Done select
```

Regression: `test/ask-me-routing.test.cjs` pins the answer messages as
`inform`; it is updated to the request contract (Michael: request with
requires_reply; raiser: inform, "Michael will route the follow-up").

### 4. Performance
Reading Michael's inbox, `.done` and `.sent` on every prompt would scan
hundreds of files; the open list is computed on the 8 s fleet tick and cached,
and the hook reads the cache. No other new work.

### Failure modes
| Path | Failure | Covered by | Owner sees |
|---|---|---|---|
| Answer request | send fails | the answer is still on the card; the catch-up re-sends a minute after the owner's last answer, and at launch | card shows With Michael once sent |
| Closure | Michael replies without in_reply_to | stays open; listed each turn | With Michael, then overdue |
| Catch-up | runs twice | once per launch; a request sent since the answer skips the card | one request per answer |
| Catch-up | an agent wrote an answer into the card | not in the app's record (card, answer time, sha256 of question and answer), so never relayed | the card on Michael's Blocked with nothing asked list |

Critical gaps: none.

### Outside voice
Skipped: the owner's rule keeps Codex to the adversarial pass.

## Implementation Tasks

- [x] **T1 (P1)** `answerMessages`: Michael gets `act: 'request'`,
  `requires_reply`, the card id and "route the follow-up, then close with done";
  the raiser gets an `inform`, "Michael will route the follow-up". (2026-10-04:
  the raiser's inform is gone; the owner only talks to Michael, and the floor
  flew a second envelope straight to the raiser.)
  Files: `src/shared/askMeRouting.ts`, `src/renderer/src/components/AskMeTab.tsx`,
  `test/ask-me-routing.test.cjs`.
- [x] **T2 (P1)** `openOwnerRequests` (pure) and its cache on the fleet tick;
  the router files Michael's `done` to an owner request without delivering it.
  Files: `src/shared/ownerRequests.ts`, `src/main/hive.ts`, `src/main/index.ts`, tests.
- [x] **T3 (P1)** Michael's context: "Open requests from the owner" through the
  hook, at session start and on change. Files: `src/main/hooks.ts`, tests.
- [x] **T4 (P1)** Launch catch-up for answered cards with no open request.
  Files: `src/main/index.ts`, tests.
- [x] **T5 (P2)** Tasks view: "With Michael" and "Michael hasn't moved this"
  after 1 working day. Files: `src/renderer/src/components/TasksKanban.tsx`,
  preload, locales.
- [x] **T6 (P2)** Done by the owner's decision: dismiss closes instead of
  deleting; `closedBy`/reason; "Closed by owner"; Michael told of owner changes.
  Files: `TasksKanban.tsx`, `TaskDetailOverlay.tsx`, `src/main/hive.ts`,
  `src/main/index.ts`, locales, tests.
- [x] **T7 (P2)** Michael's instructions: on an owner request, route the
  follow-up and close it with done (replaces "unblock the card").
  Files: `src/main/hive.ts`, `test/business-prompts.test.cjs`.
- [x] Michael's standup focus area: `schedule-focus-areas.md` F6.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | |
| Outside Review | Codex plan review | Independent 2nd opinion | 1 | skipped (owner rule) | |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (all mapped to tasks) | 3 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | not run | |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | |

- **OUTSIDE COVERAGE:** plan-review phase, Codex skipped by the owner's rule; no
  external coverage.
- **VERDICT:** Eng review complete; re-scoped to the existing request loop, all
  findings mapped to T1 to T7. Ready to implement.

NO UNRESOLVED DECISIONS
