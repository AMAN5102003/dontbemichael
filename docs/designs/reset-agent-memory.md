# Reset agent memory

Status: in review (/plan-ceo-review, 2026-10-22). Nothing here is approved until its ledger row says so.

## The ask (owner, 2026-10-22)

"In settings need one more option that will reset agent memories only. So they should behave as exactly after the system is setup first time and office is launched the first time."

## What a team member remembers today

Receipts are on the running branch at the time of review.

| What | Where | Fresh office has | Receipt |
|---|---|---|---|
| Memory index (the notes the app gives it at each session start) | `hive/agents/<id>/memory.md` | an empty index, `renderIndex(name, id, [])` | `src/main/hive.ts:1325-1326` |
| Notes waiting to be tidied in | `hive/agents/<id>/memory/inbox.md` | nothing | `src/main/hive.ts:4090`, `:4148-4149` |
| Written procedures | `hive/agents/<id>/memory/procedures/*.md` | nothing | `src/main/hive.ts:4099` |
| Handoff before a fresh start, and its archive | `memory/handoff.md`, `memory/handoffs/` | nothing | `src/main/hive.ts:4870-4891` |
| The last clear (lets the owner undo a clear) | `memory/cleared.json` | nothing | `src/main/hive.ts:4893-4917` |
| Its conversation, resumed at every start | registry `sessionId`, used as `--resume` | no `sessionId`, so a new conversation | `src/main/hive.ts:1793-1811`, `src/main/index.ts:4324`, `:4363` |
| Messages: waiting ones (`inbox/`) and handled ones (`inbox/.done`, `outbox/.sent`) | member's hive folder; the app reads handled ones for reply tracking and Pulse | none | `src/main/hive.ts:1298`, `:2188`; decision R6 |
| Copies kept by the memory tidy up | `hive/backups/<stamp>/<id>/` | nothing | `src/main/memoryTidy.ts:214`, `:223` (spec review) |
| Claude Code's own auto memory for the member's working folder | `~/.claude/projects/<key>/memory/`, loaded at each start | empty | no `autoMemoryEnabled` in `src/`; folders exist on this Mac (spec review); decision R2 |
| Old notes in the office's git history | hive repo, committed on every change; every member can read it with git | none | `src/main/hive.ts:1194-1196`, `:6066-6080`; decision R3 |
| Codex members' conversations | `~/.codex/sessions/munder-difflin/<hiveId>/<agentId>`, the member's `.codex/state_5.sqlite` | none | `src/main/hive.ts:1166-1171`, `:5363-5365` (spec review) |
| Research's notes (same files, written the safe way) | `researchDir('memory')` | as above | `src/main/hive.ts:4880-4884`, `:4907-4917` |

Not agent memory, and kept by this plan unless a decision below says otherwise: the team and its Work styles, cards and the board, messages waiting in inboxes, schedules, settings and connectors, Company knowledge and Company foundations (company wide, not a member's), Pulse's history, and the owner's own files.

Notes for the review:
- House rules need no change: a new conversation is never told "your house rules changed"; the rules it starts with are recorded as seen (`src/shared/houseRulesNotice.ts:38-44`).
- Old conversations: a factory reset leaves them in Claude Code's folder, and members cannot read Claude Code's records (#387, `engineRecords` in `src/shared/folderAccess.ts`). This reset deletes members' recorded ones (E3).
- Settings already has one reset, "Reset & start over" (`app:resetAll`, `src/main/index.ts:6522-6577`; `src/main/factoryReset.ts`), which stops everything, erases the office and relaunches into setup.

## Decision ledger

| ID and owner | Contract and evidence | Current | Proposed | Status | Exact approval and scope |
|---|---|---|---|---|---|
| R1 approach (owner) | Members behave as on first launch; only memory goes | none | A) one Settings action wipes every member's notes and drops its saved conversation, then relaunches the app; B) same, restarting each member's terminal in place; C) members one at a time only | approved | Owner answer to D1, 2026-10-22: "Reset all, then relaunch". Scope: one Settings action, every member (Michael and Research included), notes back to a new member's and saved conversation dropped, then the app relaunches; team, cards, inbox messages, schedules, settings and Company knowledge kept |

## Answered: R1 (D1, A)
Commitment comparison:

| Commitment | Source/approval or pending | Current | A | B | C |
|---|---|---|---|---|---|
| Who is reset | owner's ask: "agent memories" | nobody | every member, Michael and Research included | every member, Michael and Research included | one member per click |
| Notes (memory.md, memory/) | ask | kept | back to a new member's | back to a new member's | back to a new member's, for that member |
| Saved conversation | ask ("behave exactly as after first launch") | resumed | dropped, new one at start | dropped, new one at start | dropped for that member |
| Team, cards, inbox messages, schedules, settings, Company knowledge | ask ("memories only") | kept | kept | kept | kept |
| How members stop and start | pending | n/a | app relaunches, as Reset & start over does | each terminal stopped and started, app stays open | that member's terminal |
| Where | ask ("in settings") | n/a | Settings, General, next to Reset & start over | same | member's panel, not Settings |

Question: D1 — R1: How should resetting agent memory work?
Project/branch/task: planning a Settings option on mit/1-1-scroll-expanded-response-f89475 that resets team members' memory only.
ELI10: A member remembers in two places: its notes, and the conversation it picks up again every time it starts. To act exactly like on day one, both have to go, while the team, its cards, schedules and settings stay. The question is how the app gets every member to start over cleanly.
Stakes if we pick wrong: a member keeps an old note or resumes its old conversation, so it looks reset but still remembers.
Recommendation: A because relaunching is how Reset & start over already gets a clean start, and nothing running can write an old note back.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Reset all, then relaunch (recommended)
  ✅ Reuses the full reset's tested stop everything and relaunch, so no service holds a member's old state.
  ✅ The first launch after it is a real first launch for every member: new conversation, empty notes.
  ❌ The app closes and reopens, so anything open on screen (a draft in the dock) is lost.
B) Reset all, app stays open
  ✅ The window stays put; only the team's terminals restart one after another.
  ❌ Each service that remembers a member in memory (tidy up, clearer, wake watchdog, hooks) must be found and cleared.
C) One member at a time
  ✅ Lets the owner give one confused member a clean start and leave the rest alone.
  ❌ Not what was asked: it lives on a member's panel, and resetting everyone takes a click per member.
Net: A is the safest way to a true day one; B avoids a relaunch at the cost of many places to get wrong; C is a different feature.
Header: Approach
A) Reset all, then relaunch (recommended)
One Settings action clears every member's notes and drops its saved conversation, then relaunches the app so each starts new; the team, cards, messages, schedules, settings and Company knowledge stay. Effort S, risk low, reuses the full reset's stop and relaunch; testable end to end with a temp office.
B) Reset all, app stays open
Same reset, but each member's terminal is stopped and started in place instead of relaunching. Effort M, risk medium: every running service (tidy up, clearer, wake watchdog, hooks) must forget its in-memory state for each member, or a note or the old conversation comes back.
C) One member at a time
A Reset memory action on each member's panel instead of Settings. Effort M, risk medium; doesn't match the ask (a Settings option for the team) and leaves resetting everyone to many clicks.

## Mode

SELECTIVE EXPANSION (owner answer to D2, 2026-10-22). Core: R1. Observability in the core: each memory reset is written to the office log (when, by the owner, which members).

## Scope candidates (0G, each decided on its own)

| ID and owner | Contract and evidence | Current | Proposed | Status | Exact approval and scope |
|---|---|---|---|---|---|
| E1 undo (owner) | A reset by mistake can be taken back. Precedent: undo of a conversation clear, `agent:restoreConversation` (`src/main/index.ts:5623`) with `memory/cleared.json` | gone for good after R1 | before wiping, move each member's notes and its last conversation id into an app private backup (`private/memory-resets/<date>/`, walled from members); Settings offers "Bring back the memory from <date>" for 7 days, then the backup is deleted; Reset & start over erases it | declined | Owner answer to D3, 2026-10-22: "Skip". The reset is final; the confirm says it cannot be undone. Goes to NOT in scope |
| E2 one member (owner) | Fix one confused member without touching the rest | none | the same reset for one member, from that member's panel; that member's terminal restarts, no app relaunch | declined | Owner answer to D4, 2026-10-22: "Skip". Only the team reset. Goes to NOT in scope |
| E3 old conversations (owner) | Truly forget: delete the old conversations from Claude Code's folder too | kept on disk, unreadable to members (#387) | delete each member's old conversation files under `~/.claude/projects` | approved | Owner answer to D5, 2026-10-22: "Add to this plan". Scope: during the reset, delete the conversation files of the sessions each member used (ids recorded by the app), never a whole folder; members' working folders can also hold the owner's own Claude Code conversations. Effects on Pulse and usage readers: see "Pulse and usage after E3" below |
| R2 Claude Code auto memory (owner; from spec review) | Claude Code loads `~/.claude/projects/<key>/memory/` for the working folder at each start; the app never turns it off; a member's working folder can also be the owner's own Claude Code folder. Owner on #493 (2026-10-21): wanted `autoMemoryEnabled: false` for members, still pending with the contributor | on, kept by the reset | A) turn auto memory off for members (the #493 change) so old folders are never loaded again; B) delete those memory folders during the reset; C) leave it | approved | Owner answer to D6, 2026-10-22: "Delete those folders during the reset" (B over the recommended A). Scope: during the reset, delete `memory/` under the Claude Code projects folder of each member's working folder (current and legacy keys); auto memory stays on for members. Accepted risk: a working folder the owner also uses with Claude Code loses the owner's own auto memory there; the confirm names it |
| R3 git history (owner; from spec review) | Members' notes are committed to the office's git history on every change, and every member can read it with git (`src/main/hive.ts:1194-1196`, `:6066-6080`) | old notes stay in history | A) stop committing members' notes from now on; old copies stay in history; B) same, and rewrite the history during the reset to drop all past notes; C) leave it | approved | Owner answer to D7, 2026-10-22: "Stop saving notes in the history". Scope: add `agents/*/memory.md`, `agents/*/memory/` and the tidy up copies `backups/` to the hive's .gitignore and untrack them once (as `untrackCodexHomes` does), at app start, not only at a reset; past copies stay in the old history and the confirm does not promise otherwise |
| R4 other engines (owner; spec review 2) | Codex, Grok, Antigravity, Crush, OpenCode and Pi resume by id and keep history in the member's own engine home (`.codex` sessions and archived_sessions and state db, `.gemini-hive`, `.pi-agent`, `.opencode`, `.crush-data`; `src/main/hive.ts:5204`, `:5336`, `:5455`, `:5492`, `:5540`); those homes also hold the engine's sign in and settings. This build offers Claude only (`src/shared/agentProvider.ts:174`) | not covered | A) Claude only now; other engines get a new conversation (id dropped) and a TODO to clear their history before they ship; B) also delete each engine's history files now | approved | Owner answer to D8, 2026-10-22: "Claude only now, TODO for the rest". Scope: E3 and R2 cover Claude members; other engines get a new conversation by the dropped id; TODO: each engine clears its own history on a memory reset before it joins BUILD_ENGINES |
| R5 which old conversations (owner; spec review 2) | Members can write the office log (`src/main/hive.ts:523-525`), so ids from it could name the owner's own conversations. Pulse records each member's conversation id with every cost sample in harness.db, which members cannot write (`src/main/telemetryStore.ts:134-140`) | ids from the office log, deleted in every projects folder | A) ids from Pulse's database and a new private record from now on, deleted only in members' own working folder keys and the copies the app seeded; conversations from before Pulse recorded stay; B) also take ids from the office log | approved | Owner answer to D9, 2026-10-22: "Only ids members can't forge". Scope: ids from Pulse's cost records in harness.db plus a new app private record of each member's session ids written from authenticated hook frames (`recordSession`) from now on; never the office log or the registry, both member writable; deletes only in the Claude Code projects keys of members' own working folders and the copies `seedSessionTranscript` made; conversations from before either record stay |
| R6 handled messages (owner; spec review 2) | `inbox/.done` and `outbox/.sent` keep a member's past messages; the app reads them for reply tracking and Pulse (`src/main/hive.ts:2188`); a new office has none | kept | A) keep waiting and handled messages; B) also clear handled messages | approved | Owner answer to D10, 2026-10-22: "Also clear handled messages" (B over the recommended A). Scope: delete each member's `inbox/.done` and `outbox/.sent`; waiting messages in `inbox/` and `outbox/` stay. Accepted cost: a question a member sent and still waits on loses its reply tracking, and every reader of those folders starts over (listed under "Readers of handled messages") |
| R7 failure visibility (owner; Section 2) | Failures of the reset (open files, slow members, unreadable database, registry write) reach only the console today, as in the full reset | console and log row only | A) a one line outcome note in Settings after the relaunch; B) log only | approved | Owner answer to D12, 2026-10-22: "Log only, like the full reset" (B over the recommended A). Scope: failures go to the console and the office log row only, as in Reset & start over. Accepted risk: a failed registry write leaves members resuming old conversations with nothing on screen (CRITICAL GAP, accepted) |

## Answered: E1 (D3, Skip)
Question: D3 — E1: Add a way to bring the memory back after a reset?
Project/branch/task: scope extras for the Settings memory reset on mit/1-1-scroll-expanded-response-f89475; core approved as reset all, then relaunch.
ELI10: As planned, a memory reset can't be undone: notes and conversations are gone. This extra keeps a private copy for 7 days, out of every member's reach, and Settings shows "Bring back the memory from <date>". The app already lets you undo a single conversation clear the same way.
Stakes if we pick wrong: without it, one mistaken click erases what the whole team learned, with no way back.
Recommendation: A because a one-click wipe of the whole team's learning deserves the same undo a single clear already has, and the cost is small.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add to this plan (recommended)
  ✅ A mistaken reset costs nothing: one click brings back every member's notes and conversation.
  ✅ Reuses the undo a conversation clear already has, so members resume their old conversation the known way.
  ❌ About a day more [estimated, human] for the backup, the restore and erasing the copy after 7 days.
B) Defer to TODOS.md
  ✅ The core ships smaller now; undo can follow once the button has been used.
  ❌ Until then a mistaken reset is final, and the confirm has to say so.
C) Skip
  ✅ Simplest: the reset means what it says, like Reset & start over.
  ❌ No way back ever; the only protection is the confirm dialog.
Net: a small, private safety net versus a reset that is final by design.
Header: Undo
A) Add to this plan (recommended)
Keep a private copy of every member's notes and conversation id for 7 days, out of members' reach, with "Bring back the memory from <date>" in Settings. Effort S (human ~1 day / CC ~20 min), risk low.
B) Defer to TODOS.md
Ship the reset without undo; record the undo as a TODO. Effort S now, risk: a mistaken reset is final until it lands.
C) Skip
No undo, ever; the confirm says it can't be undone. Effort S (zero extra work), risk: a mistaken click erases the team's learning.

## Answered: E2 (D4, Skip)
Question: D4 — E2: Also let the owner reset one member from that member's panel?
Project/branch/task: scope extras for the Settings memory reset on mit/1-1-scroll-expanded-response-f89475; core approved as reset all, then relaunch; undo skipped.
ELI10: The core resets the whole team at once. Sometimes only one member has picked up a wrong habit. This extra puts the same reset on a member's panel: that member's notes and conversation go, its terminal restarts, and nobody else is touched.
Stakes if we pick wrong: without it, fixing one member means wiping what everyone else learned.
Recommendation: B because one member restarting in place is the harder path R1 avoided (each running service forgets that member), and it is not what was asked; it can follow once the team reset has been used.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add to this plan
  ✅ A single member can start over without the rest of the team losing anything.
  ✅ Shares the same wipe as the team reset, so its rules are tested once.
  ❌ Restarting one member in place is the path R1 avoided: each service holding that member's state must be cleared.
B) Defer to TODOS.md (recommended)
  ✅ The asked Settings button ships first, on the proven relaunch path.
  ✅ The TODO records the in-place restart work, so it is planned with the right care.
  ❌ Until it lands, one confused member means resetting the whole team.
C) Skip
  ✅ One reset, one place, nothing more to explain or maintain.
  ❌ No way ever to start one member over without touching the others.
Net: worth having later; doing it now pulls in the riskiest part of the work for a case nobody asked about yet.
Header: One member
A) Add to this plan
The same reset on each member's panel, for that member only; its terminal restarts, the app stays open. Effort M (human ~1.5 days / CC ~30 min), risk medium.
B) Defer to TODOS.md (recommended)
Ship the team reset now; record the per-member reset, with the in-place restart it needs, as a TODO. Effort S now, risk low.
C) Skip
Only the team reset, ever. Effort S (zero extra work), risk low.

## Answered: E3 (D5, Add)
Question: D5 — E3: Also delete members' old conversations from Claude Code's folder?
Project/branch/task: scope extras for the Settings memory reset on mit/1-1-scroll-expanded-response-f89475; core approved as reset all, then relaunch; undo and per-member skipped.
ELI10: After the reset, members never go back to their old conversations, and they can't read them: Claude Code's records are walled off from every member. The files still sit in Claude Code's own folder on this computer, as they do after Reset & start over. This extra deletes them too. But the app reads those same files for Pulse's cost and usage history.
Stakes if we pick wrong: deleting them wipes Pulse's cost history and the owner's own record of past work; keeping them leaves old text on disk that no member can reach.
Recommendation: C because members already can't read those files, Reset & start over keeps them too, and deleting them would erase the cost history Pulse is built on.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add to this plan
  ✅ Nothing from before the reset is left anywhere on disk for any member's conversation.
  ❌ Erases what Pulse reads for cost and usage history, and files that belong to Claude Code and the owner.
  ❌ Goes further than Reset & start over, which keeps them.
B) Defer to TODOS.md
  ✅ Leaves room to add a separate "delete old conversations" choice later, with its Pulse cost spelled out.
  ❌ A TODO for something the plan already argues against.
C) Skip (recommended)
  ✅ Same rule as Reset & start over: the app erases only what it made; Claude Code's folder stays.
  ✅ Pulse keeps its cost history across the reset.
  ❌ Old conversations stay on this computer, readable by the owner but not by members.
Net: members already can't reach them, so deleting buys little and costs Pulse's history.
Header: Old chats
A) Add to this plan
Delete each member's old conversation files from Claude Code's folder during the reset. Effort S (human ~half a day / CC ~10 min), risk medium: Pulse loses cost history.
B) Defer to TODOS.md
Keep them now; record a possible separate delete option as a TODO. Effort S (zero now), risk low.
C) Skip (recommended)
Leave them, as Reset & start over does; members cannot read them. Effort S (zero extra work), risk low.

## The plan (approved scope: R1, E3, R2 B, R3 A, R4 A, R5 A, R6 B; mode D2)

Settings, General, danger zone: a second button, **Reset memory**, beside Reset & start over. It asks once, then:

```
 owner clicks Reset memory ── confirm (what goes, what stays, cannot be undone)
        │ yes
        ▼
 app:resetMemory (main)
   1. stop the same services app:resetAll stops (index.ts:6525-6542: timers, observers, broker, mail,
      router, hooks, telemetry, Slack, memory, tidy up, proxies, webhook, every terminal); one shared
      helper for both, EXCEPT persist.close(), which waits until step 3 is done. Before stopping
      telemetry: pulseTelemetry.flush(), so buffered cost samples reach harness.db.
      NOT done here: roster archive, removeExposedCodexData, eraseOfficeData, resetConfig
   2. wait for the terminals to exit, up to 5 s; any still running are listed in the log row and
      the erase goes on (a note written after this is the known leftover, as in the full reset TODO)
   3. collect: members = every registered agent plus archived ones, never agents/human;
      their conversation ids = harness.db rows with kind='cost' AND office=<this office> AND
      agent_id=<member>, taking attrs.s, + the private session record (R5), each checked against
      VALID_SESSION_ID (transcript.ts:95); never the log or the registry. Then persist.close().
      working folders of a member = registry cwd, roster cwd and roster worktreePath
      (useRestoreTeam.ts:126-131), and for Research its desk folder
   4. erase per member:  memory.md, memory/ (Research through its safe path), hive/backups/*/<id>/,
                          inbox/.done, outbox/.sent (R6; waiting messages stay)
      per collected id:   <id>.jsonl and <id>/ only in the projects keys of that member's working
                          folders (current and legacy) and the copies seedSessionTranscript made (R5)
      per working folder: memory/ under the Claude Code projects key Claude Code uses for auto memory:
                          the git repository root when the folder is in a repository (subfolders and
                          worktrees share it), else the folder itself; current and legacy keys (R2).
                          The confirm names each such folder, repository wide
      per other engine:   nothing beyond the dropped id (R4); TODO before each engine ships
   5. registry: drop each member's sessionId; office log: one 'memory-reset' row (members, counts,
      failures). The office log keeps the old ids; it holds ids, not notes. The private session
      record (R5) is emptied for the reset members: their old ids are gone with the files

 Private session record (R5): <office>/private/member-sessions.jsonl (privateRoot, out of every
 member's reach like owner-said.jsonl), one line {agentId, sessionId, at} appended by recordSession
 from authenticated hook frames; erased by Reset & start over (PRIVATE_ENTRIES) and moved with
 the office folder (homeFolder.ts move list)
   6. relaunch (restartApp); in the dev build this quits instead (restart.ts:21), as the full reset does

 R3, at every office start (not part of the reset): the hive bootstrap adds `agents/*/memory.md`,
 `agents/*/memory/` and `backups/` to the ignore list it already writes (`src/main/hive.ts:1198`),
 then untracks them once with `git rm -r --cached` and one commit. Test: a temp hive with tracked
 notes ends with none tracked and the notes still on disk.
        ▼
 next launch: each member starts with a new conversation and an empty memory index,
 exactly as ensureAgent writes it for a new member (hive.ts:1325-1326)
```

Stays: the team and its Work styles, identities, folders and files, cards and the board, waiting inbox and outbox messages, schedules, settings, connectors and keys, Company knowledge and foundations, the roster, config.

Pulse and usage after E3: Pulse keeps its own points in harness.db (its backfill read the conversations once, `src/main/pulseBackfill.ts:1-18`), so its charts and history stay, the Learning counts included (they count `note-added` records in harness.db, `src/main/index.ts:582`, `src/main/pulse.ts:326-333`); only its list of each member's current notes empties. One reader changes: the per folder usage reader (`hive:agentUsage`, `src/main/index.ts:6582`), which sums conversation files, shows only spending since the reset.

Files [estimated]: `src/main/memoryReset.ts` (new, pure: targets and session file matching), `src/main/hive.ts` (forget sessions, log row), `src/main/index.ts` (IPC, shared teardown with app:resetAll), `src/preload/index.ts`, `src/renderer/src/components/SettingsModal.tsx`, three locales, `test/memory-reset.test.cjs`, `CHANGELOG.md`, `docs/FEATURES.md`.

## NOT in scope

- E1 undo: declined (D3). The reset is final; the confirm says so.
- E2 one member from its panel: declined (D4).
- Rewriting the office's git history to drop past notes (R3 option B): declined (D7).
- Turning Claude Code's auto memory off for members (R2 option A): declined (D6); members keep it, emptied by the reset.

## Answered: R2 (D6, B)
Question: D6 — R2: Claude Code's own auto memory still remembers. What should the reset do about it?
Project/branch/task: spec review found more memory for the Settings memory reset on mit/1-1-scroll-expanded-response-f89475.
ELI10: Besides the app's notes, Claude Code keeps its own small memory per working folder and reads it at every start. The app never turns this off, so after our reset a member would still read those old notes. That folder belongs to the working folder, not the member, so it can also hold your own Claude Code notes for that folder. On 10-21 you already wanted auto memory off for members (#493), but that change is still waiting on the contributor.
Stakes if we pick wrong: members keep acting on old Claude Code notes after the reset, or the reset deletes your own Claude Code notes for a shared folder.
Recommendation: A because it is the change you already chose on #493, it removes this memory for good rather than once, and it never touches your own Claude Code notes.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Turn it off for members (recommended)
  ✅ Old auto memory is never read again, and members never build new auto memory beside the app's notes.
  ✅ Nothing is deleted, so your own Claude Code notes in a shared folder are safe.
  ❌ Behavior change for every member: they keep memory only in the app's notes, not in Claude Code's own.
B) Delete those folders during the reset
  ✅ Members keep Claude Code's auto memory, starting empty after the reset.
  ❌ Can delete your own Claude Code notes for a folder you share with a member.
C) Leave it
  ✅ No change to what Claude Code does for members.
  ❌ Members still read their old auto memory after the reset, so the reset is not a real first day.
Net: A takes the decision you already made on #493 and makes this reset complete without touching your own notes.
Header: Auto memory
A) Turn it off for members (recommended)
Members start with Claude Code's auto memory off (the #493 change, built here if #493 has not landed); old auto memory folders are left alone and never read. Effort S (human ~2 hours / CC ~10 min), risk low.
B) Delete those folders during the reset
Delete the memory folder of each member's working folder in Claude Code's projects folder. Effort S (human ~half a day / CC ~10 min), risk medium: may delete your own Claude Code notes.
C) Leave it
Do nothing about auto memory. Effort S (zero extra work), risk: members still remember after the reset.

## Answered: R3 (D7, A)
Question: D7 — R3: Members' old notes stay in the office's git history. What should we do?
Project/branch/task: spec review found more memory for the Settings memory reset on mit/1-1-scroll-expanded-response-f89475.
ELI10: The app saves a history of the office folder with git after every change, and members' notes are in it. Every member can read that history with git. So after the reset, old notes are still there for anyone who digs, and today any member can read any other member's notes that way, which breaks your 10-16 rule that each member's memory is private. Members don't look there on their own; it takes a deliberate git command.
Stakes if we pick wrong: old notes, and other members' notes, stay one git command away; or a history rewrite goes wrong on a large office.
Recommendation: A because it closes the privacy gap for good with a small change, and rewriting the history adds risk for copies members don't look at on their own.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Stop saving notes in the history (recommended)
  ✅ From now on no member can read another member's notes through git, which fixes the 10-16 privacy gap.
  ✅ Small and safe: the notes files are just left out of the history, like Research's folder already is.
  ❌ Copies saved before the change stay in the old history; a member who digs with git can still find them.
B) Stop saving, and rewrite the past history at the reset
  ✅ After the reset no old note is left anywhere in the office, history included.
  ❌ Rewriting a large office's history while it is stopped can take minutes and can fail partway.
C) Leave it
  ✅ No change to how the office history works.
  ❌ Old notes stay in history after the reset, and members can still read each other's notes with git.
Net: A fixes the privacy hole now; B also scrubs the past at the cost of a slow, riskier rewrite.
Header: Git history
A) Stop saving notes in the history (recommended)
Leave members' memory.md and memory/ out of the office's git history from now on (as Research's folder already is); past copies stay in the old history. Effort S (human ~2 hours / CC ~10 min), risk low.
B) Stop saving, and rewrite the past history at the reset
As A, plus the reset rewrites the office's git history to drop every past copy of members' notes. Effort M (human ~1 day / CC ~30 min), risk medium.
C) Leave it
Notes stay in the history, readable by every member. Effort S (zero extra work), risk: privacy gap stays.

## Behavior changes (for the owner)

| Who | Today | After this plan | What the owner sees |
|---|---|---|---|
| Every member, Michael and Research included, at a memory reset | n/a | starts a new conversation with an empty memory index, no tidy up copies, no Claude Code auto memory, no recorded old conversations | the app relaunches; members greet work as on their first day |
| Every member, always (R3) | its notes are committed to the office's git history, readable by every member | its notes are never committed; nobody reads them through git | nothing visible |
| Every member, Michael's closing time and the safe clearer, right after a reset (R6) | a member's sent questions without a reply count as open, so closing time waits on them and the clearer holds off | they count zero: closing time and the clearer see no open questions; a reply that still arrives is delivered as a new message | nothing; replies still arrive |
| Owner, when a working folder is shared with the owner's own Claude Code (R2) | owner's auto memory for that folder kept | deleted by a memory reset | named in the confirm |

## Answered: R4 (D8, A)
Question: D8 — R4: Other engines keep their own conversation history. Cover them now?
Project/branch/task: spec review 2 for the Settings memory reset on mit/1-1-scroll-expanded-response-f89475.
ELI10: Members can run on engines other than Claude (Codex and five more), and each keeps its own history in the member's folder, next to its sign in and settings. But this build offers only Claude; the others exist only in development builds. Dropping the saved conversation id already makes any engine start a new conversation; deleting each engine's history files is extra work per engine.
Stakes if we pick wrong: a member on another engine could still look back at its old history; or a bad delete removes an engine's sign in.
Recommendation: A because only Claude ships today, and each engine's history layout is different enough to deserve its own check when that engine is offered.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Claude only now, TODO for the rest (recommended)
  ✅ Covers every engine owners can pick today, with no risk to other engines' sign ins.
  ✅ The TODO joins the existing checklist an engine must pass before it ships.
  ❌ A member on a development build engine starts a new conversation but its old history files stay in its folder.
B) Delete every engine's history now
  ✅ True first day on every engine, shipped or not.
  ❌ Six different history layouts to get right and test, next to each engine's sign in, for engines owners can't pick yet.
Net: cover what ships now; do each other engine properly when it ships.
Header: Engines
A) Claude only now, TODO for the rest (recommended)
The reset clears Claude members fully; other engines get a new conversation, and a TODO adds "clear its history on a memory reset" to each engine's ship checklist. Effort S (zero extra now), risk low.
B) Delete every engine's history now
Also delete each other engine's session history files during the reset. Effort M (human ~1.5 days / CC ~40 min), risk medium.

## Answered: R5 (D9, A)
Question: D9 — R5: Where should the reset get the list of old conversations it deletes?
Project/branch/task: spec review 2 for the Settings memory reset on mit/1-1-scroll-expanded-response-f89475; E3 approved: delete members' old conversations.
ELI10: To delete a member's old conversations, the app needs their ids. The plan took them from the office log, but members can write that log, so a member, or a message that tricks one, could slip in the id of one of your own Claude Code conversations and get it deleted. Pulse's database already records every member's conversation id, members can't touch it, and the reset can also be limited to members' own folders.
Stakes if we pick wrong: the reset deletes your own Claude Code conversations because a member planted their ids.
Recommendation: A because the reset must never be steerable by what a member writes, and the only cost is that conversations from before Pulse started recording stay where members already can't read them.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Only ids members can't forge (recommended)
  ✅ Ids come from Pulse's database plus a new private record, so no member can make the reset delete your conversations.
  ✅ Deletes only in members' own working folder keys and the copies the app made, never elsewhere.
  ❌ Conversations from before Pulse began recording are not deleted (members still can't read them).
B) Also use the office log
  ✅ Finds every old conversation back to the office's first day.
  ❌ Anything a member writes to the log can make the reset delete your own Claude Code conversations.
Net: a small gap in what gets deleted, against a reset that a member could steer.
Header: Which chats
A) Only ids members can't forge (recommended)
Ids from Pulse's database and a new private record from now on; deleted only in members' own working folder keys and the app's seeded copies; older conversations stay. Effort S (human ~half a day / CC ~15 min), risk low.
B) Also use the office log
Add ids from the office log, which members can write. Effort S (human ~2 hours / CC ~5 min), risk high: the owner's conversations can be deleted.

## Answered: R6 (D10, B)
Question: D10 — R6: Should the reset also clear members' past messages?
Project/branch/task: spec review 2 for the Settings memory reset on mit/1-1-scroll-expanded-response-f89475.
ELI10: Each member keeps the messages it has already handled (read inbox, sent outbox). A new office has none, so a member could look back through them and recall old work. But they are the office's record of who asked what: the app uses them to know which questions still wait for a reply, and Pulse counts from them. You asked to reset memory only.
Stakes if we pick wrong: clearing them breaks reply tracking and Pulse's message counts; keeping them leaves a member able to reread its old messages.
Recommendation: A because they are the office's work record, not the member's memory, and the app needs them to track replies.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Keep all messages (recommended)
  ✅ Reply tracking, Pulse counts and the office's record of who asked what stay intact.
  ✅ Matches "memories only": messages are work, like cards and schedules.
  ❌ A member that looks through its handled messages can still find old work.
B) Also clear handled messages
  ✅ Closer to a new office: a member has nothing old to reread.
  ❌ Questions still waiting for a reply lose track, and Pulse's message counts drop.
Net: messages are the office's record; clearing them costs more than it buys.
Header: Messages
A) Keep all messages (recommended)
Waiting and handled messages stay; only memory and conversations reset. Effort S (zero extra work), risk low.
B) Also clear handled messages
Delete each member's inbox/.done and outbox/.sent during the reset. Effort S (human ~2 hours / CC ~10 min), risk medium: reply tracking and Pulse counts break.

## Readers of handled messages (R6, to confirm in the eng review)

- `awaitingReplies` counts a member's sent questions without a reply from `outbox/.sent` and `inbox/.done` (`src/main/hive.ts`, near `:4860`): after the reset it counts zero, so the safe clearer and closing time see no open questions.
- Any Pulse or Messages reader that lists from `.done` or `.sent` starts over; Pulse's own points in harness.db stay.
- The implementation lists every reader with a grep for `'.done'` and `'.sent'` and states its after reset behavior in the test.

## Document approval

Owner answer to D11, 2026-10-22: "Approve and continue". Accepts this plan and the CEO summary as of spec review 3; the section review follows.

## Build sequence (0I)

Effort: human team ~2.5 days / CC + gstack ~1.5 hours [estimated].

- HOUR 1, foundations: the private session record first (R5): `recordSession` appends to `private/member-sessions.jsonl`; add it to PRIVATE_ENTRIES and the homeFolder move list. Then R3 at hive bootstrap: ignore list plus a one time untrack. Both ship value on their own (privacy) before any reset exists.
- HOUR 2-3, core: `src/main/memoryReset.ts`, pure and testable: given office paths, member list, the cost rows and the private record, return what to delete (memory files, backups, handled messages, session files by id in members' own keys, auto memory folders at the repository key). Ambiguities to settle in code: how a working folder maps to Claude Code's auto memory key (repository root versus folder, legacy keys), and archived members' working folders.
- HOUR 4-5, integration: split app:resetAll's stops into a shared helper that leaves persist open; flush telemetry, collect ids, close persist, erase, drop sessionIds, log row, relaunch. Surprise to expect: an agent still exiting writes a note after the erase; the 5 s wait and the log row cover it.
- HOUR 6+, UI and tests: the second danger zone button and its confirm in three locales (no dashes, short, InfoTip for detail), the memory reset test against a temp office, wiring pins, CHANGELOG and docs/FEATURES.md.

## Section review

### Section 1: Architecture

```
 renderer                         main process                                   disk
 ─────────                        ────────────                                   ────
 SettingsModal ──confirm──► preload.resetMemory ──► ipc app:resetMemory
   (danger zone)                                     │
                                                     ├─ stopAll(keepPersist)  ◄── shared with app:resetAll (new helper)
                                                     ├─ pulseTelemetry.flush; await terminals exit (≤5 s)
                                                     ├─ await memoryTidy in-flight pass
                                                     ├─ memoryReset.collect(harness.db, private record, roster) ──► ids, folders
                                                     ├─ persist.close()
                                                     ├─ memoryReset.targets(...)  (pure, tested)  ──► rmSync each ──► hive/agents/<id>/…
                                                     │                                              ~/.claude/projects/<key>/<sid>…
                                                     ├─ hive.forgetSessions(ids) + log row ───────────► hive/registry.json, log.jsonl
                                                     └─ restartApp()
 hive bootstrap (every start) ── R3 ignore + one time untrack ──► hive/.gitignore, git index
 hooks.recordSession ── R5 private record ──► <office>/private/member-sessions.jsonl
```

Findings:
- OK: the relaunch reuses the proven teardown; the pure `memoryReset.ts` keeps all path decisions testable without Electron.
- WARNING (fixed under R1's approved stakes, "nothing running can write an old note back"): `memoryTidy.stop()` only clears its timer (`src/main/memoryTidy.ts:114-116`); an in-flight tidy pass would write memory.md after the erase. The reset awaits the running pass (or its hidden child's exit) before erasing.
- WARNING (fixed under R5's approved principle, "never steerable by what a member writes"): `hive/registry.json` is member writable, so members' working folders come from the roster (`<office>/roster.json`, `src/main/roster.ts:54-55`) and Research's desk, never the registry cwd. Implementation proves the roster is outside every member's write paths (`src/shared/folderAccess.ts`).
- OK: coupling. One new shared helper (stops) used by both resets; nothing else depends on memoryReset.ts.
- OK: rollback. Revert the commit; a reset already run is final by the owner's choice (D3).
- Security surface: one new IPC, renderer only, same trust as app:resetAll; not offered to realtime voice tools (none exist for resets today, `src/main/realtimeActions.ts`); a pin test keeps it out.

### Section 2: Error and rescue map

```
 CODEPATH                         | WHAT CAN GO WRONG                          | RESCUE                                  | OWNER SEES
 ---------------------------------|--------------------------------------------|-----------------------------------------|------------------------
 stopAll(keepPersist)             | a stop throws                              | caught per service, logged, go on       | nothing (as full reset)
 await terminals exit (≤5 s)      | a member still running at 5 s              | erase goes on; listed in log row        | see R7
 await tidy in-flight pass        | pass hangs                                 | bounded wait (same 5 s), then kill child| see R7
 collect ids from harness.db      | db closed or unreadable (SqliteError)      | ids from private record only; logged    | see R7
 collect from private record      | missing or bad line (ENOENT, JSON)         | skip bad lines, count them; logged      | nothing
 roster read                      | missing or unreadable                      | no working folders: E3 and R2 deletes   | see R7
                                  |                                            | skipped for all; logged                 |
 rmSync each target               | EBUSY / EPERM (Windows open file), EACCES  | retried 3x (as full reset), then listed | see R7
 forgetSessions (registry write)  | write fails                                | relaunch would RESUME old conversations | see R7; must not be silent
 office log row                   | append fails                               | console only                            | nothing
 restartApp                       | dev build quits instead                    | as full reset                           | app closes (dev only)
```

GAP: every row marked "see R7" ends in the console only today (the full reset has the same gap, TODOS.md "Clear what a reset could not remove"). The worst is the registry write: if it fails, members resume their old conversations after the relaunch and the owner believes the reset worked.

## Answered: R7 (D12, B)
Question: D12 — R7: When the memory reset can't finish something, what should you see?
Project/branch/task: Section 2 (errors) of the Settings memory reset plan on mit/1-1-scroll-expanded-response-f89475.
ELI10: The reset deletes many files and edits the team list. On Windows a file still open can't be deleted, a member can be slow to stop, and the app's database can be unreadable. Today such failures only go to a log you never see, which is how the full reset works too. The worst case: if dropping the saved conversations fails, members pick their old conversations back up and you think the reset worked.
Stakes if we pick wrong: you believe the team starts fresh while some members still remember.
Recommendation: A because a reset that silently half works is worse than one that says so, and a one line note costs little.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) A short note after the relaunch (recommended)
  ✅ After the relaunch, Settings shows one line under Reset memory: done, or which members it could not fully reset.
  ✅ A failed conversation drop is caught: those members are named, so you can run it again.
  ❌ One more small piece of UI and three locale strings.
B) Log only, like the full reset
  ✅ Nothing new on screen; matches Reset & start over today.
  ❌ A half finished reset is invisible to you; members may still remember.
Net: one line of text versus a reset that can fail silently.
Header: Failures
A) A short note after the relaunch (recommended)
The reset saves its outcome privately; after the relaunch Settings shows one line under the button: when it ran, and any members it could not fully reset (with a way to run it again). Effort S (human ~3 hours / CC ~15 min), risk low.
B) Log only, like the full reset
Failures go to the console and the office log row only. Effort S (zero extra work), risk: silent half resets.

### Section 3: Security and threat model

| Threat | Likelihood | Impact | Mitigated? |
|---|---|---|---|
| A member forges session ids so the reset deletes the owner's Claude Code conversations | Med (members write the log and registry) | High | Yes: R5, ids only from harness.db and the private record |
| A member changes its registry cwd to the owner's repository so R2 deletes the owner's auto memory there | Med | Med | Yes: working folders from the roster and Research's desk only (Section 1); implementation proves the roster is outside member write paths |
| Path traversal through a member id or session id | Low | High | Yes: member ids `/^[\w-]+$/` (as `rememberOwnerAnswer`), session ids `VALID_SESSION_ID`; every target is checked to sit under its expected root before rmSync |
| A member or injected text triggers the reset | Low | High | Yes: renderer IPC only, behind the owner's confirm; not in any realtime or agent tool; pin test |
| Research's folder is a link or swapped during the erase | Low | Med | Yes: Research goes through its safe path (`dropResearchEntry`, `researchDir`) as `takeHandoff` does |
| Old notes readable through git history | High today | Med | Partly: R3 stops it from now on; past copies stay (owner, D7) |
Audit trail: the office log row (members, counts, failures). No new secrets, no new dependencies.

### Section 4: Data flow and interaction edge cases

```
 harness.db cost rows ─┐
 private record ───────┼─► collect ─► validate ids (VALID_SESSION_ID) ─► per member: id set
 roster + desk ────────┘                │ nil db: private record only (logged)
                                        │ empty: nothing to delete, notes still reset
                                        ▼
                             targets (pure) ─► under-root check ─► rmSync ─► failures listed (log row)
```
Ordering invariant: no member process, tidy pass or telemetry write touches a member's memory or the database after its step. Schedule: stopAll, then telemetry flush, then await terminals and the tidy pass, then collect, then persist.close, then erase, then registry, then relaunch. Each wait is bounded; a process that outlives its wait is the known leftover (log row), not a silent pass.

| Interaction | Edge case | Handled? | How |
|---|---|---|---|
| Reset memory button | double click | Yes | button disabled while busy, as the full reset |
| Confirm | Escape or Cancel | Yes | nothing runs |
| Confirm | no office yet (setup not done) | Yes | button hidden until an office exists |
| Team | only Michael, Research off | Yes | same flow with fewer members |
| Team | a member archived | Yes | archived members included (spec review 1) |
| Michael mid reply to the owner | dock draft | Accepted | lost with the relaunch (D1 con) |

### Section 5: Code quality

- The stop list moves into one helper shared by both resets, so the two cannot drift.
- `memoryReset.ts` holds every path decision as pure functions (collect, targets); index.ts only sequences them.
- No new abstraction beyond these two; branch count per function stays under 5.

### Section 6: Tests

```
 NEW                                   TEST (test/memory-reset.test.cjs unless named)          TYPE
 targets: notes, backups, handled msgs  temp office: listed; waiting msgs, cards, identity kept unit
 ids: harness.db + private record       other office's rows ignored; bad ids ignored           unit
 forged ids                             log and registry ids never used                        unit
 working folders                        roster and desk only; registry cwd ignored            unit
 session files                          member's <id>.jsonl and <id>/ go; owner's own session  unit
                                        in the same project folder stays
 auto memory key (R2)                   repository root for a subfolder and a worktree         unit
 Research                               erased through the safe path                          unit
 R3                                     test/hive-git-ignore: tracked notes untracked, on disk unit
 R5 record                              recordSession appends; PRIVATE_ENTRIES and move list   unit
 wiring                                 stopAll shared; persist closed after collect; flush    pin
                                        before collect; not in realtime tools
 copy                                   no dashes; three locales (existing locale tests)        unit
 live                                   Demo Mac user: reset, relaunch, each member starts new  manual
```
Hostile QA: plant an owner session id in the log and the registry, point a registry cwd at another folder, and run the reset: nothing of the owner's goes. no_claim=Claude Code's own auto memory keying (asserted from its documented layout; the live check confirms).

### Section 7: Performance

One indexed query on telemetry_events (`idx_te_office_kind_ts`, `src/main/db.ts:162`), a walk of each member's projects keys, and file deletes; seconds on a large office. Waits are capped at 5 s.

### Section 8: Observability

Office log row `memory-reset` (members, files removed, failures, members still running), console lines per step. Owner visible outcome: none, by choice (R7, D12).

### Section 9: Deployment and rollout

- No database migration. R3 runs once per office at the first start after the update: one commit that untracks notes.
- Windows ships every release: open files (EBUSY) and project keys with drive letters are covered by the unit tests' Windows cases; live check on Windows not available.
- Rollback: revert the commit. Resets already run stay done (owner, D3).

### Section 10: Long term

Reversibility of the code: 4/5; of a reset: 1/5 (owner, D3). Debt: none new; the shared stop helper removes a copy. Next: per engine history before each engine ships (R4 TODO); a per member reset was declined (D4).

### Section 11: Design and UX

```
 Settings ▸ General ▸ Danger zone
   [Reset memory]  [Reset & start over]
        │ click
        ▼
   Confirm: title, what goes (short list), what stays (short list),
   folders whose Claude Code notes go (R2, named), "cannot be undone"
        │ Reset            │ Cancel / Escape
        ▼                  ▼
   button busy ─► app relaunches ─► members start their first day
```
- Less verbose UI: the zone shows the button only; the confirm carries the explanation in short lines; no dashes; three locales; Arabic right to left.
- States: idle, confirm, busy (button disabled), relaunch. Error: an IPC failure leaves the confirm with a short "could not reset memory" line (renderer side only).
- Keyboard: confirm traps focus, Escape cancels, the destructive button is not the default.
- Consider /plan-design-review only if the confirm grows beyond the existing reset's pattern.

## Outside voice

Skipped: owner answer to D13, 2026-10-22 ("Skip the outside voice"), under the standing rule that Codex is used only for the adversarial code pass. Recorded as skipped, not clean. The plan had three independent spec reviews (29 issues found, 29 fixed).

## Approval readiness: PASS

Checked rows and answers: R1 (D1 A), E1 (D3 Skip), E2 (D4 Skip), E3 (D5 Add), R2 (D6 B), R3 (D7 A), R4 (D8 A), R5 (D9 A), R6 (D10 B), R7 (D12 B); mode D2; documents D11; outside voice D13. Two fixes applied under existing approvals and cited there: working folders from the roster only (R5 principle) and awaiting the tidy pass (R1 stakes). No unapproved remedy is in the tasks.

## NOT in scope (complete)

- E1 undo with a 7 day private backup: declined (D3); the reset is final.
- E2 reset one member from its panel: declined (D4).
- Turning Claude Code auto memory off for members (R2 A): declined (D6); its folders are deleted instead.
- Rewriting the office's git history (R3 B): declined (D7); past copies stay.
- Deleting other engines' history now (R4 B): deferred to TODOS.md (D8).
- Office log ids as a source (R5 B): declined (D9).
- An owner visible outcome note (R7 A): declined (D12); log only.

## What already exists

- Reset & start over (`app:resetAll`, `src/main/index.ts:6522-6577`; `src/main/factoryReset.ts`): reused for the stop list and the relaunch.
- A new member's empty memory index written at start (`src/main/hive.ts:1325-1326`): reused, so the reset deletes rather than rewrites.
- `recordSession` from authenticated hook frames (`src/main/hive.ts:1793`, `src/main/hooks.ts:563`): extended to write the private record.
- Pulse cost records with session ids (`src/main/telemetryStore.ts:134-140`): reused as the trusted id source.
- Project keys and seeded copies (`src/main/transcript.ts:13-24`, `:58-63`, `:97`): reused for E3.
- The hive ignore list (`src/main/hive.ts:1198`) and `untrackCodexHomes` (`:6040-6068`): reused for R3.
- Research's safe file paths (`researchDir`, `dropResearchEntry`): reused.

## Dream state delta

```
  TODAY                          THIS PLAN                           12 MONTH IDEAL
  only a full reset gives a      one button gives every member a     memory the owner can see, trim and
  fresh start, and it erases     true first day, office intact;      reset per member or per topic, on
  the team and setup; notes      notes leave git history             every engine, with a way back
  readable in git history
```

## Failure modes registry

```
  CODEPATH                    | FAILURE MODE                       | RESCUED? | TEST? | USER SEES?          | LOGGED?
  ----------------------------|------------------------------------|----------|-------|---------------------|--------
  forgetSessions              | registry write fails               | N        | Y     | Silent (accepted R7)| Y   ← CRITICAL GAP (owner accepted, D12)
  rmSync targets              | EBUSY / EPERM / EACCES             | retry 3x | Y     | Silent (accepted R7)| Y
  await terminals             | member still running at 5 s        | Y (go on)| Y     | Silent (accepted R7)| Y
  await tidy pass             | pass outlives the wait             | kill     | Y     | Silent (accepted R7)| Y
  collect from harness.db     | database unreadable                | partial  | Y     | Silent (accepted R7)| Y
  roster read                 | missing or unreadable              | skip E3/R2| Y    | Silent (accepted R7)| Y
  R3 untrack                  | git command fails                  | retried at next start | Y | nothing      | Y
  confirm IPC                 | IPC throws                         | Y        | Y     | "could not reset memory" line | Y
```

## Scope expansion decisions

Accepted: E3 (delete old conversations). Deferred: none of the 0G candidates (R4's engine history is a review deferral, in TODOS.md). Skipped: E1 undo, E2 one member. Full record: CEO plan at `~/.gstack/projects/agentvivekkumar-dontbemichael/ceo-plans/2026-10-22-reset-agent-memory.md`.

## Diagrams

Produced: system architecture (Section 1), data flow with shadow paths (Section 4), error map (Section 2), user flow (Section 11), reset sequence (The plan). Stale diagram audit: the files this plan touches hold no ASCII diagrams beyond comments; none stale.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~2h / CC: ~10min)** — hive — private session record (R5)
  - Surfaced by: spec review 2, forgeable ids
  - Files: src/main/hive.ts, src/main/factoryReset.ts, src/main/homeFolder.ts
  - Verify: test/memory-reset.test.cjs "the private record gets each session id from recordSession"
- [ ] **T2 (P1, human: ~2h / CC: ~10min)** — hive — notes leave the git history (R3)
  - Surfaced by: spec review 1, git history
  - Files: src/main/hive.ts, test/hive-git-ignore.test.cjs
  - Verify: tracked notes become untracked and stay on disk
- [ ] **T3 (P1, human: ~1d / CC: ~30min)** — reset — pure targets and id collection (R1, E3, R2, R5, R6)
  - Surfaced by: The plan, steps 3 and 4; Sections 3 and 6
  - Files: src/main/memoryReset.ts, test/memory-reset.test.cjs
  - Verify: unit tests in Section 6, including the hostile QA case
- [ ] **T4 (P1, human: ~3h / CC: ~15min)** — main — shared stops and the app:resetMemory sequence
  - Surfaced by: spec review 1 Clarity 1, spec review 3 Feasibility 1, Section 1 tidy pass finding
  - Files: src/main/index.ts, src/preload/index.ts
  - Verify: wiring pins (flush before collect, persist closed after collect, stopAll shared)
- [ ] **T5 (P1, human: ~3h / CC: ~15min)** — Settings — Reset memory button and confirm
  - Surfaced by: R1, Section 11
  - Files: src/renderer/src/components/SettingsModal.tsx, src/renderer/src/i18n/locales/en.json, ar.json, zh-CN.json
  - Verify: locale and no dash tests; keyboard check in the dev app
- [ ] **T6 (P2, human: ~1h / CC: ~10min)** — docs — CHANGELOG and docs/FEATURES.md, with the behavior changes
  - Surfaced by: Behavior changes table
  - Files: CHANGELOG.md, docs/FEATURES.md
  - Verify: no dash test
- [ ] **T7 (P1, human: ~1h / CC: owner)** — live — reset a test office from the Demo Mac user
  - Surfaced by: Section 6 live row
  - Files: none
  - Verify: each member starts a new conversation with an empty memory index; owner's own Claude Code conversations untouched

## Reality rows

REALITY: premise-table pass every factual claim carries a receipt (what a member remembers table, Sections 1 to 3); unverified=1 (Claude Code auto memory keyed by repository root, from Claude Code's documented layout; T7 confirms) src/main/hive.ts:1325-1326
REALITY: already-done pass no memory reset on origin/main since 2026-10-20 (git log --grep memory) src/main/index.ts:6522
REALITY: surface-check pass app:resetAll and the IPC naming checked; no CLI flags named src/main/index.ts:6522
REALITY: binding-decisions pass 10-16 private memory (R3), 10-14 new hires restricted (untouched), Codex rule (D13), reuse orchestrator (no new stores beyond the private record) src/main/hive.ts:1194
REALITY: numbers pass file count and effort tagged [estimated]; 29 spec issues [measured: three reviewer reports] docs/designs/reset-agent-memory.md:234
REALITY: deferred-asks pass no linked issue src/main/index.ts:6522
REALITY: pr-count pass one change on the running branch (no ship policy file; default one wave) TODOS.md:232

## Completion Summary

```
  +====================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
  +====================================================================+
  | Mode selected        | SELECTIVE EXPANSION                         |
  | System Audit         | memory lives in 9 places, not 2; notes are  |
  |                      | readable by every member through git        |
  | Step 0               | R1 relaunch; E3 added; E1, E2 skipped;      |
  |                      | R2 B, R3 A, R4 A, R5 A, R6 B                |
  | Section 1  (Arch)    | 2 issues found (tidy pass, registry cwd)    |
  | Section 2  (Errors)  | 10 error paths mapped, 1 GAPS (accepted)    |
  | Section 3  (Security)| 6 issues found, 2 High severity (mitigated) |
  | Section 4  (Data/UX) | 6 edge cases mapped, 0 unhandled            |
  | Section 5  (Quality) | 0 issues found                              |
  | Section 6  (Tests)   | Diagram produced, 0 gaps                    |
  | Section 7  (Perf)    | 0 issues found                              |
  | Section 8  (Observ)  | 1 gaps found (owner sees nothing, accepted) |
  | Section 9  (Deploy)  | 2 risks flagged (R3 commit, Windows live)   |
  | Section 10 (Future)  | Reversibility: 4/5, debt items: 1           |
  | Section 11 (Design)  | 0 issues                                    |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (7 items)                           |
  | What already exists  | written                                     |
  | Dream state delta    | written                                     |
  | Error/rescue registry| 10 rows, 1 CRITICAL GAPS                    |
  | Failure modes        | 8 total, 1 CRITICAL GAPS (owner accepted)   |
  | TODOS.md updates     | 1 items proposed                            |
  | Scope proposals      | 3 proposed, 1 accepted (EXP + SEL)          |
  | CEO plan             | written                                     |
  | Outside voice        | codex skipped (owner rule, D13)             |
  | Lake Score           | N/A (no coverage scored questions)          |
  | Diagrams produced    | 5 (architecture, data flow, error, user     |
  |                      | flow, sequence)                             |
  | Stale diagrams found | 0                                           |
  | Unresolved decisions | 0                                           |
  | Reality rows         | 7/7 rows (PLAN_REALITY), 1 unverified       |
  +====================================================================+
```

### Unresolved Decisions

None. Every question was answered (D1 to D13).

# Eng review (/plan-eng-review, 2026-10-22)

Target: docs/designs/reset-agent-memory.md (owner D14). Report file: this plan. CEO decisions D1 to D14 carry over unchanged.

## Eng scope record

feature answers: none proposed (no cuts); structure: Original arrangement, auto chosen under the owner's standing rule (never ask file or module layout; pick the recommended one): `src/main/memoryReset.ts` new beside `factoryReset.ts`, so the full reset's module and its list test stay unchanged; accepted scope: the CEO plan as approved (R1, E3, R2 B, R3 A, R4 A, R5 A, R6 B, R7 B); pending remedies: R8.
Scope Challenge result: scope accepted as-is. Complexity: about 14 changed files [estimated], 1 new module, no new classes.

## Eng decision ledger

### R8: Michael's messages with the owner under R6
Finding: 1, P1, confidence 9/10, src/main/hive.ts:4745 and :4431-4432, eng review (Claude)
Plan baseline: R6 (D10, B): delete every member's inbox/.done and outbox/.sent; accepted cost named as reply tracking and Pulse counts.
Runtime evidence: the owner's dock conversation takes Michael's replies from his outbox/.sent (`ownerDockRaw`, hive.ts:4745: `const fromMichael = this.ownerMessages(join(godDir, 'outbox', '.sent'))`); open owner requests are rebuilt from his inbox/.done and outbox/.sent (`refreshOwnerRequests`, hive.ts:4431-4432). The owner's own sent messages live in agents/human (kept).
Comparison grid:

| Commitment | Current (R6 as approved) | A | B |
|---|---|---|---|
| Members' handled messages with each other | deleted | deleted | deleted |
| Handled messages to or from the owner (Michael's dock thread, open requests) | deleted | kept | deleted |
| Owner's dock after the reset | only the owner's own lines; Michael's replies gone | unchanged | only the owner's own lines |
| Open owner requests Michael must close | lost; Michael never closes them | kept | lost |
| Other R6, R1 to R7 values | as approved | unchanged | unchanged |

Question D15:
D15 — R8: Clearing handled messages also erases Michael's side of your conversation with him. Keep messages with you?
Project/branch/task: eng review of the Settings memory reset plan on mit/1-1-scroll-expanded-response-f89475; R6 approved clearing every member's handled messages.
ELI10: Your conversation with Michael in the dock shows his replies by reading his handled messages, and the app tracks what you asked him that he still has to close from the same folders. R6 as approved deletes them for every member, Michael too. After the reset your dock would show only your own lines, and anything you asked Michael that is still open would be forgotten, so he never closes it. The R6 question didn't mention this.
Stakes if we pick wrong: your history with Michael and your open requests vanish, or members keep a few old messages that involve you.
Recommendation: A because those messages are your record and your open requests, not a member's memory, and keeping them costs one filter.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Keep messages to or from you (recommended)
  ✅ Your dock history with Michael and your open requests survive the reset.
  ✅ Everything else in R6 still goes: members' handled messages with each other are deleted.
  ❌ Michael can still reread what you and he said before the reset.
B) Delete them too, as R6 says
  ✅ Michael has nothing old to reread, closer to a true first day.
  ❌ Your dock loses Michael's replies, and open requests you made are lost for good.
Net: keep your own record and open requests; clear only members' messages with each other.
Header: Your messages
Options:
A) Keep messages to or from you (recommended)
R6 deletes handled messages except those from or to the owner, so Michael's replies in your dock and your open requests stay. Effort S (human ~1 hour / CC ~5 min), risk low.
B) Delete them too, as R6 says
Delete every handled message, yours with Michael included; the dock keeps only your own lines and open requests are lost. Effort S (zero extra work), risk medium.

State: approved
Actual answer: B, "Delete them too, as R6 says" (owner answer to D15, 2026-10-22), over the recommended A
Accepted scope: no change to R6: every handled message is deleted, messages to or from the owner included. Accepted cost: after the reset the owner's dock shows only the owner's own lines (Michael's earlier replies are gone) and open owner requests are no longer tracked. The confirm says the conversation with Michael starts over
History: none

Approval readiness: PASS (R8, D15 B; CEO rows R1 to R7, E1 to E3 carried over with their answers D1 to D14)

## Eng Section 1: Architecture

`[P1] (confidence: 9/10) src/main/hive.ts:4745 — R6 deletes Michael's outbox/.sent, which the owner's dock reads for Michael's replies; open owner requests come from his inbox/.done (:4431-4432).`
`[P2] (confidence: 8/10) src/main/memoryTidy.ts:114-116 — stop() only clears the timer ("if (this.timer) { clearInterval(this.timer); this.timer = null; }"); an in-flight pass writes memory.md from main process code after its model call returns.`
`[P2] (confidence: 8/10) src/main/hive.ts:1799 — recordSession returns early when the registry already holds the id ("if (!agent || agent.sessionId === sessionId) return;"); the registry is member writable, so the R5 private record cannot hang off that check.`
`[P3] (confidence: 8/10) src/main/pty.ts:828 — killAll() is synchronous and does not wait for exits; the plan's "wait up to 5 s" has nothing to await yet.`

Dispositions:
- 1: R8, D15 B, approved as decided (dock and open requests start over; the confirm says so).
- 2: implementation of the approved Section 1 fix (CEO, R1 stakes): a halt flag on MemoryTidy, set before the erase and checked right before any memory.md or procedure write, so a pass that returns late writes nothing. Deterministic, replaces "await the pass".
- 3: implementation of R5: the private record appends when the authenticated frame's session id differs from the last id recorded for that member in the record itself (an in-memory map seeded from the file), never from the registry.
- 4: implementation of the approved step 2: poll `ptyManager.list()` every 100 ms until empty, up to 5 s; members still listed go in the log row.

## Eng Section 2: Code quality

No issues found beyond Section 1. The stop list becomes one helper used by both resets (removes a copy of 17 calls, index.ts:6525-6543). R2's repository key uses `git rev-parse --show-toplevel` per member working folder with a 2 s timeout, falling back to the folder itself.
Dispositions: none needed.

## Eng Section 3: Tests

```
CODE PATHS                                              USER FLOWS
[+] src/main/memoryReset.ts (new)                       [+] Settings ▸ Reset memory
  ├── collectIds(db rows, private record)                 ├── [GAP] confirm, then relaunch      [→E2E manual, T7]
  │   ├── [GAP] office filter, bad ids dropped            ├── [GAP] Cancel / Escape runs nothing
  │   └── [GAP] log and registry never read               └── [GAP] busy: double click ignored
  ├── workingFolders(roster, desk)
  │   └── [GAP] registry cwd ignored                     [+] After the relaunch
  ├── autoMemoryKey(folder)                               ├── [GAP] each member new conversation  [→E2E manual]
  │   └── [GAP] repo root for subfolder and worktree      └── [GAP] dock shows only owner lines (R8)
  └── targets(...)
      ├── [GAP] notes, backups, handled msgs listed       Windows: [GAP] EBUSY leaves item listed
      ├── [GAP] waiting msgs, cards, identity untouched
      └── [GAP] owner session in same project folder kept
[+] hive.ts
  ├── recordSession → private record    [GAP] appends on change, not from registry
  ├── forgetSessions + log row          [GAP] sessionId gone; row has counts and failures
  └── bootstrap R3 untrack              [GAP] tracked notes untracked, files kept
[+] memoryTidy halt flag                [GAP] late pass writes nothing
[+] index.ts app:resetMemory            [GAP pin] flush, collect, close persist, erase order
COVERAGE: 0/19 paths tested today (new code)  |  all 19 planned below
```
Every GAP above becomes a test in test/memory-reset.test.cjs (unit, temp office), test/hive-git-ignore.test.cjs (R3) or a wiring pin, as listed in Section 6 of the CEO review; the two [→E2E manual] rows are T7 (Demo Mac user). REGRESSION: Reset & start over must behave exactly as before after its stop list moves into the shared helper: the existing test/factory-reset.test.cjs stays green and a pin checks app:resetAll still archives the roster, erases the office and resets config.
Dispositions: required proof of approved behavior; no new choices.

## Eng Section 4: Performance

No issues found: one indexed query (idx_te_office_kind_ts), at most ~20 members each with a few project keys and one 2 s bounded git call, and file deletes. Scale: seconds on a large office [estimated].

## Outside voice (eng)

Skipped under the owner's standing rule that Codex is used only for the adversarial code pass (same as D13 in the CEO review). Recorded as skipped, not clean.

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|------|----------------|------------|
| R5 private record, R3 untrack | src/main (hive) | — |
| memoryReset pure module and tests | src/main (new module), test/ | — |
| app:resetMemory sequence, tidy halt | src/main (index, memoryTidy), src/preload | the two steps above |
| Settings button and confirm | src/renderer, locales | app:resetMemory |
Lane A: R5 and R3 (hive). Lane B: memoryReset module and tests. Then C: wiring. Then D: UI. Launch A and B, merge both, then C, then D. Conflict flag: A and C both touch src/main/hive.ts call sites only through index.ts; keep hive.ts edits in A.

## Eng failure modes

Critical gaps: 1, carried from the CEO review and owner accepted (R7, D12): a failed registry write leaves members resuming old conversations with nothing on screen. No new critical gap.

## Eng NOT in scope

Unchanged from the CEO review's list, plus: an owner visible outcome note (R7, D12) stays out; keeping the owner's messages with Michael (R8 A) was declined (D15).

## Eng what already exists

As in the CEO review's list; the eng review adds `ptyManager.list()` (src/main/pty.ts:791) for the exit wait and `VALID_SESSION_ID` (src/main/transcript.ts:95) for id checks.

## Eng implementation tasks (refine the CEO tasks T1 to T7)

- [ ] **T1a (P1, human: ~1h / CC: ~5min)** — hive — private record appends on a changed authenticated session id, from its own map, never the registry check
  - Surfaced by: Eng Section 1, finding 3 (hive.ts:1799)
  - Files: src/main/hive.ts
  - Verify: test "a registry edit does not change what the private record holds"
- [ ] **T4a (P1, human: ~1h / CC: ~10min)** — memoryTidy — halt flag set before the erase, checked before every write
  - Surfaced by: Eng Section 1, finding 2 (memoryTidy.ts:114-116)
  - Files: src/main/memoryTidy.ts
  - Verify: test "a tidy pass that returns after halt writes nothing"
- [ ] **T4b (P1, human: ~30min / CC: ~5min)** — main — poll ptyManager.list() up to 5 s after killAll
  - Surfaced by: Eng Section 1, finding 4 (pty.ts:828)
  - Files: src/main/index.ts
  - Verify: wiring pin; members still listed appear in the log row
- [ ] **T4c (P1, human: ~30min / CC: ~5min)** — tests — Reset & start over unchanged after the shared stop helper
  - Surfaced by: Eng Section 3 regression rule
  - Files: test/factory-reset.test.cjs
  - Verify: existing tests green plus a pin that app:resetAll still archives the roster, erases the office and resets config
- [ ] **T5a (P1, human: ~15min / CC: ~2min)** — copy — the confirm says the conversation with Michael starts over (R8)
  - Surfaced by: R8, D15
  - Files: src/renderer/src/i18n/locales/en.json, ar.json, zh-CN.json
  - Verify: locale tests

## Eng reality rows

REALITY: premise-table pass eng claims carry receipts (hive.ts:4745, :4431-4432, :1799; memoryTidy.ts:114-116; pty.ts:828); unverified=0 src/main/hive.ts:4745
REALITY: already-done pass nothing on origin/main implements a memory reset (checked in the CEO review, same day) src/main/index.ts:6522
REALITY: surface-check pass no CLI or route named; IPC names checked against index.ts src/main/index.ts:6522
REALITY: binding-decisions pass owner rules applied: no layout questions (structure auto chosen), Codex only for code (outside voice skipped), D1 to D15 src/main/factoryReset.ts:1
REALITY: numbers pass 14 files and effort tagged [estimated]; 19 planned test paths counted from the coverage diagram docs/designs/reset-agent-memory.md:234
REALITY: deferred-asks pass no linked issue src/main/index.ts:6522
REALITY: pr-count pass one change on the running branch src/main/index.ts:6522

## Eng completion summary

- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 applicable rows emitted, 0 unverified premises
- Architecture Review: 4 issues found
- Code Quality Review: 0 issues found
- Test Review: diagram produced, 19 gaps identified (all planned as tests; 2 manual)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user (R4's TODO already added by the CEO review)
- Failure modes: 1 critical gaps flagged (owner accepted, R7)
- Unresolved decisions: 0 in this review
- Outside voice: codex, skipped (owner rule: Codex only for the adversarial code pass)
- Parallelization: 4 lanes, 2 parallel / 2 sequential
- Lake Score: N/A (no answers scored for Completeness)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | ISSUES OPEN | 3 proposals, 1 accepted, 0 deferred; 1 critical gap accepted by the owner (R7) |
| Outside Review | Codex (CEO and Eng outside voice) | Independent 2nd opinion | 2 | skipped | skipped by the owner's Codex rule (D13); no completed external review |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 23 issues, 1 critical gaps (owner accepted) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 for this plan | — | not run for this plan |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review (CEO and Eng), skipped by the owner's rule, no findings; three in-host spec reviews in the CEO phase are not outside coverage.
- **VERDICT:** no review is CLEAR: every decision is answered and every finding has a task, but one owner accepted critical gap keeps CEO and Eng at ISSUES OPEN; ready to implement on the owner's acceptance.

NO UNRESOLVED DECISIONS
