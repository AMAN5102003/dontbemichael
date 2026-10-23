# Hire a team member, redesigned for business owners

> 2026-10-23: the job is described once on the Role step ("What will Jordan do?") and a
> picked job shows read only with "Anything to change?"; Suggest me and the typed Work style are
> gone. See `docs/designs/work-style-change-request.md`.

Status: in CEO review (2026-09-27, /plan-ceo-review). Branch: fix/hidden-claude-own-transcript.

## Request (owner, 2026-09-27)

"add new agent feature is very confusing and not well thought off in the original repo.
Considering the simplications and changes done to focus everything on business users, this
feature needs to be redeisgned. picking identity section looks great now after the changes.
Rest of the sections are either confusing or does not make sense."

1. Pick an existing character and it inherits their role, job description etc. Hiring Erin
   is pretty much a clone of Pam to start with. Or invent a whole new job and work style for
   a character in the same wizard (Jim as social media manager who only follows the company
   Instagram feed).
2. Every hire needs a work folder. Suggest a new folder with the character's name as a suffix
   so it does not clash: with Pam there is already an Admin folder, so Erin gets admin_erin.
3. The new hire shows the role, work style etc. with a chance to tweak them.
4. Templates show every out of the box role plus work style across all the businesses, so
   nobody types the same thing again.

## What exists today (audit)

`src/renderer/src/components/AddAgentModal.tsx` (1278 lines), four sidebar sections:

| Section | What it holds | Business owner view |
|---|---|---|
| 1 Identity | Name, character tiles grouped by job (with each tile's job), colour | Good (owner). Keep. |
| 2 Workspace | Folder input + Pick, project chips, "add project" | Developer words. Folder defaults to `<Michael's folder>/<Role>`; same role shares a folder (owner, 2026-09-25). |
| 3 Engine | Provider chips (this build: Claude only), model chips, raw spawn command | Pure developer. Nothing to decide on a Claude only build. |
| 4 Briefing | Developer templates (Repo janitor, Docs writer, Bug triager, Research assistant, Release manager), Role, Role description, Work style | Templates are for coders; fields start blank, so a hire starts with no job and Michael cannot route to it. |

Hire path (`submit`): name, folder, command, `spawnPty` with `hive.role = "Role: description"`,
store `goal` (Work style). Nothing else is copied from anywhere.

Setup's team start (`useHive.ts startBusinessTeam`) already builds a full job from a pack card:
`teamMemberRole(def)` = `"<role>: <routing>"`, `teamMemberGoal(def, business)` = the pack's
`workStyle` with `{Business}`/`{City}` filled, folder = `folderNameFor(def)` under Michael's folder.

Packs (`resources/packs/*.json`, loaded by `packsList`): 36 cards over 6 files, 11 distinct roles:
Finance, Executive Admin, Customer Support, Sales Director, Marketing, Inventory & Shipping,
Supply Chain, Quality Control, HR Manager, IT Engineer, IT Security. Each business pack words
the same role for its own business (Marketing for a restaurant talks about daily specials).

Characters with no pack card anywhere: Jim, Stanley, Phyllis, Andy (Sales), Angela, Kevin
(Accounting), Erin (Admin). Their tile job (`addAgent.castRole`) points at a card family.

Facts that shape the design:
- A card's `routing` text names the character ("Pam sorts the business inbox..."). A copy for
  Erin must say Erin, or Michael reads Pam's name on Erin's card.
- Two teammates with the same routing text give Michael no way to choose between them.
- `ProfileTab` finds does / asks first by `agent.id` in the pack; a hire id is `erin-<time>`,
  so a hired Erin shows no does / asks first today.
- `folders:suggest` never checks whether a folder already exists.
- Mailbox (one per agent) and schedules are owner approved per agent; copying Pam's mailbox to
  Erin would have both work the same inbox.

## 0A Premise

Real problem: the owner cannot add a useful teammate after setup. The form asks developer
questions (engine, command, project folders) and hands over a blank job, so a new hire starts
idle and Michael cannot route work to it. The plan goes at the pain directly: the character
pick carries a real job, templates carry the rest, the owner only edits.

Do nothing: every hire after setup needs the owner to write a role and work style from
scratch; Erin lands in Pam's Admin folder and mixes files with her; Engine and command
remain one click from breaking a hire.

Premise checks:
- "Clone of Pam" has two possible sources: Pam as she is today in this office (owner edits
  included) or Pam's pack card for this business. Open: R2.
- Jim, Stanley, Phyllis, Andy, Angela, Kevin and Erin need a default card. Proposed: the card
  of their tile's job family (Sales Director, Finance, Executive Admin), from this business's
  pack first, then any pack. Carried in R2.
- A second person in the same job needs a different routing line, or Michael splits work at
  random. Candidate expansion E1.

## 0B Existing code to reuse

| Need | Reuse |
|---|---|
| Card list across businesses | `window.cth.packsList()` (packs + core) |
| Role line and work style from a card | `teamMemberRole`, `teamMemberGoal`, `fillBusiness` (`src/shared/teamPlan.ts`) |
| Folder name from a card | `folderNameFor` (teamPlan.ts), `folders:suggest` / `folders:ensure` (main) |
| Character to job family | `CAST_GROUPS` + `addAgent.castRole` (cast.ts, locales) |
| Stored role format | `joinAgentRole` / `splitAgentRole` |
| Spawn | `AddAgentModal.submit` body (spawnPty + addAgent) unchanged |
| Colour | `teamAccent(index)` (setup's order) |

New: a pure `src/shared/hireTemplates.ts` (card list, dedupe, character default, name swap,
folder suffix), a folder exists answer from main, and the new wizard body. No rebuild of the
spawn path.

## 0C Dream state

```
  CURRENT STATE                   THIS PLAN                          12-MONTH IDEAL
  4 sections, engine and          Pick a person: their job comes     Hire in one click from a face;
  command, blank job, dev   --->  with them. Or pick any template    jobs the owner wrote become
  templates, shared folders       from every business, edit, hire.   templates too; Office Packs
                                  Own folder per hire.               from the website add more.
```

Landscape (web, 2026-09-27): Sintra sells 12 pre-built role "helpers" you pick and start, with
little room to change them; Lindy starts from customizable templates; Relevance AI was judged too
technical before it did anything useful. This plan takes Sintra's pick and go default and Lindy's
editable template, and the character is the template picker, which none of them have.
Sources: lindy.ai/blog/sintra-ai-review, layer3labs.io/guides/ai-employee-platforms-compared,
gumloop.com/blog/relevance-ai-alternative.

## Decision ledger

| ID and owner | Contract and evidence | Current | Proposed | Status | Exact approval and scope |
|---|---|---|---|---|---|
| R1 wizard shape (owner) | Owner msg points 1 and 3; audit table | Who, Job, Review steps | | approved | D1 answer A (2026-09-27): three steps with Back/Next; Who = today's Identity tiles; Job preselects the character's job, lists all templates, or Write a new job; Review edits name, job, work style, folder, then Hire; colour auto |
| R2 clone source (owner) | Point 1 "clone of Pam"; Pam may be edited in this office | live teammate first | | approved | D2 answer A: a live teammate with that job (owner edits included, name swapped); else this business's pack card, then any pack's; mailbox and schedules not copied |
| R3 engine section (owner) | BUILD_ENGINES = claude only; buildFeatures SHOW_* pattern | Best / Fast chips on Review | | approved | D3 answer B (owner chose over recommended A): provider chips and command hidden behind SHOW_ENGINE_PICKER; Review shows Best (Settings default model) or Fast. Implementation: Fast = the Sonnet entry of the Claude model list; a card's modelTier preselects, else Best |
| R4 folder per hire (owner) | Point 2; reverses "same role shares a folder" (owner, 2026-09-25) | `<Michael>/<Role>`, shared | card folder; if taken, `<Folder>_<Name>` | approved | Owner msg point 2. Casing proposed: keep the folder's case, so `Admin_Erin` (owner wrote admin_erin); confirm at review |
| R5 templates (owner) | Point 4; 36 pack cards | 5 developer templates | every pack card, grouped by job, business named | approved | Owner msg point 4 |
| MODE (owner) | 0E | | SELECTIVE EXPANSION | approved | D4 answer A |
| E1 same-job note (owner) | two Admins, same routing text; Michael routes by it | none | replaced by S1 to S3 below | reopened | D5.1 owner answer: bigger problem; explore same role agents, peer delegation, when to involve Michael, ping pong, first |
| S1 same job policy (owner) | see section below | distinct job required | | approved | D6 owner answer: "option A but make a much more thorough check of existing agent profiles and only allow if the new hire job description is sufficiently distinct or particular such as bound to a specific mailbox or specific topic." Applied: overlap check against EVERY teammate's profile (any title), Hire allowed only when distinct or bound to a mailbox or topic |
| S2 peer handoff rule (owner) | router allows any to; instructions say report to Michael | only Michael assigns, enforced | | approved | D7 owner answer: "yes never break this promise. only michael should be the assigner. agent should feel free to check other agents without michael for extra info to do their job. if they still cant then they should tell michael to hand off" |
| S3 one agent per mailbox (owner) | CapabilitiesTab lists every mailbox; MailboxesSettings usersOf can list several | one holder per mailbox | | approved | D8 answer A |
| E2 Profile for clones (owner) | ProfileTab looks up cards by agent.id | source card saved on the hire | | approved | D5.2 answer A |
| E3 office jobs as templates (owner) | live team read already needed for R2 | Your office group first | | approved | D5.3 answer A |
| E4 open Capabilities after hire (owner) | mailbox and schedules not copied (R2) | new hire opens on Capabilities | | approved | D5.4 answer A |
| E5 hire through Michael (owner) | owner talks via Michael (design doc) | | | deferred | D5.5 answer B: TODOS.md |
| R6 review and tweak (owner) | Point 3 | fields blank | name, job title, what to send, work style, folder, all editable before Hire | approved | Owner msg point 3 |

## Answered: D1 (R1) = A, Who, Job, Review

## Previous comparison (R1)
Commitment comparison:

```
Commitment              | Source            | Current        | A 3 steps        | B keep sidebar   | C one page
Identity section as is  | owner "great"     | yes            | step 1, same     | same             | top of page
Job comes with character| point 1 approved  | no             | step 2 preset    | Briefing preset  | preset
Templates all packs     | R5 approved       | dev templates  | step 2           | Briefing         | inline list
Review before hire      | R6 approved       | none           | step 3 Review    | none (edit in 4) | whole page
Engine section          | R3 pending        | shown          | pending R3       | pending R3       | pending R3
Folder                  | R4 approved       | own section    | on Review        | Workspace        | on page
Colour picker           | pending here      | Identity       | auto, editable on Review | Identity | on page
```

Question: D1, R1: How should the hire wizard flow?
Header: Wizard
A) Who, Job, Review (recommended)
Three steps with Back and Next. Who is today's Identity tiles. Job preselects the character's own job and lists every template, or Write a new job. Review shows name, job, work style and folder, all editable, then Hire. Colour is picked for the owner.
B) Keep the sidebar sections
Keep the four section list but fill Briefing from the character and swap its developer templates for pack templates; hide Engine. Fewer changes, but there is still no single place to check the job before hiring.
C) One scrolling page
Character tiles, then job, then the editable fields and folder on one long page. No steps to click through, but on a 940 px dialog the job text sits far below the tiles and is easy to miss.

## Answered: D2 (R2) = A, Pam as she is today

## Previous comparison (R2)
Commitment comparison:

```
Commitment                        | Source          | Current | A live teammate first      | B always the pack card
Erin starts as Pam's job          | point 1         | no      | yes                        | yes
Owner's edits to Pam carry over   | pending         | n/a     | yes                        | no, pack text only
Character with no card (Jim, ...) | premise check   | blank   | family card from packs     | family card from packs
Name in routing line swapped      | audit fact      | n/a     | yes (Pam -> Erin)          | yes
Profile shows does / asks first   | audit fact      | no      | via source card id         | via source card id
Mailbox and schedules copied      | audit fact      | no      | no (set on Capabilities)   | no
```

Question: D2, R2: When the owner picks Erin, what does her job copy from?
Header: Clone from
A) Pam as she is today (recommended)
If Pam works in this office, Erin starts with Pam's current job title, routing line and work style, owner edits included, with Pam's name swapped for Erin's. If nobody in the office has that job, the pack card for this business is used, then any business's card.
B) The pack card, always
Erin always starts from the stock card for this business (then any business), even if Pam's text was edited in this office. Same result every time; owner edits to Pam have to be made again for Erin.

## Answered: D3 (R3) = B, Best / Fast chips

## Previous comparison (R3)
Commitment comparison:

```
Commitment               | Source              | Current | A hide Engine      | B keep model only
Provider chips           | BUILD_ENGINES=claude| shown   | hidden             | hidden
Model choice             | config.defaultModel | shown   | default model      | Best / Fast chips on Review
Raw command field        | developer           | shown   | hidden             | hidden
Flag                     | SHOW_* pattern      | none    | SHOW_ENGINE_PICKER | SHOW_ENGINE_PICKER
```

Question: D3, R3: What happens to the Engine section?
Header: Engine
A) Hide it (recommended)
Hide provider, model and command behind a SHOW_ENGINE_PICKER flag, like Git isolation. Every hire runs on the model set in Settings, the same way setup starts the team.
B) Keep a Best / Fast choice
Hide provider and command, but show two chips on Review: Best (default model) or Fast (cheaper model). Gives a cost lever per hire at the price of one more choice.

## Mode: SELECTIVE EXPANSION (D4 = A)

HOLD checks: about 12 files, one new pure module (`src/shared/hireTemplates.ts`). Three locale files and
tests are mechanical, so the core cannot get smaller without dropping one of the owner's four points. No
deferrals proposed. Invariant kept: a queued hire (deep link, `hireQueue`) still reviews and hires with the
import button hidden; it opens straight on Review, prefilled from the manifest.

## Expansion candidates (each asked separately)

| # | Proposal | Owner sees | Effort | Risk |
|---|---|---|---|---|
| E1 | Same-job note on Review | "Pam already does this job. Say what Erin handles so Michael knows who gets what." Hire still allowed | S | low |
| E2 | Profile for cloned hires | Erin's Profile shows what she does, asks first and connections, from the card she was copied from | S | low |
| E3 | Your office's jobs as templates | Templates list starts with "Your office": every teammate's current job, e.g. Jim, Social Media Manager | S | low |
| E4 | Open Capabilities after Hire | the new hire's panel opens on Capabilities, where mailbox and schedules are set | S | low |
| E5 | Hire through Michael | tell Michael "hire another admin" and he opens the wizard prefilled | L | medium |

## Same job, delegation and loops (owner question on E1, 2026-09-27)

Owner: "if everything is decided based on roles then no two agents can have the same role. ... why two
agents in the same role are even required? what will prevent a business owner to create more than one agent
with same role and end up a confused system wasting tokens and resources doing either duplicate work or
inconsistent delegation? also can agents directly assign work to each other without involving michael? if
yes how does an agent decide when to involve michael and when not? two agents in the same role may end up
just keep assigning work to each other as well with this."

### How it works today (code facts)

- Michael routes by each teammate's Role description, the routing line (`teamRoster()` in hive.ts sends him
  one line per teammate). The job title alone decides nothing; the line does.
- Nothing stops two teammates from having the same title AND the same line. Only names must be unique
  (hive.ts rename check, owner 2026-09-25).
- Every team member is told: Michael gives you work, report to Michael, questions for the owner go to
  Michael (`teamMemberInstructions`). Pack work styles say "Tell Michael where each belongs".
- The message format still allows `"to": "<team member id>"` and the router delivers it
  (`routeMessage`). So peers CAN hand each other work; only the instructions discourage it.
- Loop guards: `inform` and `done` are never answered; a message chain over 12 hops (`HOP_CAP`) is
  dropped and logged, and nobody is told; the circuit breaker catches an agent repeating itself.
- Every task card has one assignee (`tasks.json`), so one owner per task already exists on the board.
- Any mailbox can be picked by any number of agents (CapabilitiesTab lists all; Settings shows
  "used by" several names). Two agents on one inbox would each triage the same mail.

### Practical advice

1. Same title is fine, same territory is not. Two agents need different routing lines that split the
   work by something concrete: which mailbox, which channel, which customers, which location. "Admin for
   the CEO inbox" and "Admin for the support inbox" is a real split; two copies of Pam is not.
2. Why hire a second person in the same job at all: for a different territory, never for more hands. An
   AI teammate works around the clock and does not get tired, so volume is almost never the reason at
   small business scale; a second copy doubles the token cost of every scheduled run and splits the
   history each one learns from. The legitimate case matches the headline mailbox feature: one Admin
   watches the CEO inbox, another the support inbox.
3. What prevents duplicates: make the split part of hiring. When the chosen title matches a teammate's,
   Review asks one question, "What does Erin handle that Pam does not?", with ready answers from what is
   concrete (another mailbox, another channel, customers vs suppliers). The answer goes into Erin's
   routing line and adds "Not for <that>; that goes to Erin" to Pam's line, and both lines show on Review
   before Hire. Plus one agent per mailbox, so the inbox itself cannot be worked twice.
4. Who assigns work: only Michael. This is the supervisor pattern, the 2026 production default because
   every assignment passes one place you can see. Teammates may still ASK each other for a fact
   (`query`, answered by `inform`), because that does not move a job. A `request` (hand me this job) from
   one teammate to another is sent to Michael instead, who decides. The rule for an agent is simple:
   need a fact, ask the teammate; need someone to DO something, tell Michael.
5. Ping pong between two same-job agents then cannot start: neither can assign to the other, their lines
   do not overlap, and a runaway chain still hits the 12-hop drop, which should also tell Michael so it is
   not silent.

Web sources: supervisor is the production default, peer handoff is harder to debug
(digitalapplied.com/blog/multi-agent-orchestration-5-patterns-that-work, gurusup.com/blog/multi-agent-orchestration-guide);
failures cluster at handoffs (openlayer.com/blog/post/multi-agent-system-architecture-guide); one owner per
task and forward-only status stop duplicate work (mindstudio.ai/blog/coordinate-multiple-ai-agents-without-copy-paste).

## Answered: D6 = A with a thorough distinctness check; D7 = A, never broken; D8 = A

## Previous questions (S1, S2, S3)

D6, S1: Two people with the same job title? A) Allowed only with a written split, both routing lines updated (recommended). B) One person per job title, full stop. C) Allowed freely with a note (the original E1).
D7, S2: Can teammates hand each other work? A) Only Michael assigns: a teammate to teammate request goes to Michael; questions and answers stay direct; a 12-hop drop tells Michael (recommended). B) Leave it to instructions as today. C) Block every teammate to teammate message.
D8, S3: Can two agents watch one mailbox? A) One agent per mailbox: the picker shows who has it and moving it asks first (recommended). B) Allow sharing, label "used by Pam".

## The design (working plan, all approved rows applied)

### Step 1, Who
Today's Identity tiles unchanged: grouped by job, each tile names its job. Name follows the tile (existing
coupling). Colour picker removed; colour is `teamAccent(team size)`. Next is enabled once a name is set.
A name a teammate already has is refused here (the hive already refuses duplicate names on rename).

### Step 2, Job
Three groups, one list, a radio per entry:
1. **Their job** (preselected): the character's own job, resolved per R2: a live teammate with that job
   family (owner edits included), else this business's pack card, else any pack's card. Character to
   family: Pam, Erin -> Executive Admin; Dwight, Jim, Stanley, Phyllis, Andy -> Sales Director; Oscar,
   Angela, Kevin -> Finance; Kelly -> Customer Support; Ryan -> Marketing; Toby -> HR Manager; Nick -> IT
   Engineer; Sadiq -> IT Security; Creed -> Quality Control; Meredith -> Supply Chain; Darryl ->
   Inventory & Shipping.
2. **Your office** (E3): every live teammate's current job (Michael excluded), "Jim, Social Media Manager".
3. **All jobs** (R5): every pack card, grouped by job title, each variant labelled with its business
   ("Marketing, Restaurant & Food"). Identical texts across packs shown once.
4. **Write a new job**: blank title, job line and work style.
Each entry shows the title and its one-sentence summary; the full text appears on Review.

### Step 3, Review (R6, R3, R4, S1)
Editable: Name, Job title, What to send {name} (routing line), Work style, Folder, Model (Best / Fast).
- Text copied from someone else has their name swapped for the new name, whole word, in the routing line
  and work style ("Pam sorts the business inbox" -> "Erin sorts ...").
- Folder (R4): the card's folder name (else the job title) under Michael's folder. If that folder already
  exists on disk or a teammate works in it, suggest `<Folder>_<Name>` (`Admin_Erin`); if that exists too,
  `Admin_Erin_2`. Editable; Pick opens the folder chooser. Created on Hire only (foldersEnsure).
- Model (R3): Best = Settings default model; Fast = the Sonnet entry of the Claude list; a card's
  `modelTier` preselects, else Best. Provider chips and the command line are gone (SHOW_ENGINE_PICKER=false).
- **Distinct job check (S1)**: when Review opens and whenever the job title or routing line changes
  (debounced), the app checks the new job against every teammate's profile (title, routing line, work
  style summary, mailbox), any title. Two layers:
  1. Rules, instant: same title, or routing lines nearly identical (normalised word overlap), is an overlap.
  2. A hidden Claude check (Haiku, `runHiddenClaude`, own session id, 60 s timeout) reads the new job and
     every teammate's job and answers JSON: `{ distinct: bool, overlapsWith: [names], why: "...",
     suggestion: "..." }`.
  Result on screen: "Checking against your team..." then either "Distinct from everyone" or a box:
  "This overlaps with Pam: both sort the business inbox." with ways to make it particular:
  **Bind to a mailbox** (pick one no teammate holds, per S3; it is set on Capabilities at hire),
  **Bind to a topic** (one line, at most 120 characters and not empty, e.g. "catering enquiries only"), or edit the text. The binding goes into
  the new hire's routing line and adds "Not for <that>; that goes to <Name>." to each overlapping
  teammate's line, shown on Review before Hire. Hire stays disabled while an overlap stands.
  If the AI check fails or times out, the rules layer decides and a line says the full check could not
  run; a same-title hire then still needs a mailbox or topic binding.
- Closing the wizard drops its progress; nothing is saved until Hire.
- Queued hires (deep links) open here, prefilled from the manifest, and pass the same check.

### After Hire (E2, E4)
Spawn exactly as today (spawnPty + addAgent), with `hive.role = "<title>: <routing>"`, `goal` = work style,
model from the Best / Fast chip. The agent saves `sourceCard: "<businessType>/<cardId>"` when its job came
from a pack card (directly, or via a teammate that has one); ProfileTab falls back to it when `agent.id`
has no card. Teammates whose routing line gained a "Not for" clause are updated through the same path
Edit Agent uses. A mailbox binding writes `agentCapabilities[id].email`. Then the new agent is selected and
its panel opens on Capabilities.

### Only Michael assigns (S2)
- Router (`routeMessage`): a message from a team member to another team member with `act: "request"` is
  delivered to Michael instead, wrapped: "Kelly asked Nick to do this. You assign work: hand it to the
  right teammate or answer it." `query` and its `inform` reply stay direct. `done` to a teammate is
  delivered (terminal). Michael, the owner and the scheduler are unaffected.
- A hop-cap drop now also sends Michael an `inform` naming the two agents and the subject.
- Instructions (`teamMemberInstructions`, PROTOCOL_BUSINESS_MD): "Only Michael assigns work. Ask a
  teammate directly for a fact you need (act query); if they cannot help, or you need someone to DO
  something, tell Michael and he hands it off." Michael's prompt: he is the only assigner.

### One agent per mailbox (S3)
Capabilities mailbox dropdown shows "Pam has this" beside a held mailbox; picking it asks "Move
support@ from Pam to Erin? Pam stops checking it." Yes turns Pam's email off (same path as switching it
off) and gives it to Erin. Main refuses a config write that gives one mailbox to two agents. The hire
wizard's Bind to a mailbox only lists free mailboxes. Settings > Mailboxes "used by" shows at most one name.

### Removed or hidden
Sidebar sections, Workspace section, Engine section (flag), developer templates (DESCRIPTION_TEMPLATES
deleted), colour picker. Import hire stays behind SHOW_IMPORT_HIRE.

### Files (estimate)
| File | Change |
|---|---|
| src/shared/hireTemplates.ts (new) | card index, character family map, job resolution, name swap, folder suffix, rules overlap |
| src/renderer/src/components/AddAgentModal.tsx | three step wizard (Who/Job/Review), submit reuse |
| src/renderer/src/components/ProfileTab.tsx | sourceCard fallback |
| src/renderer/src/components/CapabilitiesTab.tsx | held mailbox label and move confirm |
| src/renderer/src/store/store.ts (+ persistence) | `sourceCard` on Agent |
| src/main/index.ts, src/preload/index.ts | folders:exists, hire:checkDistinct (hidden Claude) |
| src/main/hireCheck.ts (new) | distinct check prompt + parse, rules fallback |
| src/main/hive.ts | request reroute, hop drop notice, instructions |
| src/main/config.ts (or mailbox write path) | refuse two holders |
| src/shared/buildFeatures.ts | SHOW_ENGINE_PICKER |
| locales en, zh-CN, ar | wizard strings, no dashes |
| tests | hireTemplates, hire check parse and fallback, router reroute, mailbox single holder, hidden surfaces |

About 16 files. Two new main modules, one new shared module.

### NOT in scope
- E5 Hire through Michael: deferred to TODOS.md (D5.5).
- Copying mailbox or schedules from the source teammate (R2: set on Capabilities; E4 opens it).
- Saving custom jobs anywhere other than on the teammate (E3 reads the live team).

## Update, 2026-10-03 (ship review)

What the wizard does now, beyond the plan above:

- **Bindings.** A job that takes work from teammates writes their "Not for ...; that goes to <Name>." lines. Closing the hire (or forgetting it from the archived list) takes the lines off and keeps them on the hire; they go back on the teammates still there when the hire returns (`releaseBindings.ts`, `returningBindings`). A newer hire with the same name keeps the lines; a rename keeps the kept lines true.
- **The overlap check** runs once per job picked, keyed by a request id, and is stopped when the owner picks another job, goes back, or closes the wizard (`hire:checkStop`). A stopped check returns the rules verdict and logs nothing.
- **Clone** is greyed, with a reason on hover, when every character of that family is already on the team.
- **Suggest me** needs the handles first (greyed with a reason) and stops when the owner goes back to Who or Job.
- **First task.** A First task the owner types into the Work style, at hire or in Edit, goes to Michael as a first task card instead of staying in the instructions (first-task-card.md SR5).
