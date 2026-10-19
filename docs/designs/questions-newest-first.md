# Questions newest first on Task detail

Owner, 2026-10-12, from the See full context dialog on an Ask me card: "the context
window entries need to reverse so that newest entry is on the top."

Mockup: `~/.gstack/projects/agentvivekkumar-dontbemichael/designs/questions-newest-first-20261012/mockup.html`
(Today, A order only, B order plus time; B approved).

## What changes

Task detail (TaskDetailOverlay, `src/renderer/src/components/TasksKanban.tsx:481`,
DESIGN.md 7.21) lists the card's QUESTIONS oldest first today, so the open
"Waiting for you" question sits at the bottom and the owner scrolls past every old
answer to reach it.

1. **Newest first.** The QUESTIONS list shows the card's `humanQA` entries in reverse of
   their order in the ledger. Agents append each new ask ("push", "keeping earlier
   entries"), so the ledger order is the order they were asked. It does not sort by
   `askedAt`: agents write that field, and a missing or malformed time would scramble
   the list. This matches Ask me, where cards already stack newest first (7.8).
2. **When it was asked (D1, owner chose B).** Each question's top row reads
   `Question  5d ago` with the existing `askedAgo` helper (`askHeadline.ts:58`), in the same
   style as the time on Ask me cards: 11 px, `ink-3`, after the word Question and
   before the "Waiting for you" pill. No `askedAt`, or one that does not parse, shows
   no time (askedAgo returns empty), and the row stays as today.
3. **Unchanged:** each answer stays under its own question; open, answered, withdrawn
   and report entries keep their look; the section order of the dialog (facts, result,
   description, next, questions, dependencies) stays the same.

```
QUESTIONS
+--------------------------------------------------+
| Question  2h ago              [Waiting for you]  |  coral soft, the open one
| How should we handle GreenWorld...               |
+--------------------------------------------------+
| Question  5d ago                                 |
| Two yes or no calls on Dennis Sanders...         |
| ----------------------------------------------   |
| Answer  1                                        |
+--------------------------------------------------+
| Question  12d ago                                |
| Send Dennis a short nudge?...                    |
| Answer  if i remember vikram responded...        |
+--------------------------------------------------+
```

## Review

| Pass | Before | After | Notes |
|------|--------|-------|-------|
| 1 Information architecture | 6 | 9 | The open question is the first thing in the list; a question still comes before its answer |
| 2 States | 8 | 9 | No questions: no section (today). One question: unchanged. No time: no time shown |
| 3 Journey | 6 | 9 | See full context opens at the top, on the question that waits |
| 4 AI slop | 9 | 9 | App UI, the existing question box; nothing new on screen but one grey time |
| 5 Design system | 7 | 9 | Reuses the Ask me time style; DESIGN.md 7.21 and 18 get updated |
| 6 Accessibility | 8 | 9 | Screen readers follow the visual order (newest first); the time is plain text in the row |
| 7 Decisions | | | 1 resolved (D1), 0 deferred |

Behavior changes for agents: none. This changes only how the app shows a card's
questions; agents still append to `humanQA` as before.

## NOT in scope

- Sorting by `askedAt`: the order agents append in is the asked order, and agent written times can be missing.
- Moving QUESTIONS above DESCRIPTION: with the open question first in its section, the
  short description above it does not hide it.
- A full date on hover: Ask me's time has none; keep them the same.
- When a question was answered (`answeredAt`): not asked for, and it would add a second
  time to every answered box.

## What already exists

- `askedAgo` in `askHeadline.ts` (relative time in the app's language) and the Ask me
  time style at `AskMeTab.tsx:270`.
- The question box (coral soft when open, the Waiting for you pill) in `TasksKanban.tsx`.
- DESIGN.md 7.8 (Ask me stacks newest first) and 7.21 (Task detail).

## TODOS.md updates

None.

## Implementation Tasks

- [ ] **T1 (P1, human: ~1h / CC: ~10min)**: TasksKanban: show QUESTIONS newest first with each question's time
  - Surfaced by: the owner's request and D1
  - Files: `src/renderer/src/components/TasksKanban.tsx` (map over the entries in reverse,
    keeping each entry's ledger index as its key; add the `askedAgo` span to the top row)
  - Verify: a test that a three question card renders the newest first and shows the
    time, and that an entry with no `askedAt` shows no time; the full suite and typecheck
- [ ] **T2 (P2, human: ~15min / CC: ~3min)**: DESIGN.md: 7.21 QUESTIONS reads "newest first, each with when it was asked", plus a section 18 row
  - Surfaced by: Pass 5
  - Files: `branding/DESIGN.md`
  - Verify: read back

## Eng review (2026-10-12)

Target: this plan. Scope Challenge: scope accepted as-is (4 files, no new classes or
services: TasksKanban.tsx, DESIGN.md, one test file, no main process change).

### Premises

| Premise | Receipt | Verdict |
|---|---|---|
| Agents append asks in asked order | `hive.ts:352` "add ... to its humanQA list, keeping earlier entries"; `hive.ts:1918` "push {"q":...}" | true |
| Ask me stacks newest first | `DESIGN.md:550` "Cards stack newest first (§7.8, §7.9)" | true |
| askedAgo shows nothing for a missing or bad time | `askHeadline.ts:59-61` `if (!iso) return ''` / `if (Number.isNaN(at)) return ''`; tested at `test/askme-card.test.cjs:28` | true |
| The list is keyed by position today | `TasksKanban.tsx:484` `task.humanQA!.map((e, i) => {` with `key={i}` | true |
| No React render harness in the tests | no `renderToStaticMarkup` or `react-dom/server` under `test/`; UI tests assert source (`test/link-names.test.cjs`, `test/askme-card.test.cjs:188`) | true |

unverified=0. No commit on origin/main touched TasksKanban.tsx since the ask.

### Sections

- **Architecture:** no issues found. Renderer only; no data, IPC or agent rule changes.
- **Code quality:** no issues found. The plan already keeps each entry's ledger index as
  its React key, so appending a question does not shift every key. It reuses `askedAgo`
  and the Ask me time style. Withdrawn and report entries go through the same map.
- **Tests:** one factual correction to T1's Verify line. The repo has no render harness,
  so "renders the newest first" is checked the way other UI tests here are (a source
  assertion), and the no-time case is already covered by `askedAgo`'s own test.
- **Performance:** no issues found. One reversed copy of a short array per open dialog.

```
TaskDetailOverlay
  task.humanQA (ledger order, oldest first)
    -> pairs [entry, ledger index], reversed  (newest first; key = ledger index)
    -> per entry: "Question" + askedAgo(e.askedAt)  ('' when missing or bad: no span)
                  + pill when open  -> FileText(q) -> answer | withdrawn | nothing
```

Coverage:
```
[+] TasksKanban.tsx QUESTIONS
  ├── [GAP -> T1 test] order is newest first, key is the ledger index
  ├── [GAP -> T1 test] the time span uses askedAgo with askedAt
  └── [★★★ TESTED] askedAgo empty for missing/bad time, steps, clamp — askme-card.test.cjs:26-28, :149
```

Failure modes: an agent writes asks out of order, so the list follows the ledger, not the
times. It can't fail silently in a way that loses data, because every entry still shows.
No critical gaps.

Outside voice: skipped. By the owner's rule (2026-10-01), Codex runs only for adversarial
passes, with no Claude subagent in its place.

Parallelization: sequential implementation, with no opportunity to parallelize.

### Implementation Tasks (after eng review)

T1 and T2 above stand. T1's Verify now reads: add a test to `test/askme-card.test.cjs`
(or a new `test/task-detail-questions.test.cjs`) with the card
`Value: protects=the open question is first on Task detail and each question says when it was asked; fails_when=the reverse, the ledger index key or the askedAgo span is dropped; why_new=no test covers the Q and A list order; seam=none; no_claim=pixel layout (source assertion, no render harness)`.
Then run typecheck and `node --test --test-concurrency=4 test/`.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | | |
| Outside Review | none | Independent 2nd opinion | 0 | skipped | Codex is for adversarial passes only (owner, 2026-10-01) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 0 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score: 4/10 → 9/10, 1 decision |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | | |

- **OUTSIDE COVERAGE:** design and plan outside voices skipped by the owner's rule (Codex is for adversarial passes only); no outside coverage.
- **VERDICT:** DESIGN + ENG CLEARED. Ready to implement.

NO UNRESOLVED DECISIONS
