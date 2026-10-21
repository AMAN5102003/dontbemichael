# Michael answers the owner where they asked

Status: built (2026-10-06), uncommitted; design and engineering reviews complete.

## Problem (owner, 2026-10-06)

"When the owner talks to Michael, there is no feedback back to the owner." The
original Munder Difflin relied on the user reading the agent terminal. Here the
terminal is the last place an owner should go. Asking "what happened to the
weekly financial summary?" is worse still: Michael's answer lands only in his
terminal (Work tab), and the owner has no clue what he said.

## What happens today (from the code)

| Owner action | Delivery | Where Michael's answer goes |
|---|---|---|
| Bottom bar "Talk to Michael", Michael's Work tab composer, "Message Michael about X" | Text typed into Michael's PTY by the queue drain (`useHive.ts` `submitToPty`). No hive message, no id, no record | His terminal only |
| Ask me answer | Hive `request` from `human`, `conversation: card:<id>`, `requires_reply` | Michael closes it with `done`, `in_reply_to`; the reply is "filed, not delivered" (card-lifecycle.md) |
| Advanced, Dispatch via Michael | Hive `request` from `human` | Terminal |
| Slack (hidden) | PTY text plus an app ack in the thread | The only loop that answers where the owner asked |

- A Michael message `to: "human"` is routed back to Michael, delivered to no inbox, logged
  by subject only, and still flies a `needsHuman` plane that pulses the Needs you pill with
  nothing on the board (a false "needs you").
- Michael's prompt says he "relays results", but the only owner channels it names are Ask me
  (questions only) and `to: "human"` (closing time only).
- Scheduled reports (Oscar's "Weekly money summary") reach Michael's inbox and stop there.
  The owner can find them only on Oscar's Messages tab, in Oscar's folder, or in a terminal.
- Michael's panel has no Messages tab, and no owner and Michael thread exists anywhere.
- Building blocks: the Stop hook keeps each agent's `transcript_path` and
  `lastAssistantText()` reads its last answer; owner requests already stay in Michael's
  context until he closes them (`ownerRequests.ts`).

## What other products do (research, 2026-10-06)

- The reply lands in the thread the request came from; a separate ping only says it
  arrived (Devin, Cursor in Slack, Notion inbox, ChatGPT scheduled tasks).
- Acknowledge within seconds, then stay quiet until there is news (Linear agents: a first
  activity within 10 s). Never a fake "typing" that may not be followed by a reply (Notion).
- A small fixed set of states: working, needs you, done, failed (Devin, Cursor, Manus).
- Answer first, details behind a disclosure (NN/g inverted pyramid; plain language).
- Link the work product, don't paste it (Codex, Cursor, Devin).
- Notify only when done or when input is needed; never re-notify the same item; no "seen"
  receipts (read but no reply raises anxiety). Apple HIG: Active by default, Passive for FYI.
- Handoffs and waits say who, what and when (Intercom Fin); a stale wait shows as stale,
  not silence (Linear: stale after 30 minutes).
- Every badge leads to the item that set it (a Codex Dock badge with nowhere to go).
- Guidelines: Microsoft HAX G1, G3, G9, G11, G12; Google PAIR errors and graceful failure.

## The design in one paragraph

Every message the owner sends Michael becomes a tracked request. Michael answers it in a
conversation dock that grows up out of the "Talk to Michael" composer. Each of the owner's
messages carries one live status line (Sent, Michael has it, Waiting on Oscar, Later than he
said, Waiting for you, Answered, Couldn't finish). Michael's bubbles carry only his words,
answer first, with files as rows. One count on the composer says Michael answered (indigo)
or is waiting for the owner (coral). One desktop notification per final answer or question.
Only the owner's own questions live in the dock; scheduled outcomes and things the office
could not resolve go to Ask me, reports as quiet cards.

## Layout (issue 1)

The "Talk to Michael" composer grows upward into a conversation dock, 400 px wide (the
composer's width), anchored to the bottom bar's left edge (right edge in RTL). The right
column stays for Needs you and people.

```
 office floor (may be covered)                     right column (never covered)
 +--------------------------------------+
 | (M) Michael  2 open (i)           x  |  1. who, how many still open
 |--------------------------------------|
 |               Today                  |
 |        Chase the Northwind invoice   |  your message, right
 |        * Waiting for you   (coral)   |  2. its live status line
 | (M) > Chase the Northwind invoice    |  quote, when not right below
 |     Northwind will pay today if we   |  3. the answer, bold first sentence,
 |     waive the $40 late fee. OK?      |     4 lines then More
 |        What happened to the weekly ..|
 |        * Answered                    |
 | (M) It's ready: revenue $18,240 ...  |
 |     [sheet] Weekly money summary Open|  4. files as rows, never pasted
 +--------------------------------------+
 [+] Talk to Michael...         [Send] (1)    Next: Mon 09:00 ...
```

Read order: who you are talking to, the state of each request, the answer, then
anything to open.

## States

| Request status (on the owner's message) | Set by | Look | Notifies |
|---|---|---|---|
| Sent | app, on queueing | dot `ink-3` | no |
| Sent, Michael is finishing something (N ahead) | app, while his session is busy | `ink-3` | no |
| Michael has it | app, when his session takes it | `blue` | no |
| Waiting on Oscar, 10:05 | Michael's holding reply (`inform` with an expected time) | `ink-3` | no |
| Later than he said, 10:25 · Nudge | app, past his time or 2 h | `amber`, quiet Nudge link | no; Michael is reminded once, Nudge reminds again at most hourly |
| Waiting for you | Michael's question back (`query`) | `coral-text` 600; composer count coral | one desktop notification |
| Answered | Michael's final reply (`done`) | `green` | one desktop notification |
| Couldn't finish · Ask again | Michael's `refuse` with a reason | `ink-2`; Ask again refills the composer | one desktop notification |
| Not sent · Try again | app, delivery failed | `ink-2` | no |

| Dock surface | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Conversation | Opens on the saved history at once; no spinner | Michael's line "Ask me anything about the office. I'll answer here." and two example chips | "Not sent" with Try again on the message | Status line Answered, reply bubble | Holding reply, or "From Michael's notes" muted bubble with the request still open |
| Count on composer | none | hidden | n/a | indigo N new | coral when any question waits on the owner |
| Report card on Ask me | n/a | no card | file row "Not found" | Got it clears it | n/a |

Restart and relaunch: open requests come back with their last status and are given to
Michael again. Closing time: the dock closes with the bottom bar until closing is cancelled
or the next launch.

## Journey: "What happened to the weekly financial summary?"

| Step | Owner does | Owner feels | The design gives |
|---|---|---|---|
| 1 | Types it in the composer, presses Enter | Hopeful, a bit doubtful anyone will answer | The dock opens; the message shows at once with "Sent" |
| 2 | Watches for a second | Reassured it landed | "Michael has it" (or "finishing something, 1 ahead"), from a real event |
| 3 | Reads the holding reply | Informed, not chasing | "Oscar's run stopped on a missing bank export. About 20 minutes." Status: Waiting on Oscar |
| 4 | Goes back to email | Free to leave | Nothing pings for the holding reply |
| 5 | Twenty minutes later | Pleased, no hunting | One notification, "Michael: It's ready, revenue $18,240, up 8%"; click opens the dock at the reply |
| 6 | Opens the summary | Done in one click | The file row's Open |
| alt | The answer is late | Uneasy | Amber "Later than he said" and Nudge; Michael already reminded |
| alt | Michael needs a decision | Clear it's their turn | Coral "Waiting for you", coral count, one notification; answers in the dock |
| alt | Michael only wrote in his terminal | Not left empty handed | "From Michael's notes", muted; still open, Michael reminded |
| next Mon | Oscar's scheduled summary is ready | Informed, not interrupted | A quiet Report card on Ask me, pill reads "1 report", no coral |

5 seconds: the message is visibly in and someone has it. 5 minutes: the owner can leave and
trust they will be told. Long term: the dock is the one place Michael answers, and coral
still only ever means "your turn".

## Design review decisions (2026-10-06)

- **1. Where it lives (1B).** A conversation dock above the composer. The right column is
  unchanged.
- **2. One count (2A).** Messages waiting for Michael show in the dock as the owner's own
  message marked "Sent"; the queue popover goes, and editing or cancelling a queued message
  happens on that bubble. The composer's only number is unread news from Michael: mono
  11 px white on `indigo`, cleared once the reply has been on screen in the open dock
  (nothing is reported back to Michael).
- **3. Header (3A).** 26 px avatar, "Michael" (`t-ui` 600), then "2 open" in `t-meta`
  `ink-3` (hidden at zero), an info icon ("Requests Michael has not answered yet"), and the
  close ✕ at the end. No role line.
- **4. Status on the question (4A).** Each owner message carries one status line under it
  (`t-meta`), updated in place. Michael's bubbles carry only his words. A reply not directly
  under its question opens with a one line quote of it (`ink-3`, clickable, scrolls to the
  question). Replies are matched by request id, never by text.
- **5. State colors (5A).** A 6 px dot plus words on §3.5 meanings, as in the States
  table. No new tokens.
- **6. Late answers (6A).** A holding reply states when Michael expects to answer (a field
  the app reads, not parsed prose). Past that time, or 2 hours after the request when he
  gave none, the line turns `amber` "Later than he said" with a quiet "Nudge". At that
  moment the app reminds Michael once; Nudge reminds again, at most once an hour.
- **7. Continuity (7A).** The app saves the conversation; it survives relaunch. After a
  relaunch or a Michael restart, open requests show with their last status and are given to
  Michael again as open owner requests. A send that never reached Michael shows "Not sent"
  (`ink-2`) with "Try again". At closing time the dock closes with the bottom bar until
  closing is cancelled or the next launch.
- **8. Empty dock (8A).** Michael's avatar, "Ask me anything about the office. I'll answer
  here." (13 px `ink-2`), and two secondary `sm` chips that fill the composer: "What's on
  today?" and "How did last week go?". Generic for every office.
- **9. Terminal only answers (9A, trigger amended by R8).** When Michael's turn ends after an
  owner request was taken and that turn sent no message at all about it (no reply, nothing to a
  teammate), the dock shows his last terminal text (`lastAssistantText`) as a muted
  bubble (`card-2`, `ink-2`, label "From Michael's notes" in `t-meta` `ink-3`, 6 lines then
  More). The request stays "Michael has it", the app reminds Michael once, and it never
  counts as Answered or notifies.
- **10. Couldn't finish (10A).** Michael closes a request he can't do with a one line reason
  (required by his instructions; "No reason given" otherwise). "Couldn't finish" carries a
  quiet "Ask again" that puts the question back in the composer to edit.
- **11. Acknowledgment (11A).** The app sets Sent, finishing something and Michael has it
  from real events. Never typing dots. Holding replies and answers come only from Michael.
- **12. Arrival (12A).** Answered and Couldn't finish send one desktop notification titled
  with Michael's name, body his first sentence (120 characters); clicking brings the app
  forward with the dock open at that reply. Holding replies and notes only raise the count.
  No notification while the dock is open and the app is in front. Never twice for one
  request. Gated on the notifications setting like every owner toast.
- **13. What the chat is for (owner).** "Anything that is not asked to Michael directly as
  a question should not come to this new chat design. Regular outcomes that either the
  owner cannot resolve or as a result of scheduled jobs, such as Oscar's weekly report, go
  to Ask me." The dock holds only the owner's own questions and Michael's replies to them.
  Scheduled job outcomes and outcomes the office could not resolve become Ask me cards,
  raised by Michael.
- **14. Report cards (14A).** A report is an Ask me card with a "Report" tag
  (`neutral-soft`, `ink-2`), the person's chip, Michael's one line headline, §7.8 file rows,
  and a secondary "Got it" beside the usual reply ("Got it" clears it; a reply goes to
  Michael like any answer). Reports never turn the pill coral and never hold the column
  open: the coral pill counts questions only; with only reports waiting the quiet pill reads
  "1 report" and opens the board. Reports sort below questions.
- **15. Follow ups stay where they started (owner).** "If something is asked in the dock,
  the response should come to the dock. If that also answers a card in Ask me then Michael
  should take care of clearing that card and routing back to where that response needs to
  propagate." Michael asks his questions about a dock request in the dock; the owner answers
  there. When an owner's dock reply also settles an open Ask me card, Michael clears that
  card and routes the answer. The app records the owner's dock reply word for word, so it
  can be relayed as the owner's (the same rule as Ask me answers, `answerKey`).
- **16. Michael's questions in the dock (16A).** Reply shows under his question back while it
  waits, and under his latest answer to an answered question, so an offer he ends with is
  taken up in its thread (2026-10-17). The status line reads "Waiting for you" in
  `coral-text`. While any dock question waits on the owner the composer count is
  `coral-strong` instead of `indigo`, and clicking it opens the dock at the oldest such
  question. One desktop notification: "Has a question about <request, clipped>". The Needs
  you pill and Ask me board are unchanged by dock questions.
- **17. Delivery (17A; mechanism per R1, R3, R4, R6, R7).** Every message from the bottom bar
  composer, Michael's Work tab composer and "Message Michael about X" becomes a tracked owner
  request, except a first word in the app's slash command list, which goes straight to his
  terminal as today: a hive `request` from `human` with its own id, `conversation:
  "owner:<id>"`, `requires_reply`, attachments as file paths, filed as the owner's sent mail and
  handed to Michael as its own queued work order. It stays in Michael's open requests from the owner until he replies
  `to: "human"` with `in_reply_to` its id; the app keeps the reply's text for the dock.
  Holding replies are `inform` with an expected time; final replies `done` (Answered) or
  `refuse` with a reason (Couldn't finish); a question back is `query`. Keystrokes typed
  into Michael's terminal stay possible on the Work tab but are not tracked. The false
  `needsHuman` plane for `to: "human"` goes.
- **18. Long answers (18A).** Michael's bubbles render markdown at 12.5 / 18 `ink` (as the
  open Ask me card), folded at 8 lines of height (notes 6) with a fade, then a quiet "More" that
  expands in place, the first sentence bold (`askHeadline`). A longer answer is laid out by
  Michael: the answer in the first sentence, then a list, a small table of 2 or 3 columns, or
  short paragraphs under a bold label, and the next step last, an offer as a question; he copies
  a team member's figures exactly, with their currency (reply readability review, 2026-10-17). Files named in a reply show as §7.8 file rows with their "Not
  found" state.
- **19. Small windows (19A).** Up to 430 px tall, never taller than the room between the
  top bar and the bottom bar minus 24 px; with under 280 px it scrolls to the latest
  request and reply. It may cover the office floor, never the right column or top bar.
- **20. Accessibility (20A).** `role=region` labelled "Conversation with Michael". One
  polite live region announces only Answered, Couldn't finish and Waiting for you, never
  Sent or Michael has it. After Send, focus stays in the composer; Esc with focus inside
  closes the dock and returns focus to the composer. Words plus a dot, never color alone.
  The count is a button named "N new from Michael" or "Michael is waiting for you". More,
  Ask again, Nudge, the example chips and the quoted question take the §12 focus ring.
  All text 4.5:1 or better in both themes.
- **21. Open and close (21A).** Opens only on the owner's action: Send, the count, the conversation button (a chevron, up to open and down to close, shown whenever there is saved history), a
  notification, or focusing the composer while replies are unread. Never by itself, never
  at launch. Closes on ✕, Esc with focus inside, or a click on the office floor while the
  composer is empty. Selecting a person or opening Needs you leaves it open. The draft is
  never lost. Slides 180 ms from the composer's top edge; reduced motion snaps.
- **22. History (22A).** Opens scrolled to the latest with "Today", "Yesterday", then dates
  as dividers (`t-meta` `ink-3`). Open requests always show. Answered exchanges older than
  30 days fold under a quiet "Earlier" link at the top that loads them.
- **23. Wide 1:1 (design and eng reviews, 2026-10-17).** Open wide, beside ✕ (the panels'
  `expand` / `minimize` button, "Open wide" / "Back to the side"), moves the conversation and
  the message box to the center, the office dimmed and out of reach. It never covers the right
  column (owner, 2026-10-17): with Needs you or a panel at the side open, it fills the office's
  width beside it and the column stays live, since a question there may be what the owner asks
  Michael; with the column closed it takes the wide panel's frame. Its own choice, remembered on this computer and changed only by that button
  (1A, 7A). Wide, questions and replies read at `t-read` 14 / 22 in a 720 px column, nothing
  folds (2A), tables are as wide as their columns, 24 px apart (4A). Esc goes back to the side
  for now, a second Esc closes (6B); the next open is wide again. One thing holds the center:
  whichever the owner opened last, the 1:1 or a wide panel, the other back to the side for now
  (8A); the board never moves it. It is drawn outside the office (a portal into a host beside the column), so the
  draft, files, reply target, opened replies and the reading spot survive the move; caret and
  undo reset (eng R1). Rules in `shell/wideCenter.ts`, tests in `test/wide-dock.test.cjs`.

## What already exists (reuse)

- `ownerRequests.ts`: owner requests stay in Michael's context until he replies
  `in_reply_to`; `answerKey` records owner words the app saved itself.
- `MessageQueueComposer` and the bottom bar composer (§7.19): frame, attach, Enter to send.
- §7.8 Ask me card: markdown at 12.5 / 18, `askHeadline`, file rows (`AskFileRows`) with
  "Not found".
- §3.5 status palette, §7.23 toasts and `ownerToast` titled with Michael's name.
- `transcriptPaths` and `lastAssistantText()` for the terminal only fallback.
- `useNeedsYou` feed and the Needs you pill (§7.5) for report cards.

## NOT in scope

- A Messages tab on Michael's panel: the dock is the one place; a second view would split it.
- Notification digests or batching: one notification per answer is already rare.
- Reaching team members directly: the owner still talks only to Michael (owner-talks-via-michael.md).
- Slack and voice: hidden today; when they return they should feed the same requests.
- The website: separate repo.

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|---|---|---|---|
| Where it lives | /Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/designs/michael-replies-20261006/where-the-thread-lives.html | B, the dock | First round; status chips in it are superseded by issues 4 and 5 |
| Dock states and report card | /Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/designs/michael-replies-20261006/dock-states.html | All decisions drawn | Build from this one (HTML/CSS with the app's tokens, owner rule) |

## Implementation Tasks

Synthesized from the design review decisions and the engineering review (R1 to R8, outside
voice findings 1, 5, 7, 9). Effort ratios: features about 30x, tests about 50x.

- [x] **T1 (P1, human: ~2d / CC: ~1h)** Composer routing and request filing (R3, R4, R6, R7)
  - Surfaced by: R3, R4, R6, R7; design 2A, 17A
  - Files: src/shared/ownerRequests.ts (`ownerComposeTarget`: command vs request, attachments block), src/renderer/src/shell/BottomBar.tsx, src/renderer/src/components/MessageQueueComposer.tsx, src/renderer/src/components/CommandCenterPanel.tsx, src/renderer/src/hooks/useHive.ts (one work order per request, typed = taken, cancel = remove), src/main/hive.ts (file owner's sent mail at send, Michael's `inbox/.done` when typed), src/main/index.ts and src/preload/index.ts (IPC)
  - Verify: test/michael-replies.test.cjs composer and delivery cases; R3 and R7 acceptance assertions
- [x] **T2 (P1, human: ~2d / CC: ~1h)** Reader, closure and router (R1, R2, outside voice 1 and 5)
  - Surfaced by: Section 1 findings; outside voice 1, 5, 9
  - Files: src/shared/ownerRequests.ts (`owner:<id>` conversations, close only on done or refuse, cutover floor, any owner alias, thread shape, dock answer keys), src/main/hive.ts (`expect_by` and `from_notes` in `HiveMessage` and `normalize`, R2 note, drop `needsHuman`, `owner-request-closed` only for done or refuse, `refreshOwnerRequests` returns conversations), src/main/index.ts (separate dock key list)
  - Verify: test/owner-requests.test.cjs extended; router cases in test/michael-replies.test.cjs; closing time tests unchanged
- [x] **T7 (P1, ships with T1 and T2, human: ~1d / CC: ~45min)** Michael's instructions
  - Surfaced by: outside voice 9; design 10A, 13, 15A, 17A; R2, R8
  - Files: src/main/hive.ts (business prompt: "human" for owner replies with `in_reply_to`, acts inform with `expect_by`, query, done, refuse with a reason; questions about a dock request go to the dock; withdraw an Ask me card settled in the dock, never write `a`; scheduled and unresolved outcomes go to Ask me, reports as `kind: "report"`), src/shared/ownerRequests.ts (`ownerRequestsContext` wording), src/shared/michaelWorkStyle.ts
  - Verify: prompt pin tests (no eval suite in the repo)
- [x] **T3 (P1, human: ~1d / CC: ~45min)** Dock state and the late sweep (R5; design 6A, 7A)
  - Files: src/main/hive.ts or a small helper beside it (`agents/human/state.json`, atomic, bad file = all read and notified), src/main/index.ts (sweep on the existing interval: late flag, one reminder, Nudge at most hourly)
  - Verify: relaunch keeps read, notified, withdrawn; reminder once; Nudge rate limit
- [x] **T4 (P1, human: ~3d / CC: ~2h)** The dock (design 1B, 3A, 4A, 5A, 8A, 18A to 22A)
  - Files: src/renderer/src/shell/MichaelDock.tsx (new), src/renderer/src/shell/BottomBar.tsx, locales en, zh-CN, ar
  - Verify: matches dock-states.html in light and dark; RTL; source pins
- [x] **T5 (P1, human: ~1d / CC: ~30min)** Count and notifications (design 2A, 12A, 16A, 20A)
  - Files: src/main/index.ts (`ownerToast` click opens the dock at the request; notified in state.json), BottomBar.tsx (indigo or coral count), test/schedule-requests.test.cjs (toast titles)
  - Verify: one notification per final reply or question; none while the dock is open in front
- [x] **T6 (P1, human: ~1d / CC: ~30min)** Notes fallback (R8)
  - Files: src/main/hooks.ts (Stop hook: request taken, turn sent no message about it), src/main/transcriptText.ts
  - Verify: a delegating turn files no notes; a terminal only turn files one, recorded in state.json; an agent written `from_notes` file never shows
- [x] **T8 (P1, human: ~1d / CC: ~45min)** Report cards on Ask me (design 14A; outside voice 7)
  - Files: src/renderer/src/components/AskMeTab.tsx, askMeOrder.ts, hiveTasks.ts (`kind: "report"`), src/renderer/src/shell/useNeedsYou.ts (coral counts questions only), TopBar.tsx (quiet "1 report" pill), "Got it" as an app dismissal with a trusted marker
  - Verify: a report never turns the pill coral or locks the column; Got it sends nothing to Michael
- [x] **T9 (P2, human: ~2h / CC: ~15min)** Spec and docs
  - Files: branding/DESIGN.md (§7.19 dock, §7.8 report card, §7.5 quiet report pill), docs/FEATURES.md, TODOS.md (close the 30 day window and reply alias items)

### Parallelization

| Step | Modules touched | Depends on |
|---|---|---|
| T2 reader and router | src/shared, src/main/hive | none |
| T7 instructions | src/main/hive prompts, src/shared | T2 (same messages) |
| T1 composer and filing | src/renderer hooks and shell, src/main/hive, preload | T2 (message shape) |
| T3 dock state, sweep | src/main | T1 |
| T6 notes fallback | src/main/hooks | T3 |
| T5 notifications | src/main/index, renderer shell | T3 |
| T4 dock UI | src/renderer/shell, locales | T1 (IPC shape) |
| T8 report cards | src/renderer/components, shell | T7 (report kind) |

Lane A: T2, then T7, then T1, then T3, then T6 and T5 (src/main and src/shared, sequential).
Lane B: T4 and T8 once T1's IPC shape and T7's report kind are fixed (renderer only).
Conflict flags: src/preload/index.ts, src/renderer/src/shell/BottomBar.tsx and the locale files
are touched by both lanes; merge Lane A first.

## Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | branding/DESIGN.md present; UI scope: dock, |
  |                      | composer count, Ask me report card, toasts  |
  | Step 0               | 3/10; all 7 passes                          |
  | Pass 1  (Info Arch)  | 2/10 → 9/10 after fixes                     |
  | Pass 2  (States)     | 2/10 → 9/10 after fixes                     |
  | Pass 3  (Journey)    | 3/10 → 9/10 after fixes                     |
  | Pass 4  (AI Slop)    | 8/10 → 8/10 (no issues)                     |
  | Pass 5  (Design Sys) | 6/10 → 9/10 after fixes                     |
  | Pass 6  (Responsive) | 2/10 → 9/10 after fixes                     |
  | Pass 7  (Decisions)  | 2 resolved, 0 deferred                      |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (5 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 2 built (HTML/CSS), 1 direction approved    |
  | Decisions made       | 22 added to plan                            |
  | Decisions deferred   | 0                                           |
  | Overall design score | 2/10 → 8/10                                 |
  +====================================================================+
```

Pass 4 stays at 8: the dock is a familiar chat pattern by choice (conventions over
novelty), and the brand lives in the tokens, not in new ornament.

### Unresolved Decisions

None.

## Engineering review (2026-10-06)

Target: docs/designs/michael-replies.md (this file is the report file).

### Scope record

feature answers: no cuts proposed; structure: Smaller arrangement, chosen under the
owner's standing rule "never ask file/module layout choices; pick the recommended one"
(memory: no-code-arrangement-questions); accepted scope: the design above, built with one new
module (`src/renderer/src/shell/MichaelDock.tsx`); request and status logic go into the
existing `src/shared/ownerRequests.ts`, and the conversation is read from the hive by the
existing owner request reader (R1). Pending remedies: R2, R3. Scope Challenge result:
scope accepted as-is.

### Data flow (approved R1 to R8)

```
 Owner types in a composer
   |-- first word is a known slash command (claudeCommands.ts) --> queue -> Michael's terminal (R3, R7)
   '-- otherwise:
         app files agents/human/outbox/.sent/<id>.json (owner's sent mail, R4)
         + dock answer key (own list, R4) ; state.json entry (R5)
         + queue work order for Michael carrying <id> and the reply rule (R6)
           dock: "Sent" ; "Sent, Michael is finishing something (N ahead)" = queue position
           cancel before typed = remove from queue + state.json withdrawn
          |
          v  typed into his terminal (existing queue drain)
   dock: "Michael has it" ; app files agents/god/inbox/.done/<id>.json (R6)
          |  -> his OPEN REQUESTS FROM THE OWNER from now on (ownerRequests.ts)
          v
   Michael delegates (as with Ask me answers), then writes his outbox:
     to human, in_reply_to <id>, act inform (+ expect_by) | query | done | refuse
          |
          v  routeMessage (hive.ts:1921)
     |-- no in_reply_to, not CLOSING-TIME-COMPLETE --> system note: resend with the id (R2)
     '-- filed in agents/god/outbox/.sent; routedObserver still runs;
         only done or refuse closes an owner:<id> request (outside voice 1)
          |
          v  refreshOwnerRequests on the fleet tick (cached; messageCache)
   conversation = owner's sent mail + Michael's replies + state.json  --> IPC --> MichaelDock
          |
          '-- done, refuse or query: one ownerToast (state.json notified; click opens dock)
   Stop hook, request taken, turn sent no message about it (R8): last text filed once as
   {from god, to human, act inform, in_reply_to, from_notes}; id recorded in state.json
```

### Section 1, Architecture

- [P1] (confidence 9/10) src/main/hive.ts:87 to 100: `HiveMessage` has no field for when Michael
  expects to answer, and `normalize` (hive.ts:1884) copies only known fields, so decision 6A's
  "a field the app reads" would be dropped. Required work of 6A: add `expect_by` (ISO time) and
  `from_notes` (boolean) to `HiveMessage` and `normalize`. Disposition: accepted as required
  work of 6A and 9A, no new choice.
- [P1] (confidence 9/10) src/main/hive.ts:2075 `needsHuman: msg.to === 'human'`: every Michael
  message to the owner flies a coral envelope that bumps the Needs you pill with nothing on the
  board. Required work of 17A: drop it. Disposition: accepted under 17A.
- [P1] (confidence 9/10) src/shared/ownerRequests.ts:41 `openOwnerRequests` keeps only
  messages whose conversation is a card (`cardOfConversation`), and hive.ts:2462 reads 30 days.
  Required work of R1: accept `owner:<id>` conversations, drop the 30 day window for open
  requests (TODOS.md:947), and close on any owner alias (TODOS.md:948). Disposition: accepted
  under R1.
- [P2] (confidence 8/10) Decision 11A, "when his session takes the message": defined as the
  inbox-wake nudge naming that request id being typed into his terminal (useHive.ts:922 path,
  dispatch success) or the request file leaving `inbox/`, whichever is first. Disposition:
  accepted as the mechanism of 11A.
- [P2] (confidence 8/10) Decision 15A: Michael settles an Ask me card answered in the dock by
  withdrawing it (`dismissedAt`, `dismissedReason` "Answered in your conversation with
  Michael"), never by writing `a`, because the launch catch-up relays only answers the app
  recorded (ownerRequests.ts `catchUpRequests`). Disposition: accepted as the mechanism of 15A,
  in Michael's instructions (T7).
- [P2] (confidence 8/10) Decision 14A: a report is a `humanQA` entry with `kind: "report"` that
  Michael adds; it never needs the card blocked; `openAskIndexes`, `waitsOnHuman` and the
  coral count in `useNeedsYou` skip it, and a "report" count drives the quiet pill.
  Disposition: accepted as the mechanism of 14A.
- [P2] (confidence 9/10) src/main/index.ts:1615 `ownerToast` creates a Notification with no
  click handler. Required work of 12A: a click focuses the window and opens the dock at that
  request. Disposition: accepted under 12A.
- Production failure per path: Michael never replies (6A late flag and reminder cover it);
  Michael replies without the id (R2 note); the app quits mid send (the inbox file is written
  atomically by `atomicWriteJson`, so it either exists or not; the dock shows Not sent only when
  the IPC failed); closing time (unchanged observer).

### Section 2, Code quality

- [P2] (confidence 8/10) Decision 9A under R1 (no new store): the notes fallback is filed in
  Michael's own `outbox/.sent` as his message with `from_notes: true` and `in_reply_to`, once
  per request (the first Stop after "Michael has it" with no reply), so the existing reader
  shows it and nothing else stores it. Disposition: accepted as the mechanism of 9A.
- [P2] (confidence 7/10) Two composers build the "Attached files:" block separately
  (BottomBar.tsx:65 to 68, MessageQueueComposer.tsx:121). Both must now also choose between
  request and terminal (R3). Shared code rubric: two verified callers with the same behavior,
  so one helper `ownerComposeTarget(text, attachments)` in src/shared/ removes about 12
  duplicated lines and keeps the "/" rule in one place. Disposition: accepted under the owner's
  standing rule on code arrangement (pick the recommended one), as part of R3's required work;
  estimated 12 lines removed, 25 added with tests.
- No other quality issues: request and status logic join `ownerRequests.ts`, which already
  owns the owner request duty.

### Section 3, Tests

```
CODE PATHS                                              USER FLOWS
[+] src/shared/ownerRequests.ts                         [+] Ask a question
  ├── openOwnerRequests: owner:<id> requests [GAP]        ├── [GAP] [→E2E] type, Sent, has it, answered, file opens
  ├── open beyond 30 days stays open         [GAP]        ├── [GAP] late: Later than he said, Nudge rate limit
  ├── close on any owner alias               [GAP]        ├── [GAP] Michael asks back: coral count, answer in dock
  └── state from acts (inform/query/done/refuse) [GAP]    └── [GAP] cancel while in inbox, refused after taken
[+] src/main/hive.ts routeMessage                        [+] Commands (regression, R3)
  ├── R2 note when no in_reply_to            [GAP]        ├── [GAP] "/compact" goes to terminal, no request
  ├── CLOSING-TIME-COMPLETE untouched        [★★ TESTED] closing-time tests ├── [GAP] "/clear" resets the gauge (existing test extended)
  ├── observer runs on every path            [★★ TESTED] (owner-requests.test.cjs)
  └── needsHuman flag dropped                [GAP]
[+] normalize keeps expect_by, from_notes    [GAP]
[+] Stop hook notes fallback, once           [GAP]
[+] ownerToast click opens dock              [GAP]
[+] report kind skipped by coral count       [GAP]       [+] Report card: Got it clears it [GAP]
[+] michael prompt text (T7)                 [GAP] [→EVAL] no eval suite in repo; pinned by prompt tests

COVERAGE: 2/19 paths tested  |  GAPS: 17 (1 E2E, 1 eval candidate)
```

Every gap above is required proof of an approved behavior (R1 to R3, decisions 2 to 22) and
becomes a test in the Test Plan artifact; none is optional depth. Tests go in the repo's
`node --test test/*.test.cjs` suites: extend `test/owner-requests.test.cjs` (reader, aliases,
window, acts), `test/schedule-requests.test.cjs` (toast titles and click), a new
`test/michael-replies.test.cjs` (router note, normalize fields, composer rule, cancel, notes
fallback, report counts, dock source pins). Tests made obsolete: none.

### Section 4, Performance

- Withdrawn after the outside voice (factual correction): `messageCache` (hive.ts:2484) already
  parses each file once by path, so removing the window leaves only a directory listing per
  fleet tick (about 7,000 entries a year at 20 messages a day). Reply bodies load for the dock's
  30 days, older on "Earlier". No issues found.

### Outside voice (Claude Plan subagent, in host; Codex not used by owner choice)

The reviewer's ten findings, checked against the code:

1. Holding replies would close the request: ownerRequests.ts:44 treats any reply to `human`
   with `in_reply_to` as the closure (verified). Required work of 6A and 9A: an `owner:<id>`
   request closes only on `done` or `refuse`; `inform`, `query` and `from_notes` never close it;
   hive.ts:1974 logs `owner-request-closed` only for those acts. Removing the 30 day window
   gets a cutover floor (card requests older than the build that removes it stay settled), so
   months of old card requests do not reappear. Disposition: accepted as required work.
2. The owner's words exist only as a file Michael moves himself, and owner answer keys are
   capped at 2000 (index.ts:4541, verified). Choice R4 below.
3. Per request flags (notified, unread, withdrawn, reminded, Nudge time, Not sent) cannot be
   rebuilt from hive files. Choice R5 below.
4. "Michael has it" and cancel: one inbox nudge per agent (store.ts:1216, verified), and the
   file leaving `inbox/` is Michael's own move after handling. Choice R6 below.
5. Follow up shapes. Required specification of 15A and 16A: the owner's dock answer to a
   `query` is a new `request` from `human` in the same `owner:<id>` conversation with
   `in_reply_to` the query's id; a dock answer key is `owner:<id>|<sent at>|<digest>`; state
   is per request id, a thread is all requests in one conversation. Disposition: accepted.
6. The notes fallback would fire on ordinary delegation turns. Choice R8 below.
7. "Got it" on a report must be a dismissal, not an answer (no request to Michael).
   Required mechanism of 14A ("Got it clears it"): the app sets `dismissedAt` with a trusted
   app marker. Disposition: accepted.
8. A "/" rule would send pasted paths ("/Users/... is wrong") untracked to the terminal.
   Reopens R3. Choice R7 below.
9. Sequencing: T7 (Michael's instructions) must ship with T1 and T2; today's prompt says
   "human" is for closing time only and lists request, inform and done (hive.ts:320, verified),
   and `ownerRequestsContext` says each request is an answer on a card. Disposition: accepted,
   T1, T2 and T7 land together.
10. Section 4 correction: `messageCache` (hive.ts:2484) already parses each file once by path;
    what remains is a directory listing every fleet tick, which is minor. Disposition: factual
    correction, Section 4 finding withdrawn.

## Decision ledger

### R1: Where the owner and Michael conversation is stored
Finding: S1, P1, confidence 9/10, plan T2 ("route `to: "human"` replies into an owner conversation store") and src/shared/ownerRequests.ts:44 (owner requests read back from hive files); reviewer: Claude (eng review).
Plan baseline: unspecified store location (original proposal T2).
Runtime evidence: owner requests and Michael's replies exist today only as files in the hive (`agents/god/inbox/.done`, `agents/god/outbox/.sent`), which agents can write; `openOwnerRequests` reads 30 days only (TODOS.md:947). Decision 15A requires the owner's dock words recorded word for word by the app.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 store | unspecified, pending | app owned file in the app data folder: owner message written at send (IPC), Michael's reply written by the router as it routes | derived from hive files on each read |
| R2 unmatched replies | pending | pending | pending |
| R3 slash commands | pending | pending | pending |
Question D1:
D1. Where is the conversation with Michael kept? <gstack-qid:plan-eng-review-conversation-store>
Project: michael-replies.md, engineering review (main branch, nothing built).
ELI10: Every question you ask Michael and every reply he sends has to be saved so the dock can show it after a restart. It can live in the app's own data folder, written by the app at the moment you send and the moment Michael replies. Or the app can rebuild it each time from the message files in the office folder, which the agents themselves can write.
Stakes if we pick wrong: a forged or edited "owner" message could show in your conversation, or old requests drop out after 30 days.
Recommendation: A, because the app writes both sides at trusted moments and keeps them as long as needed (decision 15 needs your words recorded by the app).
Completeness: A=9/10, B=5/10
Pros / cons:
A) App owned file (recommended)
  ✅ Your words are recorded when you send, and Michael's reply when the router passes it on; agents never write this file through the hive.
  ✅ No 30 day window, survives office folder cleanups, and matches the mail approvals store already in the app.
  ❌ Only as safe as the app's data folder; the open task "Keep agents out of the app's data folder" should land first or with it. (human: ~1 day / CC: ~30 min)
B) Rebuild from hive files
  ✅ No new file; uses what is already written today.
  ❌ Agents can write those folders, the 30 day read window drops old requests, and every open of the dock rereads many files.
Net: a trusted record versus no new storage.
Header: Store
Options:
A) App owned file (Recommended)
Owner messages written at send, Michael's replies written by the router; JSON lines in the app data folder beside mail-proposals.json.
B) Rebuild from hive files
Read god's inbox and outbox history on each open; no new file.

State: approved
Actual answer: owner, D1 (2026-10-06), choosing the existing architecture: "i do not want to build a parallel system and want to leverage the core architecture of orchestrator agent managing army of agent. owner questions are same as response to Ask me except they may not have a previous context. but those will go to michael like ask me and michael will delegate that to the right agent as in ask me case. So, unless there is a serious downside I would like to leverage existing architecture and minimize the app specific parallel solutions that replicates what exists." Recorded as B, with no serious downside found.
Accepted scope: no new store. An owner question is a hive `request` from `human` to Michael, exactly like an Ask me answer (`answerMessages`), with `conversation: "owner:<id>"` in place of `card:<id>`; Michael delegates it as he does Ask me answers. Michael's replies stay where they are filed today (`agents/god/outbox/.sent`). The existing owner request reader (`refreshOwnerRequests`, `openOwnerRequests`, cached on the fleet tick) is extended to return each owner conversation request with its replies and state for the dock. The owner's own words are verified with the existing recorded answer keys (`answerKey`, a digest the app saves at send), so a message an agent forged into the hive is not shown as the owner's. The reader's 30 day window (TODOS.md:947) is fixed in the shared reader for Ask me and dock alike, and the reply alias gap (TODOS.md:948) with it.
History: none

### R2: A reply from Michael that names no request
Finding: A1, P1, confidence 8/10, src/main/hive.ts:1974 (`if (msg.from === godId && resolveTo(msg.to) === godId && msg.in_reply_to)` notes a closure only when `in_reply_to` is set) and src/main/hive.ts:1945 (any of "human", "god", "michael" or his name resolves to Michael); reviewer: Claude (eng review).
Plan baseline: decision 17A, replies are matched by `in_reply_to` the request id, never by text (decision 4A).
Runtime evidence: a Michael message `to: "human"` without `in_reply_to` is routed, logged by subject, and filed in his outbox; nothing tells him it matched nothing. Closing time also sends `to: "human"` (subject CLOSING-TIME-COMPLETE) and must not be touched.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 store | approved D1: existing hive and reader | same | same | same |
| R2 unmatched replies | filed, ignored | router sends Michael a system note naming his open owner requests and asking him to reply again with `in_reply_to`; the request stays open | attached to the newest open owner request | filed as today; the request stays open in his OPEN REQUESTS until a matched reply |
| R3 slash commands | pending | pending | pending | pending |
Question D2:
D2. What happens when Michael replies to you without naming which request it answers? <gstack-qid:plan-eng-review-unmatched-reply>
Project: michael-replies.md, engineering review (main branch, nothing built).
ELI10: Each reply has to say which of your questions it answers, so it lands under the right one. Michael will sometimes forget. The router already sends agents short system notes when they address a message wrong (a teammate handing out work, an unknown name), and his open requests from you already stay in front of him until he replies.
Stakes if we pick wrong: his answer exists but never shows in your dock, or it lands under the wrong question.
Recommendation: A, because it reuses the router's existing correction notes and the open request list, so Michael fixes it himself within a turn and nothing is guessed (explicit over clever).
Completeness: A=9/10, B=5/10, C=6/10
Pros / cons:
A) Router tells Michael to resend it (recommended)
  ✅ Same pattern as today's "sent to Michael" and "undeliverable" notes: he gets one system note listing your open requests and resends with the id.
  ✅ Nothing is guessed; closing time's CLOSING-TIME-COMPLETE and replies to Ask me cards are untouched. (human: ~3 hours / CC: ~15 min)
  ❌ One extra Michael turn when he forgets, so that answer reaches you a minute later.
B) Attach to your newest open request
  ✅ The answer always shows, at once.
  ❌ With two open questions it can land under the wrong one, which decision 4 ruled out.
C) Leave it filed; the request stays open
  ✅ No new code; his open request list already nags him.
  ❌ Until his next turn notices, the answer he wrote is invisible to you.
Net: a quick self correction versus guessing or waiting.
Header: Unmatched
Options:
A) Router asks to resend (Recommended)
A system note to Michael listing your open requests; he replies again with the id. Closing time and Ask me replies untouched.
B) Attach to newest request
The reply is shown under your most recent open question.
C) Leave it filed
No change; the request stays in his open list until he replies with the id.

State: approved
Actual answer: A) Router asks to resend (Recommended), owner answer to D2, 2026-10-06.
Accepted scope: when a Michael message to the owner (any alias resolving to the owner) has no `in_reply_to`, is not closing time's CLOSING-TIME-COMPLETE, and Michael has open owner conversation requests, the router delivers him one system note listing those requests (id and first words) and asking him to send the reply again with `in_reply_to`; the requests stay open. Replies to Ask me card requests are unchanged. The routed observer still runs for every message (pitfall: router-early-return-skips-observer).
History: none

### R3: What the composers keep doing when messages become requests (regression contract)
Finding: Q1, P1, confidence 9/10, src/renderer/src/components/CommandCenterPanel.tsx:236 (`if (t.trim().toLowerCase() === '/clear') {` in Michael's Work tab composer), src/renderer/src/shell/BottomBar.tsx:65 to 68 (attachments become an "Attached files:" block of paths), plan decision 2A (edit or cancel a queued message on its bubble); reviewer: Claude (eng review). REGRESSION RULE.
Plan baseline: decision 17A, every composer message becomes a tracked owner request; decision 2A, edit or cancel happens on the "Sent" bubble.
Runtime evidence: today both composers type text into Michael's terminal through the queue; owner typed slash commands such as /clear and /compact reach his session that way, and the /clear path resets the context gauge; attachments are file paths in the text. As requests, messages land in Michael's inbox at once, so "queued" becomes "in his inbox, not yet taken".
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 store | approved D1 | same | same |
| R2 unmatched replies | approved D2 | same | same |
| R3 slash commands | typed into the terminal | text starting with "/" still goes straight to his terminal, untracked, no dock entry | becomes a request like any text |
| R3 attachments | "Attached files:" paths in the text | same block, in the request body | same block, in the request body |
| R3 edit or cancel | queue item can be removed before typing | while the request is still in his inbox, cancel removes it and records it withdrawn; edit is cancel and resend | same as A |
Question D3:
D3. Which of today's composer behaviors must keep working once messages become requests? <gstack-qid:plan-eng-review-composer-regression>
Project: michael-replies.md, engineering review (main branch, nothing built).
ELI10: Today the "Talk to Michael" box types whatever you write straight into Michael's terminal. That includes commands like /clear (start a fresh conversation) and /compact, and file attachments listed as paths. Once your messages become tracked requests, a /clear would arrive as a question in his inbox instead of a command. This settles what must keep working and how we test it.
Stakes if we pick wrong: commands you rely on silently stop working, or get answered as if they were questions.
Recommendation: A, because commands keep their meaning and everything else gains tracking, with tests pinning each case (no regressions, explicit over clever).
Completeness: A=9/10, B=5/10
Pros / cons:
A) Commands stay commands; the rest become requests (recommended)
  ✅ Text starting with "/" goes straight to his terminal as today, with no dock entry; /clear still resets the context gauge.
  ✅ Attachments stay as file paths in the request; a request still in his inbox can be cancelled or edited from its bubble. Tests pin all three. (human: ~1 day / CC: ~30 min)
  ❌ Two paths from one box; the dock shows nothing for a command, which is intended but needs a test.
B) Everything becomes a request
  ✅ One path, simplest to build.
  ❌ /clear and other commands stop working from the composer; you would have to type them in his Work tab terminal.
Net: commands keep working versus a single delivery path.
Header: Composer
Options:
A) Commands stay commands (Recommended)
"/" text goes to his terminal as today; attachments as paths in the request; cancel or edit while still in his inbox; tests pin each.
B) Everything is a request
All composer text becomes a tracked request, slash commands included.

State: approved
Actual answer: A) Commands stay commands (Recommended), owner answer to D3, 2026-10-06.
Accepted scope: regression contract. Preserve: text starting with "/" from either composer goes straight to Michael's terminal through the queue as today, untracked, with no dock entry, and "/clear" still resets the context gauge. Intended change: all other text becomes a tracked owner request. Attachments keep the "Attached files:" block of paths, inside the request body. A request still in Michael's inbox can be cancelled from its bubble (the app removes the inbox file and records it withdrawn) or edited (cancel, then resend). Acceptance assertions: a "/compact" typed in the bottom bar is queued for his terminal and creates no request; "/clear" resets the gauge as today; "Check the books" creates one `request` from `human` with `conversation: owner:<id>`; an attachment's path appears in that request's body; cancelling while in the inbox removes the file and shows the request withdrawn; cancelling after he took it is refused with the bubble unchanged.
History: none

### R4: A copy of the owner's own messages the app keeps
Finding: outside voice 2, P1, confidence 9/10, src/main/index.ts:4541 (`const OWNER_ANSWER_KEYS_MAX = 2000;`) and R1's accepted scope (owner's words only in Michael's inbox); reviewer: Claude Plan subagent.
Plan baseline: R1 approved: no new store; the owner's question lives as the request file in Michael's inbox, verified by answer keys.
Runtime evidence: Michael moves inbox files himself (`inbox` to `inbox/.done`); a deleted or misplaced file closes the request silently and the question leaves the dock. Keys past 2000 drop, about 100 days at 20 a day.
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| R4 owner copy | inbox file only; shared 2000 key cap | at send the app also files the message in the hive as the owner's sent mail (`agents/human/outbox/.sent/<id>.json`, written only by the app); the dock reads it as the record; dock keys get their own list with no 100 day loss | as R1 | read Michael's transcripts for how often inbox files go missing, then decide | leave as R1 now, add a TODO |
| R5 flags | pending | pending | pending | pending | pending |
| R6 delivery | pending | pending | pending | pending | pending |
| R7 command rule | pending | pending | pending | pending | pending |
| R8 notes fallback | pending | pending | pending | pending | pending |
Question D4:
D4. Should the app keep its own copy of each message you send Michael? <gstack-qid:plan-eng-review-owner-copy>
Project: michael-replies.md, engineering review (main branch, nothing built).
ELI10: Right now your question exists only as a file in Michael's inbox, and Michael moves those files himself. If he deletes or misplaces one, your question quietly disappears from the dock. Agents already keep their sent mail in the office folder; the app can do the same for you, so your words have a home only the app writes.
Stakes if we pick wrong: a question you asked vanishes with no trace, and history older than about 100 days can't be verified.
Recommendation: A, because it stays inside the existing office folder pattern (sent mail per sender) and closes the only hole where your words can be lost.
Note: options differ in kind, not coverage, so no completeness score.
Pros / cons:
A) Apply: keep your sent mail in the hive
  ✅ Same pattern every agent already uses (outbox/.sent), written only by the app, so the dock always has your exact words.
  ✅ Your dock messages get their own verification list, so history past 100 days still checks out. (human: ~3 hours / CC: ~15 min)
  ❌ One more folder in the hive, and both places must agree on the request id.
B) Keep: inbox file only
  ✅ Nothing new; exactly the Ask me pattern.
  ❌ A moved or deleted inbox file loses your question, and old history can't be verified.
C) Investigate first
  ✅ Measures how often Michael actually loses inbox files before adding anything.
  ❌ Delays the decision; the build waits on it.
D) Defer to a TODO
  ✅ Ships the first version without it.
  ❌ The hole stays open until someone picks the TODO up.
Net: a safe copy in the existing pattern versus no new folder.
Header: Owner copy
Options:
A) Apply this change (Recommended)
The app files each owner message in agents/human/outbox/.sent as the record; dock keys get their own list.
B) Keep this row's current value
The inbox file stays the only copy; shared 2000 key cap.
C) Investigate before choosing
Check transcripts for lost inbox files, then decide.
D) Defer this proposed change only
Leave R1 as is now and add a TODO.

State: approved
Actual answer: A) Apply this change (Recommended), owner answer to D4, 2026-10-06.
Accepted scope: at send, the app files each owner message as the owner's sent mail in the hive, `agents/human/outbox/.sent/<id>.json`, with the same id as the request delivered to Michael; only the app writes it. The dock reads the owner's side of the conversation from there. Dock answer keys are kept in their own list, separate from the 2000 Ask me keys, so dock history stays verifiable.
History: none

### R6: How an owner request is handed to Michael
Finding: outside voice 4, P1, confidence 9/10, src/renderer/src/store/store.ts:1216 (`if (isInboxNudge(trimmed) && queued.some((m) => isInboxNudge(m.text))) {`, one pending nudge per agent) and src/main/hive.ts:2081 (`private emitTerminalHandoff(msg: HiveMessage, targetId: string): boolean {`, the existing work order delivery); reviewer: Claude Plan subagent.
Plan baseline: R1 and the Section 1 mechanism of 11A: the request lands in Michael's inbox, the inbox-wake nudge wakes him, "Michael has it" when that nudge is typed or the file leaves `inbox/`; R3: cancel while still in his inbox.
Runtime evidence: later request ids are never named because only one nudge stays queued; Michael moves the file after handling, not on taking it; cancel can race a file he already read.
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| R4 owner copy | approved D4 | same | same | same | same |
| R6 delivery | inbox file plus one shared nudge | the request is filed as the record (owner's sent mail and Michael's `inbox/.done`) and handed to him as its own queued work order carrying the id, through the existing queue: typed = "Michael has it", cancel = remove from the queue as today, "N ahead" = queue position | as baseline | trace a week of nudges to measure missed ids | keep baseline, TODO |
| R5 flags | pending | pending | pending | pending | pending |
| R7 command rule | pending | pending | pending | pending | pending |
| R8 notes fallback | pending | pending | pending | pending | pending |
Question D5:
D5. How should your request be handed to Michael? <gstack-qid:plan-eng-review-request-delivery>
Project: michael-replies.md, engineering review (main branch, nothing built).
ELI10: The plan drops your question in Michael's inbox and relies on the "new message" nudge to wake him. But only one nudge waits at a time, so a second question never gets its own, and the app can't tell when he actually took it. The app already has a second way to hand work over: it types a short work order into the agent's terminal from the queue, one per message.
Stakes if we pick wrong: "Michael has it" shows when he hasn't, and cancelling a question can race him reading it.
Recommendation: A, because it uses the queue the composer already uses, so "has it", "N ahead" and cancel all come from one real place, and the hive still holds the record (reuse before building).
Note: options differ in kind, not coverage, so no completeness score.
Pros / cons:
A) Apply: a work order per request through the queue
  ✅ Each request is typed to Michael with its id when he's free; typed means taken, the queue position is "N ahead", and cancel is today's remove from queue.
  ✅ The hive keeps the record (your sent mail and his handled inbox), so his open requests and replies work as decided. (human: ~4 hours / CC: ~20 min)
  ❌ Michael sees the request typed rather than reading it from his inbox, a different path from Ask me answers.
B) Keep: inbox plus nudge
  ✅ Identical to how Ask me answers reach him.
  ❌ "Has it" is unreliable with two questions, and cancel can race.
C) Investigate first
  ✅ Measures how often ids are missed before changing delivery.
  ❌ The build waits on it.
D) Defer to a TODO
  ✅ Ships the first version on the inbox path.
  ❌ "Has it" and cancel stay unreliable until then.
Net: one reliable signal through the existing queue versus matching the Ask me path exactly.
Header: Delivery
Options:
A) Apply this change (Recommended)
Each request is a queued work order with its id; filed in the hive as the record; typed = has it; cancel = remove from queue.
B) Keep this row's current value
Inbox file plus the shared nudge; has it when typed or the file leaves inbox.
C) Investigate before choosing
Trace a week of nudges for missed ids, then decide.
D) Defer this proposed change only
Keep the inbox path now and add a TODO.

State: approved
Actual answer: A) Apply this change (Recommended), owner answer to D5, 2026-10-06.
Accepted scope: at send the app files the owner's sent mail (R4); when the work order is typed, the app files Michael's `inbox/.done/<id>.json` so his open owner requests list it from that moment and not before (so a cancelled request never reaches his context) and queues one work order per request for Michael through the existing message queue, carrying the id and the reply rule (`to: "human"`, `in_reply_to` the id). Typed into his terminal = "Michael has it"; position in his queue = "N ahead"; cancel = removed from the queue before it is typed (R3's cancel now means this), refused once typed. Ask me answers keep their inbox path. The inbox-wake nudge does not fire for these requests, since they are filed as handled.
History: R3 cancel was "while the request is still in his inbox"; R6 replaces the mechanism with "while still in his queue", same owner facing behavior.

### R5: Where the dock's own small facts live
Finding: outside voice 3, P1, confidence 8/10, plan decisions 2A (unread), 6A (reminded once, Nudge at most hourly), 7A (Not sent), 9A (reminded once), 12A (never notify twice), R3/R6 (withdrawn); reviewer: Claude Plan subagent.
Plan baseline: unspecified; R1 and R4 say nothing about them.
Runtime evidence: none of these can be rebuilt from the hive messages: they are facts about the app and the owner (seen, notified), not about Michael's replies. Kept only in memory, a relaunch would notify again, mark everything unread and forget reminders.
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| R4 owner copy | approved D4 | same | same | same | same |
| R6 delivery | approved D5 | same | same | same | same |
| R5 flags | unspecified (memory) | one small file the app writes beside the owner's sent mail, `agents/human/state.json`, keyed by request id: read at, notified at, withdrawn at, reminded at, nudged at, not sent | memory only; reset on relaunch | list which flags must survive a relaunch, then decide | memory now, TODO |
| R7 command rule | pending | pending | pending | pending | pending |
| R8 notes fallback | pending | pending | pending | pending | pending |
Question D6:
D6. Where does the dock keep its own small facts, like what you've read and what it already notified you about? <gstack-qid:plan-eng-review-dock-flags>
Project: michael-replies.md, engineering review (main branch, nothing built).
ELI10: Some things the dock needs aren't in any message: which answers you've seen, whether it already sent you a notification, when it last reminded Michael, which requests you cancelled. If they live only in memory, a restart forgets them: you get notified again and everything shows unread.
Stakes if we pick wrong: after every restart you get repeat notifications and a wrong unread count, or a cancelled question comes back.
Recommendation: A, because one small file next to your sent mail keeps them in the same office folder, with no new system (reuse; the dock survives restarts as decided in 7).
Note: options differ in kind, not coverage, so no completeness score.
Pros / cons:
A) Apply: one small state file beside your sent mail
  ✅ Survives restarts: no repeat notifications, unread stays right, cancelled stays cancelled, reminders keep their timing.
  ✅ Lives in the owner's hive folder from D4; only the app writes it. (human: ~3 hours / CC: ~15 min)
  ❌ One more file to keep consistent with the messages; a corrupt file must fall back to "all read, nothing notified".
B) Keep: memory only
  ✅ Nothing written.
  ❌ Every relaunch re-notifies and resets unread, breaking decisions 2, 7 and 12.
C) Investigate first
  ✅ Might show some flags can be derived.
  ❌ The build waits on it.
D) Defer to a TODO
  ✅ Ships sooner.
  ❌ Repeat notifications after restarts until then.
Net: facts that survive a restart versus nothing written.
Header: Dock state
Options:
A) Apply this change (Recommended)
agents/human/state.json, written only by the app, keyed by request id; a bad file falls back to all read, nothing notified.
B) Keep this row's current value
Memory only; reset on every relaunch.
C) Investigate before choosing
List which flags must survive a relaunch, then decide.
D) Defer this proposed change only
Memory now, add a TODO.

State: approved
Actual answer: A) Apply this change (Recommended), owner answer to D6, 2026-10-06.
Accepted scope: `agents/human/state.json`, written only by the app, keyed by request id: read at, notified at, withdrawn at, reminded at, nudged at, not sent. Written atomically like other hive files. An unreadable file falls back to every request read and already notified, so a bad file never causes repeat notifications.
History: the option text said "all read, nothing notified"; "nothing notified" would have notified everything again, contradicting the option's own "no repeat notifications", so the fallback is recorded as "already notified" (flagged to the owner).

### R7: Which "/" text counts as a command (reopens R3)
Finding: outside voice 8, P2, confidence 8/10, R3 accepted scope ("text starting with "/" ... goes straight to Michael's terminal") and src/shared/claudeCommands.ts:30 (`export const COMMAND_GROUPS: CmdGroup[] = [`, the existing list of Claude Code commands with `kind: 'slash'`); reviewer: Claude Plan subagent.
Plan baseline: R3 approved (owner answer to D3): any text starting with "/" goes to the terminal, untracked.
Runtime evidence: an owner pasting a path, "/Users/vk/Downloads/invoice.pdf is wrong", would send it untracked to Michael's terminal, with no reply in the dock. Reason to reopen: new evidence of a misroute, not a change of mind.
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| R3 commands rule | any text starting with "/" | only when the first word is a slash command in the app's existing command list (`claudeCommands.ts`, and the matching list for other engines); anything else, paths included, becomes a request | as R3 | check a month of composer messages for "/" text that is not a command | keep R3's rule, TODO |
| R3 attachments, cancel | approved | same | same | same | same |
| R8 notes fallback | pending | pending | pending | pending | pending |
Question D7:
D7. Which messages starting with "/" should go straight to Michael's terminal? <gstack-qid:plan-eng-review-command-rule>
Project: michael-replies.md, engineering review (main branch, nothing built).
ELI10: You chose that commands like /clear keep going straight to Michael's terminal. But "starts with /" also catches a pasted file path, like "/Users/you/Downloads/invoice.pdf is wrong", which would then skip the dock and never get a reply there. The app already keeps a list of the real commands.
Stakes if we pick wrong: a question that happens to start with a path silently gets no tracked answer.
Recommendation: A, because only real commands bypass the dock, using the command list the app already maintains (explicit over clever).
Note: options differ in kind, not coverage, so no completeness score.
Pros / cons:
A) Apply: only known commands
  ✅ /clear, /compact and the rest still go straight through; a pasted path becomes a normal tracked question.
  ✅ Reuses the existing command list, so no new rule to maintain. (human: ~1 hour / CC: ~5 min)
  ❌ A brand new command not yet in the list becomes a request until the list is updated.
B) Keep: anything starting with "/"
  ✅ Every command works, listed or not.
  ❌ Pasted paths skip the dock and get no answer there.
C) Investigate first
  ✅ Shows how often you actually start a message with a path.
  ❌ The build waits on it.
D) Defer to a TODO
  ✅ Ships with the simple rule.
  ❌ Path questions misroute until then.
Net: precise routing from the existing list versus catching every possible command.
Header: Commands
Options:
A) Apply this change (Recommended)
Only a first word in the app's command list goes to the terminal; paths and other text become requests.
B) Keep this row's current value
Any text starting with "/" goes to the terminal, as approved in D3.
C) Investigate before choosing
Check a month of composer text starting with "/", then decide.
D) Defer this proposed change only
Keep D3's rule now and add a TODO.

State: approved
Actual answer: A) Apply this change (Recommended), owner answer to D7, 2026-10-06.
Accepted scope: R3's command rule becomes: text whose first word is a slash command in the app's existing command list (`src/shared/claudeCommands.ts` entries of `kind: 'slash'`, and the matching list for Michael's engine) goes straight to his terminal, untracked; every other text, pasted paths included, becomes a request. Added acceptance assertion: "/Users/x/invoice.pdf is wrong" creates a request; "/compact" and "/clear" go to the terminal.
History: R3 approved D3 "text starting with /" (2026-10-06); reopened for the pasted path case.

### R8: When "From Michael's notes" appears (reopens decision 9A)
Finding: outside voice 6, P2, confidence 7/10, plan decision 9A ("When Michael's turn ends after an owner request with no reply to it, the dock shows his last terminal text") and Section 2's mechanism (notes filed in his `outbox/.sent` with `from_notes: true`); reviewer: Claude Plan subagent.
Plan baseline: decision 9A, approved in the design review: any turn that ends after the request was taken, with no reply, shows his last text once.
Runtime evidence: Michael's normal pattern for an owner question is to delegate (write a request to a teammate) and end the turn with a line of internal prose; under 9A that prose would reach the owner for most requests, with a reminder each time. Agents can also write `.sent` files directly, so a `from_notes` flag in Michael's own folder is not trustworthy on its own. Reason to reopen: new evidence about Michael's turn pattern.
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| 9A notes trigger | any turn ending with no reply after the request was taken | only a turn that ended with no message at all about the request (no reply and no message to any teammate written that turn); the app records each notes id in `agents/human/state.json` (R5), and the dock shows a notes bubble only if its id is there | as 9A | read a week of Michael's turns after owner questions, then decide | keep 9A now, TODO |
| R5 flags | approved D6 | same | same | same | same |
Question D8:
D8. When should the dock show "From Michael's notes"? <gstack-qid:plan-eng-review-notes-trigger>
Project: michael-replies.md, engineering review (main branch, nothing built).
ELI10: You chose that if Michael answers only in his terminal, the dock shows those words, muted. But Michael's usual move with your question is to pass it to someone (say Oscar) and end with a note to himself. Under the current rule, that private note would show up in your dock almost every time, and he'd get a reminder each time.
Stakes if we pick wrong: your dock fills with Michael's internal notes, or a real terminal only answer is missed.
Recommendation: A, because the fallback then catches only the case it was meant for: he wrote an answer in his terminal and sent nothing anywhere (subtraction; only what's real).
Note: options differ in kind, not coverage, so no completeness score.
Pros / cons:
A) Apply: only when he sent nothing at all
  ✅ A turn where he delegated or replied never shows notes; a turn where he only wrote in his terminal still does.
  ✅ The app records which notes it filed, so a note an agent wrote itself never shows. (human: ~2 hours / CC: ~10 min)
  ❌ If he delegates and also writes the real answer in his terminal, you wait for his proper reply.
B) Keep 9A as decided
  ✅ You see something after every turn that touched your question.
  ❌ Mostly his internal notes, plus a reminder to him each time.
C) Investigate first
  ✅ Measures his real turn pattern before changing the rule.
  ❌ The build waits on it.
D) Defer to a TODO
  ✅ Ships the rest without the fallback rule settled.
  ❌ Either the noisy rule ships, or no fallback at all.
Net: notes only when they're the answer versus notes after every turn.
Header: Notes
Options:
A) Apply this change (Recommended)
Notes only when his turn sent no message about the request; the app records the notes it files, others never show.
B) Keep this row's current value
Any turn that ends without a reply shows his last text once.
C) Investigate before choosing
Read a week of his turns after owner questions, then decide.
D) Defer this proposed change only
Keep 9A now and add a TODO.

State: approved
Actual answer: A) Apply this change (Recommended), owner answer to D8, 2026-10-06.
Accepted scope: decision 9A's trigger becomes: after the request was taken, a Michael turn that ends with no message at all about it (no reply to the owner and no message written to any teammate during that turn) files his last terminal text once as notes. The app records each notes id in `agents/human/state.json` (R5); the dock shows a notes bubble only for a recorded id, so a `from_notes` file an agent wrote itself never shows.
History: decision 9A approved in the design review (2026-10-06); reopened for the delegation turn pattern.

Approval readiness: PASS. R1 (D1 owner answer), R2 (D2 A), R3 (D3 A, amended by R7), R4 (D4 A), R5 (D6 A), R6 (D5 A), R7 (D7 A), R8 (D8 A); required work cites its approved decision (Sections 1 to 4, outside voice 1, 5, 7, 9).

### Failure modes

| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| Composer to queue | Michael's terminal is dead; the work order fails `MAX_SEND_ATTEMPTS` | queue drop, state.json "not sent" | "Not sent" with Try again |
| Typed to Michael | He reads it but never replies | open requests context, late sweep, reminder | amber "Later than he said", Nudge |
| Reply | No `in_reply_to` | R2 system note | answer after his resend |
| Reply | Holding reply mistaken for closure | closure only on done or refuse | status stays open |
| Notes fallback | Fires on a delegation turn | R8 trigger | nothing extra |
| Reader | `state.json` corrupt | fallback all read and notified | no repeats |
| Reader | Owner sent mail deleted by an agent | the copy filed in Michael's `inbox/.done` when typed (R6), verified by the dock answer key (R4) | the question as sent; residual risk if both copies go (the hive is agent writable, as for every hive file) |
| Closing time | New router branch skips the observer | observer on every path | closing completes |

No path has no test, no handling and a silent failure: 0 critical gaps.

### TODOS.md

No new TODOs proposed: every finding was approved into this plan. The 30 day window and reply
alias items (TODOS.md:947, 948) close with T2 and are struck in T9.

### Engineering completion summary

- Step 0: Scope Challenge — scope accepted as-is (no cuts; smaller arrangement under the owner's arrangement rule)
- Architecture Review: 7 issues found
- Code Quality Review: 2 issues found
- Test Review: diagram produced, 17 gaps identified (all required proof)
- Performance Review: 0 issues found (1 withdrawn as a factual correction)
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: Claude Plan subagent, in host, completed (Codex not used, owner choice); 10 findings, 5 into choices R4 to R8, 4 required work, 1 correction
- Parallelization: 2 lanes, 1 parallel (renderer) / 1 sequential (main and shared)
- Lake Score: N/A (no option was scored 10/10); the recommended option was chosen on 2 of 3 answers scored for completeness (D1 chose the existing architecture)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 3 | clean (other plan, 2026-10-05) | 5 proposals, 5 accepted, 0 deferred |
| Outside Review | Claude Plan subagent, in host, during `/plan-eng-review` (Codex skipped by owner) | Independent 2nd opinion | 11 | skipped (Codex); in-host reviewer completed | 10 findings: 5 decided (R4 to R8), 4 required work, 1 correction |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 8 | issues_open (all mapped to approved work) | 26 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 12 | clean | score: 2/10 → 8/10, 22 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** plan-review phase: Codex skipped by the owner's choice (Codex is reserved for adversarial passes); an in-host Claude Plan subagent completed and its 10 findings were resolved. Design phase: in-host Claude subagent completed, Codex skipped. No external provider coverage.
- **VERDICT:** DESIGN CLEARED. ENG REVIEWED with every finding approved into the plan and 0 unresolved decisions; status issues_open records the mapped work, not open questions. Ready to implement T1 to T9 in the stated lanes.

NO UNRESOLVED DECISIONS
