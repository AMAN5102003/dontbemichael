# The office stops on an account problem, and says why

Owner, 2026-10-12: "while office was running using claude api key, the money ran
out so michael terminal posted 'credit balance too low. add funds: link'. This is
sort of a buried failure inside michael terminal with business user having
absolutely zero idea why office stopped working."

## What happens today

When Anthropic refuses a turn, Claude Code ends it with a StopFailure hook
whose `error` names the reason, and writes the same reason into the transcript.
In the installed Claude Code (2.1.296), the credit case reads exactly
`{content: "Credit balance is too low", error: "billing_error"}`. On this
machine's transcripts, these reasons stopped work:

| error | what Claude says | count here |
|---|---|---|
| `rate_limit` | You've hit your weekly limit, resets 5pm | 1,140 |
| `authentication_failed` | Login expired, please run /login | 157 |
| `billing_error` | Credit balance is too low | (API key only; none here) |

The app registers StopFailure with the `rate_limit` matcher only
(`hive.ts:1613`), and `hooks.ts:399` acts only on `rate_limit`. That reason
starts the office break (issue 124, `officeBreak.ts`). The owner sees it as a
card at the top of Needs you and a chip in the top bar, and nothing types into
a Claude terminal until the limit resets.

`billing_error` and `authentication_failed` reach nothing:

- Every Claude agent stops, because one key or one account serves the whole office.
- The reason sits in a terminal the owner never opens.
- Michael cannot relay it, because he is stopped too.

The checks in `spawnAgentCore` (installed, signed in, key stored) run only
before a team member starts.

## What changes

1. **Two more reasons start a stop.** StopFailure is registered for
   `rate_limit`, `billing_error` and `authentication_failed`, and `hooks.ts`
   hands each one to the office break with its reason. Other errors (server
   errors, a prompt too long) stay as they are: they affect one agent's turn,
   not the office.
2. **One office state, three reasons.** The office break keeps one state and
   gains a `reason`: `limit` (today), `credit` or `signin`. The break's rules
   today apply to all three: while any is on, nothing types into a Claude
   terminal, and schedules still run as configured, with their jobs waiting in
   the inboxes.
3. **The card says why and what to do.** It is the same card at the top of
   Needs you and the same chip, with words for the reason. How loud it is
   depends on the reason (owner, D2):
   - **limit** stays as today: amber card and chip, not counted. It ends on its own.
   - **credit** and **signin** are an owner to do: the card is a plain Ask me
     card (`card` ground, `line` ring, the soft two layer shadow, no side rule;
     owner D5, DESIGN.md §7.8), it counts as 1 in the Needs you button, and the
     chip is coral. The coral lives only on the count bubble, the Needs you
     button and the chip. Like any waiting ask, it opens the Needs you board
     and keeps the column open until it is done (DESIGN.md §7.6).
   - The card sits first in Needs you, above the asks: nothing else moves
     until it is done.
   - Every reason's card reads the same top to bottom: the title "The office
     stopped" (the plan limit keeps "The office is on a break"), one line of
     reason, then the action buttons. The explanation sits behind the info icon.

   The words for each reason:
   - **limit:** as today ("The office is on a break"; work starts again around 5 PM).
   - **credit:** "Your Anthropic account is out of credit." Primary button
     Add credit (with the opens outside mark) opens the Anthropic billing page;
     secondary button Try again.
   - **signin**, worded by how the office signs in (`claudeAuth`, owner D3):
     - Claude account: "Your Claude account needs you to sign in again." One
       button, Sign in, starts the existing Get Michael ready sign in.
     - API key: "The Anthropic API key stopped working." One button, Change
       key, opens the existing key form (`GetMichaelReady` keyFormRow).
4. **How it ends.** A limit ends as today: the reset time comes, then a check.
   Credit and signin have no reset time, so they end on the owner's step:
   - Try again (credit) or a finished sign in (signin) moves the break to
     checking, and the first finished Claude turn ends it, as today.
   - While waiting, the app checks again on its own every 15 minutes
     (RETRY_MS). An owner who adds credit on the website and never comes back
     still gets the office back.
5. **A desktop notification once**, from main, as the break sends today.
6. **States after the owner acts** (owner, D4):

   | State | When | What the card shows |
   |---|---|---|
   | Stopped | the stop starts | title, reason line, the reason's buttons |
   | Checking | Try again, a finished sign in or key change, or the 15 minute recheck | the buttons go; one line with a small spinner, "Checking that work can start", `role="status"` |
   | Still out | the check hits the same stop again | the reason line becomes "Still out of credit. Credit can take a few minutes to show." (credit) or the reason line again (signin), with the buttons back |
   | Done | a Claude turn finishes | the card leaves Needs you, the count drops, the chip goes; team members cut off mid turn are told to carry on |

## Behavior changes for agents

| Who | Today | Proposed | What the owner sees |
|---|---|---|---|
| Every Claude agent, on out of credit or an expired login | Keeps being nudged and given inbox mail. Each turn fails the same way, and nothing records why. | Nothing is typed into its terminal until the office is back. Mail and scheduled jobs wait in the inbox. | The stop card and chip, with the reason and one action |
| Team members cut off mid-turn | Left where they stopped | Told to carry on when the office is back, as for the plan limit today (the break's cutOff list) | Work resumes on its own |

Michael's rules and every agent prompt are unchanged. The app holds and resumes
delivery with the same mechanism the plan limit already uses.

## Decisions

Design review, 2026-10-12 (owner's answers):

- **D2, loudness:** credit and signin are a coral to do, counted in Needs you,
  with a coral chip. The plan limit stays the quiet amber break.
- **D3, the API key case:** `authentication_failed` reads by how the office
  signs in. An account office sees "sign in again" with Sign in. An API key
  office sees "the key stopped working" with Change key.
- **D4, after the owner acts:** the states are checking, still out and done (table above).
- **D5, card style:** a plain Ask me card with no side rule. The coral sits
  only on the count, the Needs you button and the chip.
- **D6:** DESIGN.md gets an "Office stops" section and a §18 row.
- **D7, Add credit:** the button carries the `external` icon (from the named
  links work) after the label, with a word joiner before it so it never wraps
  alone. Its spoken name is "Add credit, opens in your browser"
  (`markdown.opensInBrowser`, already in en, ar and zh-CN).
- **D8, credit link:** Add credit opens the Anthropic Console billing page in
  the browser. The exact address is checked at build. The app shows no amounts.

Open for the eng review:

- **Recheck (eng):** do credit and signin recheck on their own every 15 minutes
  (the break's RETRY_MS), or only when the owner presses the button?

## Journey

| Step | Owner does | Owner feels | Plan specifies |
|---|---|---|---|
| 1 | Is away when the credit runs out | (nothing) | One desktop notification: "The office stopped. Your Anthropic account is out of credit." |
| 2 | Opens the app | "Why is it quiet?" | The coral chip "Office stopped" and Needs you 1. The board opens on its own. |
| 3 | Reads the card | "Oh, it's money, and it's fixable" | One reason line and one primary button; the detail sits behind the info icon |
| 4 | Presses Add credit and pays on the website | In control | The billing page opens in the browser (D8) |
| 5 | Comes back and presses Try again | "Did it work?" | Checking, with a spinner line (D4) |
| 6a | Waits a minute | Relief | The card and chip go away, and the team carries on |
| 6b | The payment has not shown yet | Reassured, not alarmed | "Still out of credit. Credit can take a few minutes to show." with both buttons back |
| 7 | Pays but never comes back | (nothing) | The 15 minute recheck brings the office back (eng question above) |

Five seconds in: coral says "you", with one line and one button. Five minutes
in: each press gets an answer. Over months: stops that explain themselves keep
the office trusted.

## Accessibility and layout

- The card lives in the right column (340 to 520 px). Its buttons wrap to a
  second line rather than shrink, and every button is at least 28 px tall, as
  everywhere in the column.
- The reason line is `role="status"`, as the break card's is today, so a screen
  reader hears the stop and each later state. Focus never moves on its own
  (DESIGN.md §7.6): only the owner's click opens anything.
- Add credit has the spoken name "Add credit, opens in your browser" (D7).
  Change key and Sign in keep the focus inside the app.
- RTL: the info icon aligns to the end, and the external icon follows the
  label in reading order, as it does for named links.

## NOT in scope

- A warning before the credit runs out: Anthropic gives the CLI no balance.
- Server errors, overloads and prompts that are too long: they affect one turn,
  and Claude Code already retries them.
- Other engines (Codex and others): they report failures differently.
- A full date or the amount owed on the card: the app cannot see the balance (D8).
- Repeating the desktop notification while the stop lasts: once, as for the
  break. The coral chip and the count stay until the stop is done.

## What already exists

- `OfficeBreakNotice.tsx`: the break card (`OfficeBreakCard`) and the chip
  (`OfficeBreakChip`). The stop extends both with a reason.
- `officeBreak.ts`: the state (waiting, checking, cutOff, prompted, RETRY_MS).
  `hooks.ts:398`: the StopFailure handler. `hive.ts:1613`: the hook registration.
- `GetMichaelReady.tsx`: the sign in flow and the key form (`keyFormRow`),
  reused by Sign in and Change key. `EngineSetupCard.tsx`: the setup card.
- The named links work on this branch: the `external` icon and
  `markdown.opensInBrowser` in three languages.
- DESIGN.md §7.6 (the Needs you board and column), §7.7 (buttons), §7.8 (the
  Ask me card look) and §3 (coral is the owner's to dos, amber is waiting).

## Tests (plan)

- **hooks:** a StopFailure with `billing_error` or `authentication_failed`
  starts the break with that reason; a `server_error` does not.
- **officeBreak:** a credit or signin break has no reset time, checks again
  every RETRY_MS, moves to checking on the owner's step, and ends on a finished
  turn.
- **settings:** the StopFailure hook is registered for all three reasons.
- **card:** the words and the action for each reason (source assertions; there
  is no render harness).

## Implementation Tasks

Synthesized from this design review. Each task comes from a decision above.

- [ ] **T1 (P1, human: ~3h / CC: ~20min)**: break state: a `reason` (limit, credit or signin), and StopFailure for the three errors
  - Surfaced by: What changes 1, 2 and 4
  - Files: `src/main/officeBreak.ts`, `src/main/hooks.ts`, `src/main/hive.ts`, `src/shared/officeBreak.ts`
  - Verify: the hooks and officeBreak tests in Tests (plan)
- [ ] **T2 (P1, human: ~3h / CC: ~20min)**: the stop card and chip for each reason, coral and counted for credit and signin (D2, D5)
  - Surfaced by: Pass 1 (D2) and Pass 4 (D5)
  - Files: `src/renderer/src/components/OfficeBreakNotice.tsx`, the Needs you count (`useNeedsYou.ts`), `AskMeTab.tsx`, `TopBar.tsx`
  - Verify: card source assertions; the count includes a credit or signin stop and not a limit
- [ ] **T3 (P1, human: ~2h / CC: ~15min)**: the actions: Add credit (D7, D8), Try again, Sign in and Change key (D3), and the states after acting (D4)
  - Surfaced by: Pass 2 (D3, D4), Pass 6 (D7) and Pass 7 (D8)
  - Files: `OfficeBreakNotice.tsx`, `GetMichaelReady.tsx` (open the key form or the sign in), the IPC to move the break to checking
  - Verify: tests for checking, still out and done; Add credit's spoken name
- [ ] **T4 (P1, human: ~1h / CC: ~10min)**: copy in en, ar and zh-CN, with no dashes, explanations behind the info icon
  - Surfaced by: What changes 3 and 6
  - Files: `src/renderer/src/i18n/locales/{en,ar,zh-CN}.json` (`officeBreak.*`)
  - Verify: the i18n parity test; the no-dash copy test
- [ ] **T5 (P2, human: ~1h / CC: ~10min)**: DESIGN.md "Office stops" section and a §18 row (D6)
  - Surfaced by: Pass 5 (D6)
  - Files: `branding/DESIGN.md`
  - Verify: read back against the shipped card

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|----------------|-------------|-----------|-------|
| Office stopped card and chip | /Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/designs/office-stopped-20261012/mockup.html | Direction B (coral, counted) for credit and signin; the limit stays amber | HTML and CSS with the app tokens (owner's rule); the card is plain with no side rule (D5) |

## Design review summary (2026-10-12)

| Pass | Before | After | Notes |
|---|---|---|---|
| Step 0 | 5 | | Gaps: loudness, the API key case, after Try again, DESIGN.md |
| 1 Information architecture | 6 | 9 | D2: coral and counted for credit and signin, first in Needs you |
| 2 States | 4 | 9 | D3 (two sign in wordings), D4 (checking, still out, done) |
| 3 Journey | 6 | 9 | Storyboard above; the 15 minute recheck is open for eng |
| 4 AI slop | 6 | 9 | App UI. The side rule from the mockup was removed (D5). No hard rejections. |
| 5 Design system | 5 | 9 | D6: DESIGN.md section planned (T5) |
| 6 Responsive and a11y | 7 | 9 | D7: Add credit's spoken name; role status; focus never moves |
| 7 Decisions | | | 7 resolved (D2 to D8); 1 left for the eng review (recheck) |

Overall (lowest pass): 4/10 → 9/10. Outside voices: skipped by the owner's rule
(Codex is for adversarial passes only, with no Claude subagent in its place).
TODOS.md: none.

## Eng review (2026-10-12)

Target: this plan (docs/designs/office-stopped-account.md). Reviewer: Claude (plan-eng-review).

Scope record: feature answers: none proposed; structure: A, Original arrangement (eng D1);
accepted scope: extend OfficeBreak with a reason, about 14 files (officeBreak.ts,
shared/officeBreak.ts, hooks.ts, hive.ts, index.ts, preload, OfficeBreakNotice.tsx,
useNeedsYou.ts, GetMichaelReady.tsx, 3 locales, DESIGN.md, 2 tests), no new classes;
pending remedies: R1 to R4 below. Scope Challenge: scope accepted as-is.

### Premises

| Premise | Receipt | Verdict |
|---|---|---|
| StopFailure fires on any API error and matches on `error` | Claude Code 2.1.296 binary: "Fires instead of Stop when an API error (rate limit, auth failure, etc.) ended the turn"; matchQuery `case"StopFailure":return e.error` | true |
| Out of credit is `billing_error` | binary: `if(F4(e))return Is({content:Ukn,error:"billing_error"})`, `Ukn="Credit balance is too low"` | true |
| The app registers StopFailure for `rate_limit` only | `hive.ts:1613` `StopFailure: [entry('rate_limit')]`; `hooks.ts:399` `p.error === 'rate_limit'` | true |
| Delivery is held per engine by the break view | `shared/officeBreak.ts` `heldByBreak(view, provider)` | true |
| The Get Michael ready card already counts in Needs you | `useNeedsYou.ts:102` `if (merged.engineSetup?.applies && merged.engineSetup.needed) ... count + 1` | true |

unverified=0.

### Findings carried as required work (no question: they implement approved behavior)

- [P1] (confidence: 9/10) `officeBreak.ts` `limitReached`: `const until = this.lastReset !== null && this.lastReset > now ? this.lastReset : null;` and `noteRateLimits` sets `until` while waiting. A credit or signin stop would borrow a plan reset time and show "work starts again around 5 PM". Required by "credit and signin have no reset time" (What changes 4): reset times apply to reason `limit` only.
- [P1] (confidence: 9/10) `shared/officeBreak.ts` `export interface OfficeBreakView { until: number | null; checking: boolean; }`: no reason and no "still out" flag. Required by D2 and D4: the view carries `reason` and `again` (a check hit the same stop).
- [P1] (confidence: 8/10) No path moves a stop to checking when the owner acts. Required by D4: Try again (new IPC `office:retry`), a finished sign in and a saved key each call one `officeBreak.ownerRetry()`.
- [P2] (confidence: 8/10) A break saved by an older build has no reason. It loads as `limit` (`officeBreak.ts` state getter), with a test.

### Binding decision B1 (owner, 2026-10-12, in answer to eng D2)

"so i tried something on that machine where i noticed this issue. i added some money
to the api and nothing changed in the office as probably there was no event. however,
when michael ran his next office hour, he and the entire office resumed automatically.
So, a session restart or office restart was not required. i want to ensure we do not
force restart or relogin etc. if that is not needed to resume"

What this fixes in the plan:
- Resuming is always "send the next message": Try again, the recheck, a finished sign
  in. Nothing restarts a terminal, and nothing asks for a sign in, unless the cause needs it.
- Adding credit gives no signal (owner's live test). The office learns only by trying a
  turn, so the automatic recheck is the only path back for an owner who pays and walks away.
- The one restart that is needed: a changed API key. Running team members got the old
  key in their environment at start (`index.ts:725` `return key ? { ANTHROPIC_API_KEY: key } : {};`),
  so only Change key restarts the Claude terminals (resumed, `--resume`), and only after the new key is saved.
- An expired account login is fixed by signing in. Claude Code reads the stored login,
  so running terminals continue on the next message with no restart.
  (Unverified live; T3 checks it, and falls back to the key path's restart only if a
  turn still fails after sign in.)

## Decision ledger

### R1: what the break says to Michael, cut off members and the owner, per reason
Finding: 1, P1, confidence 9/10, `index.ts:1831-1885`, Claude. Every message is plan limit words: owner toast "Your Claude plan reached its limit", Michael's check message subject "Usage limit reset", the carry on message "The Claude plan's usage limit has reset", the end toast "The break is over".
Plan baseline: not covered by the plan (it names only the card words and one notification).
Runtime evidence: `index.ts:1833`, `:1858`, `:1876` read as above (static read).
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R1 message words | plan limit words for every reason | words per reason (credit, signin by account or key, limit unchanged) | one neutral set for every reason ("the office is back") |
| R2 to R4 | pending | pending | pending |

Question D2: R1, what the break tells Michael, cut off members and the owner, per reason. Recommendation A.
Header: Break words
Options:
A) Words per reason (recommended): owner toast, Michael's check message and the carry on message say credit, sign in or key; the limit text stays as today.
B) One neutral set: "The office stopped" and "The office is back" for every reason, the limit text included.

State: approved
Actual answer: A, Words per reason (eng D3)
Accepted scope: the start and end owner notes, Michael's check message and the carry on message take words per reason (credit, signin by account, signin by key); the limit text stays as today. The instruction to agents is unchanged: carry on with what was waiting, do not repeat finished work. Owner notes in en, ar and zh-CN.
History: first sending (eng D2) was answered with new evidence instead of a choice (see B1); asked again as eng D3.

### R2: does a credit or signin stop recheck on its own, and how often
Finding: 2, P1, confidence 9/10, `officeBreak.ts` `export const RETRY_MS = 15 * 60_000;`, Claude. The open eng question from the design review; B1 shows adding credit sends no signal.
Plan baseline: What changes 4 proposes a 15 minute recheck (RETRY_MS); left open for eng.
Runtime evidence: owner's live test (B1): after paying, nothing changed until the next scheduled message to Michael, which resumed the office.
Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| R2 automatic recheck | open | every 15 min (RETRY_MS), credit and account signin; key stops wait for Change key | every 5 min, same reasons | none; only Try again, a sign in or a key change |
| R1 | approved (eng D3) | unchanged | unchanged | unchanged |
| R3, R4 | pending | pending | pending | pending |

Question D4: R2, automatic recheck. Recommendation A.
Header: Recheck
Options:
A) Every 15 minutes (recommended): reuse RETRY_MS; credit and account signin recheck by sending Michael the next message; a key stop waits for Change key.
B) Every 5 minutes: same as A with a shorter wait.
C) Owner only: no automatic recheck.

State: approved
Actual answer: A, Every 15 minutes (eng D4)
Accepted scope: credit and account signin stops recheck every RETRY_MS (15 min) by moving to checking, which sends Michael the next message (no restart, B1); a key stop waits for Change key; a recheck that hits the same stop sets `again` (still out).
History: none

### R3: one card, not two, when a signin stop and the Get Michael ready card both apply
Finding: 3, P2, confidence 7/10, `useNeedsYou.ts:102` `if (merged.engineSetup?.applies && merged.engineSetup.needed) feed = { ...feed, count: feed.count + 1 };`, Claude. After a login expires, `claude auth status` can also read signed out, so the Get Michael ready card ("can't start yet") shows and counts beside the signin stop card: two cards and a count of 2 for one problem. Medium confidence: whether auth status flips on expiry is not verified live.
Plan baseline: not covered.
Runtime evidence: static read of the count; auth status behavior on expiry unknown.
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R3 two sign in cards | both may show, count 2 | while a signin stop is on, the Get Michael ready card is not shown in Needs you and not counted; the stop card's button runs its sign in or key form | keep both cards |
| R1, R2 | approved | unchanged | unchanged |
| R4 | pending | pending | pending |

Question D5: R3, one sign in card. Recommendation A.
Header: One card
Options:
A) The stop card wins (recommended): while a signin stop is on, the Get Michael ready card is hidden from Needs you and not counted.
B) Keep both: both cards show and both count.

State: approved
Actual answer: A, The stop card wins (eng D5)
Accepted scope: while a signin stop is on, the Get Michael ready card is not shown in Needs you and not counted (`useNeedsYou.ts`, `AskMeTab.tsx`); the stop card's Sign in or Change key runs the same flow; the setup card is unchanged otherwise.
History: none

### R4: which reason shows when a second one arrives during a stop
Finding: 4, P2, confidence 7/10, `officeBreak.ts` `limitReached` keeps one state (`const prev = this.state;` ... `this.set({ ...prev, phase: 'waiting', ...`), Claude. With one state and a reason, a second cause can arrive mid stop: a plan limit during a credit stop, or an expired login during a plan limit break (an owner can switch from account to key mid break). The plan does not say which reason the card shows.
Plan baseline: not covered.
Runtime evidence: static read; one state, last writer wins today.
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R4 reason precedence | undefined | an owner action reason (credit, signin) replaces limit; a limit arriving during credit or signin leaves it | the latest reason always replaces the earlier one |
| R1 to R3 | approved | unchanged | unchanged |

Question D6: R4, reason precedence. Recommendation A.
Header: Precedence
Options:
A) Owner action first (recommended): credit or signin replaces a limit break; a limit during a credit or signin stop leaves it as is.
B) Latest wins: whichever reason arrived last is shown.

State: approved
Actual answer: A, Owner action first (eng D6)
Accepted scope: in `OfficeBreak`, a credit or signin stop replaces a limit break (reason, until null, due by RETRY_MS); a limit arriving during a credit or signin stop keeps the reason and only adds the agent to cutOff; tests for both orders.
History: none

Approval readiness: PASS. R1 (eng D3), R2 (eng D4), R3 (eng D5), R4 (eng D6); B1 is the owner's binding rule.
The required findings above carry approved design behavior (design D2, D4, D8; plan What changes 4).

### Sections

- **1 Architecture:** R1 and R4, plus the four required findings above. Flow below.
- **2 Code quality:** no new decisions. Required: Add credit opens a fixed billing address held in main (a new `office:addCredit` IPC with no URL argument), never an address from the renderer, following the `update:openRelease` allowlist. The reason words live in one table per language, not scattered `if`s.
- **3 Tests:** diagram and plan below; the regression contract carries forward the approved "limit stays as today" (design D2, eng D3): every existing test in `test/office-break.test.cjs` passes unchanged.
- **4 Performance:** no issues. One hook event per failed turn and one 15 minute timer.

```
StopFailure(error) ──hooks.ts──▶ PlanSignal{kind:'limit'|'credit'|'signin'}
        │ (matcher "rate_limit|billing_error|authentication_failed", hive.ts)
        ▼
OfficeBreak.stop(reason, agent)          precedence R4: credit/signin > limit
  waiting ──(15 min RETRY_MS, R2)──▶ checking ──turn finished──▶ over: carry on (R1 words)
     ▲  │                               │
     │  └─ owner: Try again / sign in ──┘  (key: Change key saves, then resume restart, B1)
     └──── same stop again (again=true, "still out") ◀─┘
view {until, checking, reason, again} ──office:break──▶ OfficeBreakCard / Chip
  reason credit|signin: coral, counted (useNeedsYou), hides the Get Michael ready card (R3)
  delivery hold unchanged: heldByBreak(view, provider)
```

### Test coverage

```
CODE PATHS                                              USER FLOWS
[+] src/main/hooks.ts StopFailure                        [+] Out of credit
  ├── [★★★ TESTED] rate_limit → limit (office-break:182)    ├── [GAP] stop card, Add credit, Try again, back
  ├── [GAP] billing_error → credit                         ├── [GAP] pay and walk away: 15 min recheck
  ├── [GAP] authentication_failed → signin                 └── [GAP] still out after Try again
  └── [GAP] server_error → nothing                       [+] Login expired (account)
[+] src/main/officeBreak.ts                                ├── [GAP] one card, count 1 (R3)
  ├── [★★★ TESTED] limit wait, check, end (:62,:134)        └── [GAP] sign in → checking, no restart (B1)
  ├── [GAP] credit/signin: no reset time, RETRY_MS       [+] Key stopped working
  ├── [GAP] ownerRetry → checking                          └── [GAP] Change key → resume restart only then
  ├── [GAP] again flag on a repeated stop
  ├── [GAP] precedence both orders (R4)
  └── [GAP] old saved break loads as limit
[+] src/main/hive.ts settings
  └── [GAP] StopFailure registered for three errors
[+] index.ts messages
  └── [GAP] words per reason (R1), agent instruction unchanged
COVERAGE: 2/17 paths (12%) today; the plan adds the 15 missing.
```

Planned tests (extend `test/office-break.test.cjs`, the file's own style; the card by source assertions, there is no render harness):
- hooks: billing_error and authentication_failed become stops with their reason; server_error does not. Value: protects=the three causes reach the break; fails_when=the matcher or the hooks.ts check stays rate_limit only; why_new=only rate_limit is tested; seam=none; no_claim=Claude Code firing the hook live
- officeBreak: credit and signin take no reset time even with a status line reading, recheck at RETRY_MS, ownerRetry moves to checking, a repeated stop sets again, an old saved state loads as limit. Value: protects=the stop ends only when the account works and never shows a plan reset time; fails_when=lastReset leaks into a credit stop or again is never set; why_new=new states; seam=injected clock (existing); no_claim=none beyond protects
- precedence: credit replaces limit; limit during credit keeps credit and adds to cutOff. Value: protects=R4; fails_when=last writer wins; why_new=new rule; seam=none; no_claim=none beyond protects
- settings: the StopFailure matcher names the three errors. Value: protects=registration; fails_when=a reason is dropped from the matcher; why_new=new; seam=none; no_claim=Claude Code regex matching (checked in the binary, not live)
- messages and card: words per reason in en, ar, zh-CN; the stop counts in Needs you and hides the setup card for signin; Add credit has its spoken name and opens through main. Value: protects=R1, R3, design D2 and D7; fails_when=a reason falls back to limit words or the count is 2; why_new=new; seam=none; no_claim=pixel layout
- Live check before ship (T3): an expired account login resumes on the next message after sign in with no restart (B1); if not, signin uses the key path's resume restart.
Tests to retire: none.

### Failure modes

| Path | Realistic failure | Covered | Owner sees |
|---|---|---|---|
| StopFailure matcher | Claude Code ignores the `\|` form | settings test plus the T3 live check | without the fix, the silent stop of today |
| Recheck | Michael's check turn is lost (window closed) | CHECK_TIMEOUT_MS ends a check that hears nothing (existing) | the card returns at the next stop |
| Change key | the restart fails | existing respawnResumed error path | the key form shows the error |
| Old saved break | no reason field | loads as limit (test) | the amber break, as before |

Critical gaps: 0.

### What already exists (eng)

`OfficeBreak` state and timer, `heldByBreak`, `onPlanSignal` and `endOfficeBreak` (`index.ts:1818-1885`), `ownerToast`, the Needs you count (`useNeedsYou.ts:102`), `GetMichaelReady` sign in and key form, `respawnResumed` (`useHive.ts:454`) for the key restart, and `test/office-break.test.cjs`.

### NOT in scope (eng)

- The backup engine during a break (TODOS.md): it would apply to all three reasons once built; unchanged here.
- Restarting terminals for credit or an account login: not needed (B1).

Parallelization: sequential implementation, no parallelization opportunity (one module chain: officeBreak, then hooks and index, then the card).

Outside voice: skipped by the owner's rule (Codex is used only for adversarial passes, never a Claude subagent in its place).

### Implementation tasks (after eng review)

T1 to T5 above stand, with these changes:
- T1 adds the `again` flag, `ownerRetry()`, the R4 precedence, no reset time for credit and signin, and an old state loading as `limit`.
- T2 adds R3: while a signin stop is on, the setup card is hidden and not counted.
- T3 adds the `office:retry` and `office:addCredit` IPCs (a fixed address in main), and B1: after Change key, restart the Claude terminals resumed. It also adds the live check of an account sign in resuming with no restart.
- **T6 (P1, human: ~1h / CC: ~10min)**: R1 words per reason for the owner notes, Michael's check message and the carry on message (`index.ts`), with the agent instruction unchanged.
  - Verify: the message tests above.

### Eng completion summary

- Step 0: scope accepted as-is (structure A, eng D1)
- Premises: 5, unverified 0
- Architecture: 2 decisions (R1, R4) and 4 required findings
- Code quality: 0 new decisions; 1 required security note
- Tests: diagram produced, 15 gaps, all planned
- Performance: 0 issues
- Failure modes: 0 critical gaps
- Unresolved decisions: 0
- Outside voice: skipped (owner rule)
- Parallelization: sequential
- Lake Score: 2/2 (R1 and R2 scored for completeness, the 10/10 option picked)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | | |
| Outside Review | none | Independent 2nd opinion | 0 | skipped | Codex is for adversarial passes only (owner, 2026-10-01) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (mapped work) | 24 issues (8 architecture, 1 code quality, 15 test gaps), 0 critical gaps; all decided or planned |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score: 4/10 → 9/10, 7 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | | |

- **OUTSIDE COVERAGE:** design and eng outside voices skipped by the owner's rule; no outside coverage.
- **VERDICT:** DESIGN CLEARED. ENG REVIEWED: every finding is decided (R1 to R4, B1) or planned as a task; ready to implement.

NO UNRESOLVED DECISIONS
