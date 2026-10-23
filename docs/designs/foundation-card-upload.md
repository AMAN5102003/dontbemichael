# Add a file from a Company foundations card

Status: plan, eng review 2026-10-22. Builds on `docs/designs/office-foundations.md` (shipped in 0.2.4).

## The ask

Owner, 2026-10-22, with a screenshot of the "How we sound (brand voice)" card Ryan raised:

> this is working as expected and ryan correctly flagged missing brand voice, however, asking
> the file name could be tricky for the business owner. allow to upload right from the ask me card

Today the card's hint says "A few plain sentences, under 300 characters. For more, name the file
that holds it." A brand voice, a price list or a returns policy is usually a document the owner
already has. Typing its file name (and knowing where it lives) is the hard part. The owner wants to
pick the file on the card itself.

## What exists

- **The card**: `src/renderer/src/components/FoundationCard.tsx`. One answer box capped at
  `FOUNDATION_CAP` (300, `src/shared/foundations.ts:87`), Save answer, Have the member draft it,
  Not now. Save answers the Ask me card first (`onAnswer`, so Michael closes it), then writes the
  foundations through `window.cth.foundationsAnswer(id, text)` (`FoundationCard.tsx:77-89`); if that
  write fails, Michael is asked to add it.
- **The owner's write**: `Foundations.ownerAnswer` (`src/main/foundations.ts:262`) stores
  `{ text, by: 'owner', source: 'owner', at }`, syncs the company profile and republishes the
  document. `FoundationAnswer` already has an optional `ref` ("the message id or file path behind
  it", `src/shared/foundations.ts:159`) that owner answers never set today.
- **Company knowledge**: `knowledge.ingestFile(srcPath, { title, tags })` (`src/main/knowledge.ts:164`)
  reads Word, Excel, PowerPoint, PDF, images and text, keeps the original file, and throws a plain
  reason for a file it can't read. `kg:addFiles` and `kg:ingestFiles` wrap it for Settings
  (`src/main/index.ts:6355-6378`); a successful add calls `memory.companyKnowledgeChanged()` so
  search by meaning indexes it. The owner can open and edit any document from Settings (0.2.4).
- **Members reading it**: every member's prompt says how to `search`, `list` and `get <id>` a whole
  company knowledge document (`companyKnowledgeLine`, `src/main/hive.ts:292-299`). The foundations
  document reaches each member with its job's section (`office-foundations.md` section 5).
- **Pickers**: `dialog:attachFiles` (`src/main/index.ts:6402`) and `kg:addFiles` open the OS picker;
  `window.cth.pathForFile` gives a dropped file's path (`src/preload/index.ts:1170`).
- **Reserved tag**: `FOUNDATIONS_TAG = 'foundations'` marks the foundations document's own read
  only copy (`isFoundationsDoc`, `src/shared/foundations.ts:90-95`). A file the owner adds must not
  carry that tag, or Settings would open it read only and the publisher could treat it as the copy.

## The plan

```
 Card (renderer)                         Main
 ───────────────                         ────
 [Add a file] ─► foundations:pickFile ─► OS picker (one file) ─► { path, name }
 drop a file  ─► pathForFile(file) ────────────────────────────► { path, name }
      │  chip: "Brand voice.pdf  ×"   (Save answer enabled with a file, words optional)
      ▼
 Save answer
  1. onAnswer(words + "I added Brand voice.pdf to company knowledge for this.")
       └─ card not taken ─► "Couldn't save, try again." (nothing added)
  2. foundations:answerFile(id, path, words) ──► knowledge.ingestFile(path, { title: name,
                                                   tags: ['foundation-file', id] })
                                                   ├─ unreadable ─► { ok:false, error:'unreadable', reason }
                                                   └─ ok ─► docId
                                                 ownerAnswer text = words (trimmed to fit) +
                                                   "Full version: company knowledge document <docId> (<name>)"
                                                 answer { by:'owner', source:'owner', ref:'kg:<docId>' }
                                                 companyKnowledgeChanged(); publishSoon()
       ├─ ok ─► onSaved('saved')
       └─ fails ─► Michael asked to add it, naming the file's path (today's fallback)
```

1. **Add a file on the card.** A quiet "Add a file" button beside the hint, and dropping a file on
   the card, both pick one file. The card shows it as a chip with its name and a remove control.
   The hint loses "For more, name the file that holds it" and reads "A few plain sentences, under
   300 characters, or add a file." Save answer is enabled by words, a file, or both.
2. **Save with a file.** The card is answered first, as today, with the owner's words and a line
   naming the file, so Michael closes it. Then one main call adds the file to company knowledge
   and writes the owner's answer: the owner's words (cut to fit) plus "Full version: company
   knowledge document <id> (<file name>)", with `ref: 'kg:<id>'`. The owner's answer wins, as
   every owner answer does.
3. **When it fails.** A file company knowledge can't read is refused before anything is written,
   and the card says so by name ("Couldn't read Brand voice.pages: <reason>"); the owner can pick
   another. Any other failure after the card was answered uses today's fallback: Michael is asked
   to add the answer, with the file's path.
4. **Members.** No new instruction: the foundations line names the document id, and members
   already know `get <id>`.
5. **Copy** in en, ar and zh-CN, no dashes, short (owner rules: less verbose UI, no dashes).

## NOT in scope (proposed)

- Ordinary Ask me cards (a member's question in Needs you) taking a file. See decision R1.
- More than one file per answer.
- Replacing an answered question's file from the card (answered questions leave Needs you; the
  owner edits the document in Settings).

## Tests (proposed)

- `test/foundations.test.cjs` (extend): `answerFile` ingests with the `foundation-file` tag and
  never `foundations`, writes `ref`, keeps the owner's words within the cap, refuses an unreadable
  file with nothing written, refuses an unknown question or no office.
- `test/foundations.test.cjs` card test (`:429`, extend): Save is enabled by a file alone; the Ask
  me reply names the file; the hint copy has no "name the file".
- Locale keys present in all three languages; no dashes (existing suites).
</content>
</invoke>

---

# Eng review (2026-10-22)

Target: this plan, `docs/designs/foundation-card-upload.md` (drafted in this review from the owner's
ask above; the text above this line is the original plan). Report file: this file.

## Scope Challenge

**What already solves it:** company knowledge ingest keeps the original and reads Word, Excel,
PowerPoint, PDF, images and text (`src/main/knowledge.ts:164-173`); `kg:remove` deletes a document
(`src/main/index.ts:6348`); the OS picker pattern (`src/main/index.ts:6366-6378`); dropped file
paths (`src/preload/index.ts:1170`); the answer's unused `ref` field (`src/shared/foundations.ts:159`);
members' `get <id>` (`src/main/hive.ts:298`). Nothing new is built for reading files.

**Minimum change:** the card UI, one picker call and one main call that adds the file and writes the
answer. Drag and drop rides on the same main call.

**Complexity:** 8 files [estimated]: `FoundationCard.tsx`, `src/main/foundations.ts`,
`src/main/index.ts`, `src/preload/index.ts`, three locale files, `test/foundations.test.cjs`; no new
classes or services. The gate trips at 8 files.

**Search check:** no new architectural pattern, infrastructure or concurrency (an Electron picker and
the existing ingest). Skipped.

**TODOS:** nothing in `TODOS.md` blocks this; the two Company foundations items (`TODOS.md:181`,
`:199`) are unrelated.

**Distribution:** no new artifact.

Scope record: feature answers: none proposed (no cuts); structure: Original arrangement, auto chosen
under the owner's standing rule (never ask file or module layout choices; pick the recommended one);
accepted scope: the plan above; pending remedies: R1, R2, R3.

Findings:
1. [P2] (confidence: 8/10) owner ask (top of this file) — "the ask me card": the screenshot is a
   Company foundations card, but ordinary Ask me cards (a member's own question) take no file either
   (`AskMeTab.tsx`, `AskAnswerFields.tsx`: no picker or drop handler). Scope choice, R1.
2. [P2] (confidence: 8/10) plan step 2 — where the file lives decides who can read it and where the
   owner finds it later. R2.
3. [P1] (confidence: 9/10) plan diagram steps 1 and 2 vs step 3 — the card is answered before the
   file is read, yet step 3 promises an unreadable file is refused before anything is written. As
   drawn, Michael is told "I added Brand voice.pdf" and closes the card, then the file can't be read.
   R3.
4. [P2] (confidence: 9/10) `src/shared/foundations.ts:90-95` — `FOUNDATIONS_TAG` marks the foundations
   copy; an added file must not carry it. The plan already tags `foundation-file`; a test pins it.
   Factual, no question.

REALITY: premise-table pass 9 premises, unverified=0 src/main/knowledge.ts:164
REALITY: already-done pass no upload on the card on origin/main or open PRs src/renderer/src/components/FoundationCard.tsx:1
REALITY: surface-check pass kg:remove, kg:addFiles, dialog:attachFiles, pathForFile exist src/main/index.ts:6348
REALITY: binding-decisions pass foundations eng review 2026-10-20: owner answer wins, one line, cap 300 kept src/main/foundations.ts:261
REALITY: numbers pass cap 300 measured, 8 files estimated src/shared/foundations.ts:87
REALITY: deferred-asks pass no linked issue docs/designs/foundation-card-upload.md:7
REALITY: pr-count pass one change on the running branch, lands with the next release docs/designs/foundation-card-upload.md:1

Scope Challenge result: scope accepted as-is, with the owner's additions (D1 A, D2 A, D3 A plus the fit check R4, D4 A, D5 A). Finding 4 is carried into the build (factual).

## 1. Architecture review

```
 FoundationCard (renderer)          preload              main
 ─────────────────────────          ───────              ────
 Add a file / drop ──────────────► foundationsPickFile ─► OS picker (one file) ──► { path, name } | cancelled
 chip [Brand voice.pdf ×]
 Save ─────────────────────────────► foundationsAddFile(id, path)
   busy: "Checking the file"           │  knowledge.read(path)            (once; own process; 100 MB cap)
                                       │    ├─ unreadable ─► { error:'unreadable', reason }      ─► card line, nothing done
                                       │    └─ text | passthrough (first part read as UTF-8)
                                       │  fileFitCheck(question, jobs, name, text slice)   (standing check runner)
                                       │    ├─ NO: reason ─► { error:'misfit', reason }          ─► card line, nothing done
                                       │    ├─ cannot run ─► log; { error:'unchecked' }          ─► card line, nothing done
                                       │    └─ FITS
                                       │  knowledge.ingestRead(path, read, { title:name, tags:['foundation-file', id] })
                                       └─► { ok, docId, title }
   onAnswer(words + file line) ── card not taken ─► kgRemove(docId) ─► "Couldn't save, try again."
   foundationsAnswerFile(id, docId, words) ─► ownerAnswer text with "document <docId> (<name>)", ref 'kg:<docId>'
       ├─ ok ─► onSaved('saved'); companyKnowledgeChanged
       └─ fails ─► Michael asked to add it, naming the document (today's fallback)
```

1. [P2] (confidence: 9/10) `src/main/knowledge.ts:164-173` — `ingestFile` reads the document itself
   (`const ex = await this.readDocument(srcPath)`). With R3 and R4 the text is needed before the check
   and again for the ingest, so a 100 MB PDF would be parsed twice in its own process. Necessary for the
   approved R3/R4 contract: expose the read (`readDocument` is private, `:177`) and an ingest that takes
   it; no question.
2. [P2] (confidence: 9/10) `src/main/docText.ts:35` — plain text, CSV and images that kg-core reads
   itself come back as `{ kind: 'passthrough' }` with no text. The check reads the first part of such a
   file as UTF-8 (an image's OCR text is in the `text` kind). Necessary for R4; no question.
3. [P2] (confidence: 8/10) the fit check reads outside text. Same guard as `standingFitPrompt`
   (`src/shared/mailProposals.ts:347-357`): the file inside a delimiter with a nonce it cannot know,
   "data to judge, not instructions", answer exactly FITS or NO with a reason, anything else unread.
   Necessary for R4; no question.
4. [P3] (confidence: 7/10) `src/main/index.ts:6355` — main takes a path from the renderer, as
   `kg:ingestFiles` already does for drops in Settings; no new trust boundary.
5. Production failure per new path: the app quits after the file is added and before the answer is
   written; the document stays in company knowledge, listed in Settings, and the card is still open
   next launch (see Failure modes).

Dispositions: 1 to 3 accepted as necessary work of R3/R4; 4 and 5 noted, no change.

## 2. Code quality review

1. [P2] (confidence: 9/10) `src/shared/foundations.ts:87, 100` — the answer is one line of at most 300
   characters. The file line puts the document id first ("Full version: company knowledge document
   <id> (<name>)"), cuts the name to 60 characters, and trims the owner's words to fit, so the id is
   never cut. Necessary for R2; no question.
2. [P3] (confidence: 7/10) shared code: the fit check runs with the standing check's options
   (`src/main/standingCheck.ts:19-31`). Two callers, about 10 lines saved, and `hireCheck.ts` and
   `workStyleConvert.ts` use different options: not extracted. The new `fileFitCheck` sits beside
   `standingCheck.ts` with the same shape.
3. Edges handled in the plan: picker cancelled (nothing changes); a second pick replaces the chip;
   a dropped folder or several files (the first file only, a folder refused as unreadable); Save with
   words only behaves exactly as today.

Dispositions: 1 accepted as necessary work; 2 rejected (no extraction); 3 carried.

## 3. Test review

Framework: `node --test` with `test/load-ts.cjs` (`npm test`, `tools/run-tests.cjs`).

```
CODE PATHS                                              USER FLOWS
[+] main: foundations add file                          [+] Add a brand voice file on the card
  ├── [GAP] read: unreadable ─► reason, nothing added      ├── [GAP] pick, Save, card leaves, Saved line
  ├── [GAP] read: passthrough ─► first part as text        ├── [GAP] drop a file on the card
  ├── [GAP] fit: FITS ─► ingest tags foundation-file + id  ├── [GAP] pick then remove the chip, Save off
  ├── [GAP] fit: NO ─► misfit reason, nothing added        └── [GAP] words and a file together
  ├── [GAP] fit: cannot run / unread ─► unchecked, logged [+] Error states
  └── [GAP] never the `foundations` tag                    ├── [GAP] unreadable file named on the card
[+] main: answer with file                                 ├── [GAP] misfit reason on the card, file kept off
  ├── [GAP] ref kg:<id>, owner wins, profile sync          ├── [GAP] "Couldn't check this file, try again"
  ├── [GAP] long words and long name keep the id           └── [GAP] card not taken ─► document removed
  └── [★★ TESTED] words only (ownerAnswer) foundations.test.cjs:96
[+] fit prompt                                          [+] Regression
  ├── [GAP] nonce delimiter, question and jobs named       └── [★★ TESTED] Save with words only, card pins
  └── [GAP] parse FITS / NO: reason / other ─► unread           foundations.test.cjs:429
LLM: [GAP] [→EVAL] the fit check tells a brand voice from a financial statement (R5)
COVERAGE: 2/20 paths tested | GAPS: 18 (1 eval)
```

Regression contract: Save with words only keeps today's order and messages (`FoundationCard.tsx:72-92`);
existing tests `foundations.test.cjs:96` and `:429` stay green unchanged.

Proposed tests (all in `test/foundations.test.cjs`, unit, seams: injected read, check and ingest):
- add file, happy path and tags.
  Value: protects=a fitting file is added once with foundation-file and its question id; fails_when=it is tagged foundations or read twice; why_new=new path; seam=injected deps; no_claim=the real model's judgment
- add file, refusals (unreadable, misfit, cannot run, unread reply): nothing ingested, reason returned, cannot run logged.
  Value: protects=no unchecked or wrong file becomes company knowledge; fails_when=a refusal still ingests or a reply other than FITS passes; why_new=R4, R4a, R4b; seam=injected deps; no_claim=the real model
- answer with file: ref, cap, id never cut, owner wins, profile sync.
  Value: protects=members get the id to read the whole file; fails_when=a long name or words push the id out of the 300 cap; why_new=new answer shape; seam=none; no_claim=none beyond protects
- fit prompt shape and parser.
  Value: protects=the file can't steer the check; fails_when=the delimiter or the strict FITS/NO parse is lost; why_new=new prompt; seam=none; no_claim=model quality (R5)
- card pins (extend `:429`): Add a file, drop, chip, busy line, Save enabled by a file, order add, card, answer, removal when the card is not taken, hint without "name the file", locale keys in three languages.
  Value: protects=the owner never types a path and a bad file never closes the card; fails_when=the order flips or the removal is dropped; why_new=new UI; seam=source pins (the card needs React); no_claim=real clicks (live check)

Tests made obsolete: none.

## 4. Performance review

1. [P3] (confidence: 8/10) `src/main/docText.ts:92` and `src/main/standingCheck.ts:14` — reading takes
   up to a few seconds in its own process (100 MB cap) and the check up to 60 s, so Save can wait. The
   card shows "Checking the file" and keeps Save off while it runs. Necessary UI for R4; no question.
2. The check sends a bounded slice: the file name, the question and the first 8,000 characters of
   text [estimated budget, about 2,000 tokens], once per Save. No loops, no new store.

Dispositions: 1 accepted as necessary work; 2 carried.

## Outside voice (Codex gpt-5.4, read only, owner D7 A)

```
CODEX SAYS (plan review — outside voice):
════════════════════════════════════════════════════════════
**Findings**

1. **High** — The plan’s file-backed owner answer shape will corrupt the company profile sync for `hours` and `fiscal_year`. `ownerAnswer()` currently treats the stored answer text as the authoritative owner text and immediately feeds it into `toProfile()`. For `hours`, that writes the first 200 chars verbatim; for `fiscal_year`, it reparses the month from the answer text. If the stored answer becomes `words + "Full version: company knowledge document <id> (...)"`, Settings/profile stop reflecting the real answer and start reflecting the link wrapper instead. [src/main/foundations.ts:64-77]( /Users/moblizeit/Documents/GitHub/personal/dontbemichael/.claude/worktrees/1-1-scroll-expanded-response-f89475/src/main/foundations.ts:64 ) [src/main/foundations.ts:253-269]( /Users/moblizeit/Documents/GitHub/personal/dontbemichael/.claude/worktrees/1-1-scroll-expanded-response-f89475/src/main/foundations.ts:253 )

2. **High** — “File alone, words optional” breaks the foundations model. Members are told foundations are the answers to follow, and only empty questions count as missing. A pointer like `company knowledge document <id>` makes the question non-empty, so gap reporting stops, but members still are not told to dereference embedded doc ids before acting. That turns foundations from inline operating context into a link farm without updating the agent contract. [src/shared/foundations.ts:85-87]( /Users/moblizeit/Documents/GitHub/personal/dontbemichael/.claude/worktrees/1-1-scroll-expanded-response-f89475/src/shared/foundations.ts:85 ) [src/shared/foundations.ts:267-276]( /Users/moblizeit/Documents/GitHub/personal/dontbemichael/.claude/worktrees/1-1-scroll-expanded-response-f89475/src/shared/foundations.ts:267 ) [src/main/hive.ts:448]( /Users/moblizeit/Documents/GitHub/personal/dontbemichael/.claude/worktrees/1-1-scroll-expanded-response-f89475/src/main/hive.ts:448 )

3. **Medium** — The fallback path cannot actually preserve the new `kg:` reference shape. The current Michael/manual foundations route only understands `source.owner`, `source.file`, or `source.confirmed`, and it derives `ref` only from an owner message id or a file path. There is no path here that can save `ref: 'kg:<docId>'` or even represent “owner answer backed by company knowledge doc.” So the plan’s “use today’s fallback” claim is false on the first write failure after ingest. [src/main/foundations.ts:318-341]( /Users/moblizeit/Documents/GitHub/personal/dontbemichael/.claude/worktrees/1-1-scroll-expanded-response-f89475/src/main/foundations.ts:318 ) [src/shared/foundations.ts:153-159]( /Users/moblizeit/Documents/GitHub/personal/dontbemichael/.claude/worktrees/1-1-scroll-expanded-response-f89475/src/shared/foundations.ts:153 )

4. **Medium** — The fit-check design will reject valid brand assets. `brand` is a first-class foundations question (“logo, colors, fonts”), but image ingest explicitly falls back to `passthrough` when OCR finds no text. A legitimate logo sheet or brand image with little/no OCR text is therefore not checkable as content, and under the accepted no-override rule it becomes unaddable from the card. The review noticed passthrough technically, but missed that this breaks an obvious use case of the feature. [src/shared/foundations.ts:50-51]( /Users/moblizeit/Documents/GitHub/personal/dontbemichael/.claude/worktrees/1-1-scroll-expanded-response-f89475/src/shared/foundations.ts:50 ) [src/main/docText.ts:408-419]( /Users/moblizeit/Documents/GitHub/personal/dontbemichael/.claude/worktrees/1-1-scroll-expanded-response-f89475/src/main/docText.ts:408 )

Recommendation: **Revise the plan before implementation** because the current design mixes three incompatible roles for one foundations answer field: inline answer, profile source of truth, and document pointer.
════════════════════════════════════════════════════════════
```

Verified against the code: all four hold. 1: `toProfile` takes the stored text (`src/main/foundations.ts:64-77, 253-258`). 2: members are told "Follow its answers" and nothing more (`src/main/hive.ts:448`). 3: the foundations route keeps `ref` only from an owner message id or a file path (`src/main/foundations.ts:339`). 4: a picture with no words reads as passthrough (`src/main/docText.ts:408-419`) and "How we look (logo, colors, fonts)" is a question (`src/shared/foundations.ts:51`).

Codex 3 is a correction, no question: when the answer write fails, Michael's message carries the exact answer line, document id included, so the reference survives in the text; `ref` is not kept on that path. Codex 1, 2 and 4 are R6, R7 and R8.

## Decision ledger

### R1: which cards take a file
Finding: 1, P2, 8/10, AskMeTab.tsx / AskAnswerFields.tsx (no picker), reviewer Claude
Plan baseline: Company foundations cards only (plan "NOT in scope")
Runtime evidence: no Ask me card takes a file today; ordinary cards route the owner's answer to the asking member through Michael (`src/shared/askMeRouting.ts`)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 cards that take a file | none | Company foundations cards | foundations cards, and every Ask me card (file sent by path to the asking member, like a message attachment) |
| R2 where a foundations file lives | pending | pending | pending |
| R3 order of save steps | pending | pending | pending |
Question D1:
D1 — Should only Company foundations cards take a file, or every Ask me card?
Project/branch/task: eng review of the card upload plan on mit/dock-scroll-follow (running branch).
ELI10: Your screenshot is a Company foundations card: its answer becomes a fact the whole team reads, so a file there belongs in company knowledge. Other Ask me cards are one member's own question, like "What discount can Acme get?"; the answer goes back to that member through Michael. A file on those cards would travel to that one member by its path, the way a file attached to a message does: a second path with its own checks.
Stakes if we pick wrong: with foundations only, answering a member's ordinary question with a document still means typing where it is.
Recommendation: A because it fixes the card you hit with one path; the other cards can get files in a change of their own.
Completeness: A=7/10, B=10/10
Pros / cons:
A) Foundations cards only (recommended)
  ✅ One path: the file goes to company knowledge, which the team already searches and you can open in Settings.
  ✅ Smaller change to ship and test (human: ~1 day / CC: ~30 min), with one place a file can go.
  ❌ An ordinary question answered with a document still needs its path typed in the answer box.
B) Every Ask me card
  ✅ Any card you answer can take a file, so you never type a path or file name anywhere in Needs you.
  ✅ Reuses how message attachments travel by path, so members already know how to read them.
  ❌ A second path to build and test (human: ~2 days / CC: ~1 hour), with its own question of which folders a member may read.
Net: one path now, or every card at once for about twice the work. <gstack-qid:plan-eng-review-card-upload-scope>
Header: Which cards
Options:
A) Foundations cards only (recommended)
Add a file on Company foundations cards; ordinary Ask me cards stay as they are.
B) Every Ask me card
Foundations cards add the file to company knowledge; every other Ask me card sends the file to the asking member by path.

State: approved
Actual answer: A, "Foundations cards only" (owner answer to D1, 2026-10-22)
Accepted scope: Company foundations cards take a file; ordinary Ask me cards are unchanged.
History: option A's description first promised a TODO for the other cards; removed before asking because TODOs get their own question


### R2: where a foundations file lives
Finding: 2, P2, 8/10, plan step 2, reviewer Claude
Plan baseline: company knowledge (plan step 2, as drafted; not approved)
Runtime evidence: company knowledge keeps the original and its text, lists it in Settings with Open (`src/main/knowledge.ts:164`, 0.2.4); members can `search`, `list` and `get <id>` (`src/main/hive.ts:298`); a file inside the office folders is also an accepted foundations source (`src/main/foundations.ts:359`)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 cards that take a file | approved: foundations cards (D1 A) | foundations cards | foundations cards |
| R2 where a foundations file lives | nowhere (no upload) | company knowledge document, tagged `foundation-file` and the question id; the answer names its id | a copy in the business folder under `Company foundations/`; the answer names its path |
| R3 order of save steps | pending | pending | pending |
Question D2:
D2 — Where should a file you add on a foundations card live?
Project/branch/task: eng review of the card upload plan on mit/dock-scroll-follow (running branch).
ELI10: When you add your brand voice file on the card, the app keeps a copy somewhere the team can read. Company knowledge is the shared library every member already searches; you see each document in Settings and can open and edit it there. The other choice is a plain copy in your business folder, which you see in Finder, and members open by its path; they can't search inside it.
Stakes if we pick wrong: in the folder, a member hunting for "tone" or "pricing" won't find the file by searching; in company knowledge, the file shows in the Settings list rather than in Finder.
Recommendation: A because the team already searches company knowledge and reads whole documents from it, and you can edit it in Settings.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Company knowledge (recommended)
  ✅ Members find it by searching, even for words that only mean the same thing, and read it whole by its id.
  ✅ You see it in Settings with Open, and an edit there is read in again, as for any document.
  ❌ It doesn't appear as a file in your business folder, so you won't see it in Finder.
B) Business folder
  ✅ A plain file in your business folder under Company foundations, easy to find in Finder.
  ✅ The answer names a path members already know how to open (human: ~1 day / CC: ~30 min, same as A).
  ❌ Members can't search inside it, and editing it in Settings isn't offered.
Net: searchable and editable in the app, or a plain file you see in Finder. <gstack-qid:plan-eng-review-card-upload-store>
Header: Where it lives
Options:
A) Company knowledge (recommended)
The file becomes a company knowledge document; the foundations answer names its id; you open and edit it in Settings.
B) Business folder
The file is copied into the business folder under Company foundations; the foundations answer names its path.

State: approved
Actual answer: A, "Company knowledge" (owner answer to D2, 2026-10-22)
Accepted scope: an added file becomes a company knowledge document tagged `foundation-file` and the question id (never `foundations`); the owner's answer names its id with `ref: 'kg:<id>'`; it shows in Settings with Open like any document.
History: none

### R3: order of the save steps
Finding: 3, P1, 9/10, plan diagram steps 1 and 2 vs step 3, reviewer Claude
Plan baseline: the card is answered first, then the file is read in (plan diagram, as drafted; not approved; it contradicts plan step 3)
Runtime evidence: Save answers the card first today so Michael closes it (`FoundationCard.tsx:76-81`); `ingestFile` throws a plain reason for an unreadable file (`src/main/knowledge.ts:166-167`); `kg:remove` deletes a document (`src/main/index.ts:6348`)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 cards that take a file | approved: foundations cards (D1 A) | foundations cards | foundations cards |
| R2 where the file lives | approved: company knowledge (D2 A) | company knowledge | company knowledge |
| R3 order of save steps | card first, then the foundations write (words only) | read the file in first; an unreadable file stops there with its reason and nothing else happens; then the card is answered naming the document; if the card does not take it, the document is removed and "Couldn't save" shows; then the answer is written; if that write fails, Michael is asked to add it, naming the document | card first, as today; then the file is read in; an unreadable file after the card closed is passed to Michael, who asks the owner again |
Question D3:
D3 — When you save with a file, should the app read the file before it answers the card?
Project/branch/task: eng review of the card upload plan on mit/dock-scroll-follow (running branch).
ELI10: Save does two things: it answers the card, which tells Michael to close it, and it records your answer. With a file, a third step reads the file into company knowledge, and that step can fail (a file the app can't open, like a Pages document). If the card is answered first, Michael is told "I added Brand voice.pages" and closes the card before the app finds it can't read it. Reading the file first lets the card say so right away, so you can pick another file, and nothing is closed or recorded yet.
Stakes if we pick wrong: with the card first, an unreadable file closes the card anyway and you hear about it later from Michael, maybe days later on the weekly check.
Recommendation: A because a file problem shows on the card you are looking at, before anything changes.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Read the file first (recommended)
  ✅ An unreadable file is named on the card with its reason, and you pick another while the card is still open.
  ✅ Nothing is closed or recorded until the file is in; a card Michael already closed removes the new document again.
  ❌ One more undo step to test, the removal when the card can't be answered (human: ~2 hours / CC: ~10 min more).
B) Card first, as today
  ✅ Keeps today's Save order unchanged, and Michael always learns of the answer first.
  ✅ No removal step to build or test, since the file is read in after the card is answered.
  ❌ An unreadable file still closes the card, and you only hear about it when Michael asks again.
Net: catch a bad file on the card, or keep today's order and let Michael follow up. <gstack-qid:plan-eng-review-card-upload-order>
Header: Save order
Options:
A) Read the file first (recommended)
Read the file into company knowledge first and stop with its reason if it can't be read; then answer the card, removing the document if the card isn't taken; then write the answer, with Michael's fallback.
B) Card first, as today
Answer the card first, then read the file in; a file that can't be read goes to Michael to ask you again.

State: approved
Actual answer: A, with an addition (owner answer to D3, 2026-10-22): "it should do A plus try to validate if the file content matching the intent. in other words, if brand voice file is asked the user may upload a finanical statement accidently. this should not be ok"
Accepted scope: the file is read first; an unreadable file stops there with its reason; then the card is answered naming the document; a card not taken removes the document and shows "Couldn't save"; then the answer is written, with Michael's fallback naming the document. The addition is recorded as R4 (the file must fit the question), approved by the same answer.
History: none

### R4: the file must fit the question (owner addition to D3)
Finding: owner requirement, D3 answer, 2026-10-22
Plan baseline: approved by the D3 answer: a file whose content plainly is not what the question asks (a financial statement on the brand voice card) is not accepted
Runtime evidence: the app already runs this kind of check for standing email approvals: a hidden quick model with no tools answers FITS or NO with a short reason, and anything else counts as NO (`src/main/standingCheck.ts:13-38`, `claude-haiku-4-5`, 60 s); text extraction runs in its own process (`src/main/knowledge.ts:175-181`)
Accepted scope: after the file's text is read and before it is added: a fit check (same runner, model and limits as the standing check, file name, the question and its jobs, the first part of the text as data inside a delimiter the file cannot know) answers FITS or NO with one plain reason; NO refuses the file on the card with that reason, nothing is added or answered, and the owner can pick another file. Its two open edges are R4a (can the owner override a NO) and R4b (the check cannot run).
State: approved
Actual answer: D3 answer (above)
History: none

### R4a: can the owner keep a file the check refused
Finding: edge of R4; a quick model can be wrong about a real brand voice document (for example one titled "Q3 marketing plan" that holds the voice section)
Plan baseline: R4 approved: a NO refuses the file with its reason
Runtime evidence: the standing check has no override because its fallback is the owner deciding (`src/main/standingCheck.ts:4-6`); here the owner is the one choosing the file
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 cards | approved D1 A | foundations cards | foundations cards |
| R2 where it lives | approved D2 A | company knowledge | company knowledge |
| R3 order | approved D3 A | file first | file first |
| R4 fit check | approved D3 addition | NO refuses with its reason | NO refuses with its reason |
| R4a owner override after a NO | none | none: the owner picks another file, or types the answer, or has the member draft it | a "Use it anyway" link under the reason; the answer is saved with the file and Michael's reply notes the check said it did not fit |
| R4b check cannot run | pending | pending | pending |
Question D4:
D4 — When the check says a file doesn't fit the question, can you still keep it?
Project/branch/task: eng review of the card upload plan on mit/dock-scroll-follow (running branch).
ELI10: A quick AI check reads the start of your file and says whether it answers the card's question, the way it already checks emails a member may send without you. It catches a financial statement added to the brand voice card. It can also be wrong now and then, for example a marketing plan whose middle section is your brand voice. The question is whether the card lets you say "keep it anyway" after it refuses.
Stakes if we pick wrong: with no override, a right file the check misreads can't be added from the card; with an override, a hurried click can still save the wrong file.
Recommendation: B because you stay the final word on your own files, and the refusal still stops the accidental pick you described.
Completeness: A=8/10, B=10/10
Pros / cons:
A) No override
  ✅ A file the check refuses never becomes an answer, exactly as you said a wrong file should not be ok.
  ✅ Nothing extra on the card: you pick another file, type the answer, or have the member draft it.
  ❌ A right file the check misreads can't become the answer at all; you'd type the answer instead.
B) Use it anyway (recommended)
  ✅ The refusal and its reason still stop an accidental pick, and the file is only kept on a second, deliberate click.
  ✅ You stay the final word on your own documents when the check misreads one (human: ~2 hours / CC: ~10 min more).
  ❌ One more link on a refused card, and a hurried second click can still save the wrong file.
Net: the check has the last word, or you do after reading its reason. <gstack-qid:plan-eng-review-card-upload-override>
Header: Keep anyway
Options:
A) No override
A file the check refuses is not saved; pick another file, type the answer, or have the member draft it.
B) Use it anyway (recommended)
Under the refusal's reason, a "Use it anyway" link saves the file as the answer; Michael's reply notes the check said it did not fit.

State: approved
Actual answer: A, "No override" (owner answer to D4, 2026-10-22), over the recommended B
Accepted scope: a file the check refuses is never saved as the answer; the card shows the reason and the owner can pick another file, type the answer, or have the member draft it.
History: option A's downside first said "only through Settings"; corrected before asking (adding in Settings does not answer the question)

### R4b: when the fit check cannot run
Finding: edge of R4; the check needs the owner's Claude sign in and a network, and has a 60 s limit (`src/main/standingCheck.ts:14`); it can also return something that is neither FITS nor NO
Plan baseline: R4 approved; R4a approved: no override
Runtime evidence: the standing check counts a check that cannot run as NO (`src/main/standingCheck.ts:4-6, 33-36`)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 cards | approved D1 A | foundations cards | foundations cards |
| R2 where it lives | approved D2 A | company knowledge | company knowledge |
| R3 order | approved D3 A | file first | file first |
| R4 fit check | approved D3 addition | NO refuses with its reason | NO refuses with its reason |
| R4a override | approved D4 A: none | none | none |
| R4b check cannot run | none (no check) | refused: "Couldn't check this file, try again"; nothing is added or answered; the failure is logged | saved: the file becomes the answer, and Michael's reply says the file was not checked so he can look |
Question D5:
D5 — If the file check can't run (no internet, Claude signed out, a slow reply), should the card still take the file?
Project/branch/task: eng review of the card upload plan on mit/dock-scroll-follow (running branch).
ELI10: The fit check is a quick AI call. Now and then it can't run: the Mac is offline, Claude is signed out, or the reply takes over a minute. Then nobody has looked at whether the file fits. The card can either refuse and ask you to try again, or keep the file and tell Michael it wasn't checked.
Stakes if we pick wrong: refusing means a working file can't be added while the check is down; keeping it means a wrong file can slip in exactly when nobody checked.
Recommendation: A because you said a wrong file should not be ok, and you chose no override, so an unchecked file follows the same rule.
Completeness: A=9/10, B=7/10
Pros / cons:
A) Refuse and try again (recommended)
  ✅ No file becomes an answer without passing the check, the same rule as your no override choice.
  ✅ The card says plainly it couldn't check the file, and the failure is logged in the office log.
  ❌ While Claude is signed out or offline, files can't be added from the card at all.
B) Keep it, tell Michael
  ✅ A file is never blocked by a network or sign in problem, so the card always works.
  ✅ Michael is told it wasn't checked, so he can look at it before members rely on it.
  ❌ A wrong file can become the answer in exactly the moments nobody checked it.
Net: a strict rule that sometimes says try again, or a card that always takes the file and leaves the check to Michael. <gstack-qid:plan-eng-review-card-upload-checkdown>
Header: Check down
Options:
A) Refuse and try again (recommended)
A check that can't run refuses the file with "Couldn't check this file, try again"; nothing is added or answered; the failure is logged.
B) Keep it, tell Michael
A check that can't run keeps the file as the answer, and Michael's reply says it was not checked.

State: approved
Actual answer: A, "Refuse and try again" (owner answer to D5, 2026-10-22)
Accepted scope: a fit check that cannot run, times out or answers neither FITS nor NO refuses the file with "Couldn't check this file, try again"; nothing is added or answered; the failure goes to the office log.
History: an option A pro first said the failure shows in Pulse's health view; corrected before asking (nothing reads it there)

### R5: how the fit check's judgment is proven
Finding: Test review, [→EVAL] gap: unit tests prove the prompt's shape and parsing, not that the model tells a brand voice from a financial statement
Plan baseline: none (the check is new, R4)
Runtime evidence: the standing check shipped with prompt and parser tests only (`src/shared/mailProposals.ts:347`); no eval suite exists in this repo
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 to R4b | approved D1 to D5 | unchanged | unchanged | unchanged |
| R5 proof of the check's judgment | none | a live check at /ship: on the dev app, add three files on a brand voice card (a brand voice document saves, a financial statement is refused with its reason, a scanned image of brand guidelines is read and judged), noted in the PR | a stored set of sample files and a script that runs the real check on demand, kept in the repo (each run uses the owner's Claude plan) | prompt and parser unit tests only |
Question D6:
D6 — How should we prove the file check really tells a brand voice from a financial statement?
Project/branch/task: eng review of the card upload plan on mit/dock-scroll-follow (running branch).
ELI10: The unit tests prove the check is asked the right way and that its yes or no is read right. They don't prove the AI judges well, because tests can't call the real model. A live check before release adds three real files on a brand voice card and watches what happens. A stored set of sample files with a script lets anyone rerun that check later, at a small cost each time.
Stakes if we pick wrong: with unit tests only, a check that refuses good files or passes wrong ones ships unseen.
Recommendation: A because three files on the dev app show the real behavior before release, with nothing new to keep up.
Completeness: A=8/10, B=10/10, C=5/10
Pros / cons:
A) Live check at ship (recommended)
  ✅ The real model judges real files on the real card before release: one that fits, one that doesn't, one scan.
  ✅ Nothing new to maintain; the result is written in the PR (human: ~30 min / CC: ~10 min at /ship).
  ❌ A later prompt change isn't rechecked unless someone repeats it by hand.
B) Stored samples and a script
  ✅ Anyone can rerun the same files after a prompt change and compare (human: ~1 day / CC: ~30 min).
  ✅ Catches a model or prompt drift that a one time check would miss.
  ❌ Sample files and a script to keep in the repo, and each run spends part of your Claude plan.
C) Unit tests only
  ✅ No extra step at release and nothing extra to keep in the repo or run by hand.
  ✅ The prompt's guard and the strict yes or no reading are still pinned by tests.
  ❌ Nobody sees the real model judge a real file before you do on a live card.
Net: one real look before release, a repeatable kit, or trust the prompt. <gstack-qid:plan-eng-review-card-upload-eval>
Header: Prove check
Options:
A) Live check at ship (recommended)
At /ship, add a brand voice document, a financial statement and a scanned image on a dev brand voice card; record what each did in the PR.
B) Stored samples and a script
Keep sample files and a script in the repo that runs the real check on demand and prints each verdict.
C) Unit tests only
Prompt shape and FITS/NO parsing tests only; no real model run before release.

State: approved
Actual answer: A, "Live check at ship" (owner answer to D6, 2026-10-22)
Accepted scope: at /ship, on the dev app, add a brand voice document, a financial statement and a scanned image on a brand voice card; record what each did in the PR. Unit tests as listed in Test review.
History: none

### R6: the company profile when a file answers hours or the financial year
Finding: Codex 1, High, 9/10 (verified), `src/main/foundations.ts:64-77, 253-258`, reviewer Codex gpt-5.4
Plan baseline: R2 approved: the answer text names the document; the plan said nothing about the profile sync, so `ownerAnswer`'s sync would take the whole line
Runtime evidence: `toProfile` writes the hours answer's first 200 characters to the profile and reads the financial year's month from the answer text
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R1 to R5 | approved D1 to D6 | unchanged | unchanged | unchanged | unchanged |
| R6 profile sync for a file answer | whole answer line, file line included | only the owner's typed words sync; a file with no words leaves the profile field as it is | as planned: the whole line, file line included | pending: look at both linked questions first | pending, kept out of this plan |
Question D8:
D8 — When a file answers business hours or the financial year, what should reach the company profile?
Project/branch/task: eng review of the card upload plan on mit/dock-scroll-follow (running branch).
ELI10: Two foundations questions, business hours and the financial year, are also fields in your company profile, and the app keeps them in step. With a file, the saved answer gets an extra line naming the document. Without a fix, that line would land in your profile's hours field, and the financial year could be read from the file's name. The fix syncs only the words you typed; a file with no words leaves the profile field as it was.
Stakes if we pick wrong: your company profile shows "Full version: company knowledge document..." as your opening hours, and members read that.
Recommendation: A because the profile should hold only your words, never the app's file line.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Apply: sync only your words (recommended)
  ✅ The profile shows exactly what you typed, and a file alone never changes it (human: ~1 hour / CC: ~5 min).
  ✅ The foundations answer still names the document for members to read in full.
  ❌ A file with no words leaves the profile field as it was until you type it.
B) Keep the plan as is
  ✅ No extra rule in the save path or its tests.
  ✅ The profile and the answer hold exactly the same text.
  ❌ The file line becomes your hours in the profile, and a file name can set the wrong financial year.
C) Investigate first
  ✅ Looks at both linked questions before choosing, with no change to the plan yet.
  ✅ Bounded to the two profile links in foundations.ts.
  ❌ Leaves this open, so the build waits on it.
D) Defer
  ✅ Keeps this plan unchanged and the question out of this build.
  ✅ Can be picked up in its own small change.
  ❌ Until then a file on these two cards writes the file line into the profile.
Net: keep your profile to your own words, or accept the file line there. <gstack-qid:plan-eng-review-card-upload-profile>
Header: Profile sync
Options:
A) Apply: sync only your words (recommended)
Only the owner's typed words reach the profile's hours or financial year; a file with no words leaves the field as it is.
B) Keep the plan as is
The whole saved line, file line included, syncs to the profile.
C) Investigate first
Look at both profile links before choosing; this stays open.
D) Defer
Keep this out of the plan; the file line reaches the profile until it is fixed.

State: approved
Actual answer: A, "Apply: sync only your words" (owner answer to D8, 2026-10-22)
Accepted scope: for a file answer, only the owner's typed words reach the profile's hours or financial year; a file with no words leaves the profile field as it is. A test pins both.
History: none

### R7: members read a document an answer names (agent behavior change)
Finding: Codex 2, High, 8/10 (verified), `src/main/hive.ts:448`, reviewer Codex gpt-5.4
Plan baseline: plan step 4: "No new instruction: the foundations line names the document id, and members already know get <id>"
Runtime evidence: members' foundations rule today: "Follow its answers"; their company knowledge rule says to search it "when a task touches" policies, prices and how the business works, and how to `get <id>` (`src/main/hive.ts:298`)
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R1 to R6 | approved D1 to D6, D8 | unchanged | unchanged | unchanged | unchanged |
| R7 members' foundations rule | "Follow its answers" | adds: "When an answer names a company knowledge document, read it with get <id> before work that depends on that answer." (members and Michael) | unchanged: rely on the general company knowledge rule | pending | pending |
Behavior change (owner rule, 2026-10-12): today a member follows the one line answer and may or may not open a document it names; proposed, a member reads the named document before work that depends on that answer. Who: every member with a foundations section, and Michael. What the owner sees: posts, emails and quotes written from the whole brand voice or price file, not from its one line pointer.
Question D9:
D9 — Should members be told to open the document an answer names before work that depends on it?
Project/branch/task: eng review of the card upload plan on mit/dock-scroll-follow (running branch).
ELI10: Today a member's instructions say "follow the company foundations answers". With a file, the brand voice answer becomes a short line naming a document, not the brand voice itself. Members know how to open a company knowledge document, but nothing tells them to open this one before writing. One added sentence tells them: when an answer names a document, read it before work that depends on it.
Stakes if we pick wrong: Ryan sees "Full version: document 12" as the brand voice and writes the LinkedIn post without ever opening your file.
Recommendation: A because a file you add only helps if the member reads it, and one sentence makes that the rule.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Apply: one sentence (recommended)
  ✅ Ryan opens your brand voice file before writing posts, emails and blogs, not just its one line pointer.
  ✅ One sentence in the members' and Michael's foundations rule, pinned by the instructions test (human: ~1 hour / CC: ~5 min).
  ❌ A member reads the whole document for each such task, which takes a little longer and uses more of your plan.
B) Keep the instructions
  ✅ No change to what members are told, so nothing else in their behavior moves.
  ✅ Members can still open the document under their general company knowledge rule.
  ❌ A member may write from the one line pointer and never open your file.
C) Investigate first
  ✅ Checks how members treat a pointer today before changing their rules.
  ✅ No instruction change until there is evidence.
  ❌ Leaves this open, so the build waits on it.
D) Defer
  ✅ Ships the card upload without touching member instructions.
  ✅ Can be added after watching what members do with file answers.
  ❌ Until then a file answer may be ignored by the work it was meant to guide.
Net: one sentence so members read your file, or trust them to find it. <gstack-qid:plan-eng-review-card-upload-readdoc>
Header: Read the file
Options:
A) Apply: one sentence (recommended)
Members' and Michael's foundations rule adds: when an answer names a company knowledge document, read it with get <id> before work that depends on that answer.
B) Keep the instructions
No instruction change; members rely on their general company knowledge rule.
C) Investigate first
Check how members treat a pointer before deciding; this stays open.
D) Defer
Keep instructions as they are for this build.

State: approved
Actual answer: A, "Apply: one sentence" (owner answer to D9, 2026-10-22)
Accepted scope: the members' and Michael's foundations rule adds: "When an answer names a company knowledge document, read it with get <id> before work that depends on that answer." The instructions test pins it. Listed under Behavior changes at ship.
History: none

### R8: a picture with no words
Finding: Codex 4, Medium, 8/10 (verified), `src/main/docText.ts:408-419`, `src/shared/foundations.ts:51`, reviewer Codex gpt-5.4
Plan baseline: R4, R4a, R4b approved: the check reads text; no override; a check that cannot judge refuses
Runtime evidence: a picture whose OCR finds no words reads as passthrough with no text; the fit check (no tools) is given text only (`src/main/standingCheck.ts:25`, `noTools: true`); whether the hidden check can be handed a picture is unverified
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R1 to R7 | approved D1 to D6, D8, D9 | unchanged | unchanged | unchanged | unchanged |
| R8 a picture with no words | the plan reads its bytes as text, so the check refuses it with a confusing reason | the check is given the picture itself and judges what it shows | refused with a plain reason: "This picture has no words the app can check. Add a document that describes it, or type the answer." | pending: one probe whether the hidden check can take a picture, then choose | pending, kept out of this build |
Question D10:
D10 — On the "How we look" card, what happens with a logo picture that has no words in it?
Project/branch/task: eng review of the card upload plan on mit/dock-scroll-follow (running branch).
ELI10: The file check reads words. Brand sheets usually have some (font names, color codes), so the check can judge them. A bare logo picture has none, so the check has nothing to read and, under your strict rule, the file is refused. The card can either say plainly why, or the check can be taught to look at the picture itself, which needs a way to hand it a picture that hasn't been tried yet.
Stakes if we pick wrong: a bare logo is refused with a confusing reason, or we build picture checking that turns out not to work in the hidden check.
Recommendation: B because brand sheets with words work already, and a bare logo gets a plain reason and a way forward.
Completeness: A=10/10, B=7/10, C=8/10, D=5/10
Pros / cons:
A) Apply: check the picture
  ✅ A bare logo, colors or a mood board can pass when the picture fits the question.
  ✅ Same strict rule as documents, applied to what the picture shows.
  ❌ Untried: the hidden check runs with tools off, so handing it a picture may not work (human: ~1 day / CC: ~1 hour, unverified).
B) Refuse with a plain reason (recommended)
  ✅ Brand sheets with any words still work, and a bare logo gets a reason that says what to do instead.
  ✅ Nothing untried in this build (human: ~30 min / CC: ~5 min).
  ❌ A bare logo can't be the answer from the card; you type it or add a sheet that describes it.
C) Investigate first
  ✅ One probe settles whether the hidden check can take a picture before choosing A or B.
  ✅ Costs one short check run on your Claude plan.
  ❌ Leaves this open, so the build waits on the probe.
D) Defer
  ✅ Keeps pictures out of this build entirely.
  ✅ Can be decided after the card ships.
  ❌ Until then a bare logo is refused with the confusing reason the plan would give it.
Net: a plain refusal now, or teach the check to see pictures. <gstack-qid:plan-eng-review-card-upload-picture>
Header: Logo picture
Options:
A) Apply: check the picture
The fit check is given the picture itself and judges what it shows.
B) Refuse with a plain reason (recommended)
A picture with no words is refused: "This picture has no words the app can check. Add a document that describes it, or type the answer."
C) Investigate first
One probe whether the hidden check can take a picture, then choose; this stays open.
D) Defer
Keep pictures out of this build; a bare logo gets the plan's current refusal.

State: approved
Actual answer: A, "Apply: check the picture" (owner answer to D10, 2026-10-22), over the recommended B
Accepted scope: a picture (with or without words) is given to the fit check as a picture, which judges what it shows against the question, under the same rules (FITS or NO with a reason; no override; a check that cannot run refuses). Feasibility is unverified: the build's first step is a probe that the hidden check, tools off, can take a picture. If it cannot, the build stops on pictures and returns to the owner with what was found; it does not fall back silently.
History: none

### R9: TODO, ordinary Ask me cards take a file
Finding: D1 kept ordinary Ask me cards out of this build
Plan baseline: none
Runtime evidence: ordinary Ask me cards take no file (`AskMeTab.tsx`, `AskAnswerFields.tsx`); message attachments travel by path (`src/main/index.ts:6402`)
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 to R8 | approved | unchanged | unchanged | unchanged |
| R9 ordinary Ask me cards take a file | not tracked | a TODOS.md item (P3) | not tracked | built in this change (reverses D1) |
Question D11:
D11 — Add a TODO for letting ordinary Ask me cards take a file too?
Project/branch/task: eng review of the card upload plan on mit/dock-scroll-follow (running branch).
ELI10: You chose to give files to Company foundations cards only. A member's ordinary question in Needs you still has no Add a file. A TODO keeps that in view: what it is, why, where to start, and that it needs its own look at which folders a member may read.
Stakes if we pick wrong: without a TODO it is forgotten; building it now undoes your D1 choice and doubles this build.
Recommendation: A because it keeps your original ask, uploads on any Ask me card, in view without growing this build.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add to TODOS.md (recommended)
  ✅ The rest of your ask stays written down with where to start, so it isn't lost.
  ✅ No change to this build's scope or your D1 choice.
  ❌ One more item on the TODO list until someone picks it up.
B) Skip
  ✅ Keeps the TODO list shorter and focused on what's already planned.
  ✅ You can raise it again whenever you hit it on a card.
  ❌ Nothing records that ordinary cards still need a typed path.
C) Build it now
  ✅ Every Ask me card takes a file in the same release.
  ✅ No second change to plan later.
  ❌ Reverses D1 and roughly doubles this build (human: ~2 days / CC: ~1 hour more).
Net: write it down, drop it, or do it now. <gstack-qid:plan-eng-review-card-upload-todo>
Header: TODO
Options:
A) Add to TODOS.md (recommended)
A P3 TODOS.md item: ordinary Ask me cards take a file, sent to the asking member by path, after a look at which folders a member may read.
B) Skip
No TODO; ordinary cards stay without files.
C) Build it now
Give every Ask me card a file in this build, reversing D1.

State: approved
Actual answer: A, "Add to TODOS.md" (owner answer to D11, 2026-10-22)
Accepted scope: a P3 TODOS.md item under Company foundations; no change to this build.
History: none

Approval readiness: PASS. Checked R1 (D1 A), R2 (D2 A), R3 (D3 A), R4 (D3 addition), R4a (D4 A), R4b (D5 A), R5 (D6 A), R6 (D8 A), R7 (D9 A), R8 (D10 A), R9 (D11 A); outside voice D7 A; structure auto chosen under the owner's standing rule; Codex 3 recorded as a correction. Regression contract: Save with words only unchanged, existing tests `foundations.test.cjs:96` and `:429` (carried, no new behavior).

## Approved plan (after review)

The original plan above, with every answer applied (D1 to D11):

```
 Card: [Add a file] or drop ─► one file ─► chip [name ×]          (foundations cards only, D1)
 Save (words optional when a file is chosen)
   busy "Checking the file"
   1. main addFile(id, path)
        read once (own process, 100 MB cap)
          unreadable ─────────────► card: "Couldn't read <name>: <reason>"   nothing done (D3)
        fit check: question, jobs, name, first 8,000 chars of text, or the picture itself (D10)
          NO: reason ─────────────► card: the reason                         nothing done, no override (D4)
          cannot run / unread ────► card: "Couldn't check this file, try again"  logged (D5)
          FITS ─► company knowledge, tags foundation-file + <id> (never foundations) (D2)
   2. onAnswer(words + "I added <name> to company knowledge for this.")
          not taken ─► remove the document ─► "Couldn't save, try again."   (D3)
   3. main answerFile(id, docId, words)
          answer: words, then "Full version: company knowledge document <id> (<name, 60 max>)",
                  300 cap, id never cut; by owner, ref kg:<id>
          profile (hours, financial year): only the typed words; none leaves it as is (D8)
          fails ─► Michael asked to add the exact line, document id included (Codex 3)
 Members and Michael: "When an answer names a company knowledge document, read it with
   get <id> before work that depends on that answer." (D9, behavior change)
 Proof: unit tests, plus a live check at /ship with three files (D6)
```

Build order note (D10): the first build step proves the hidden check, tools off, can be handed a
picture. If it cannot, pictures stop there and the owner is told what was found; nothing falls back.

Probe result (T1, 2026-10-22): with tools off, a picture's path pasted on its own before the prompt is
attached by Claude Code. A 240 px logo with no words (a blue circle and a yellow square) came back
"Blue circle and yellow square, overlapping. FITS", and the same with a path holding spaces
("My Brand/Brand logo final.png"). Pictures Claude Code attaches: PNG, JPEG, GIF, WebP; another
picture with no words asks the owner for PNG or JPEG. Another engine than Claude counts as unchecked.

## NOT in scope

- Ordinary Ask me cards taking a file (D1); kept as a P3 TODO (D11).
- More than one file per answer: one answer names one document, which keeps the line under the cap.
- Changing an answered question's file from the card: answered questions leave Needs you; the owner edits the document in Settings.
- A stored eval kit for the fit check (D6 chose a live check at ship).

## What already exists

- Company knowledge read and ingest: `src/main/knowledge.ts:164-181`, `src/main/docText.ts` (reused; the read is exposed so it runs once).
- The standing check runner and its strict FITS/NO shape: `src/main/standingCheck.ts`, `src/shared/mailProposals.ts:347-357` (pattern reused for a new `fileFitCheck`; not extracted, Code quality 2).
- The owner answer write, cap and profile sync: `src/main/foundations.ts:64-77, 253-269` (reused, with the words-only sync for file answers).
- The OS picker and drop path: `src/main/index.ts:6366-6378`, `src/preload/index.ts:1170` (same pattern, a one file picker).
- `kg:remove`: `src/main/index.ts:6348` (reused to undo an add when the card is not taken).
- Members' `get <id>`: `src/main/hive.ts:298` (reused; D9 adds when to use it for foundations).

## Failure modes

| New path | Realistic failure | Handling | Test | Owner sees |
|---|---|---|---|---|
| read | Pages file, password PDF, 150 MB file | refused with its plain reason | add file refusals | the reason on the card |
| fit check | a financial statement on the brand voice card | NO with a reason, nothing added | add file refusals, live check | the reason on the card |
| fit check | Claude signed out, offline, 60 s timeout, a reply that is not FITS/NO | refused, logged | add file refusals | "Couldn't check this file, try again" |
| picture check | the hidden check cannot take a picture | build stops on pictures (D10) | probe (T1) | n/a until built |
| card answer | Michael already closed the card | document removed | card pins | "Couldn't save, try again." |
| answer write | foundations.json unwritable | Michael asked with the exact line | existing fallback test, extended | "Sent to Michael to add" |
| between steps | app quits after the add, before the answer | the document stays, listed in Settings; the card is still open next launch | none (accepted) | an extra document in Settings |
| profile | file with no words on hours | profile left as is | answer with file | profile unchanged |

No failure mode is silent, untested and unhandled: 0 critical gaps.

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|------|----------------|------------|
| T1 picture probe | main (hidden check) | — |
| T2 to T4, T7 add file, fit check, answer, fallback | main | T1 for pictures only |
| T5 card | renderer components, locales | T4's IPC shapes |
| T6 instructions | main (hive prompts) | — |
| T8 tests | test | T2 to T7 |

Lane A: T1 → T2 → T3 → T4 → T7 (main). Lane B: T6 (main/hive.ts, independent). Then T5, then T8.
Conflict flags: A and B both touch `src/main` (different files: foundations, knowledge, standingCheck sibling vs hive.ts); the running branch rule keeps all of it on one branch, so build sequentially.
Sequential implementation on the running branch; no parallel worktrees (owner rule: one running branch).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [x] **T1 (P1, human: ~2h / CC: ~15min)** — fit check — prove the hidden check, tools off, can be handed a picture
  - Surfaced by: R8, D10 A (feasibility unverified)
  - Files: `src/main/hiddenClaude.ts` (read only), a probe script outside the repo
  - Verify: one run judges a logo picture; if not, stop pictures and report to the owner
- [x] **T2 (P1, human: ~2h / CC: ~10min)** — knowledge — read a file once, then ingest that read
  - Surfaced by: Architecture 1 and 2
  - Files: `src/main/knowledge.ts`
  - Verify: unit test, a PDF is read once; passthrough gives its first part as text
- [x] **T3 (P1, human: ~4h / CC: ~20min)** — fit check — `fileFitCheck`: question, jobs, name, text slice or picture, nonce delimiter, strict FITS/NO parse
  - Surfaced by: R4, R4b, Architecture 3, D10
  - Files: new `src/main/fileFitCheck.ts`, its prompt in `src/shared/foundations.ts`
  - Verify: prompt and parser tests
- [x] **T4 (P1, human: ~1d / CC: ~30min)** — foundations — `addFile` and `answerFile`, IPC and preload (pick, add, answer)
  - Surfaced by: R2, R3, R4a, R6, Code quality 1, Architecture 4
  - Files: `src/main/foundations.ts`, `src/main/index.ts`, `src/preload/index.ts`
  - Verify: add file and answer with file tests
- [x] **T5 (P1, human: ~1d / CC: ~30min)** — card — Add a file, drop, chip, busy line, Save order, removal, refusal lines, hint; en, ar, zh-CN
  - Surfaced by: R1, R3, R4, R4b, Performance 1
  - Files: `src/renderer/src/components/FoundationCard.tsx`, three locale files
  - Verify: card pins, locale and no dash suites, dev app
- [x] **T6 (P1, human: ~1h / CC: ~5min)** — instructions — members' and Michael's sentence on reading a named document
  - Surfaced by: R7, D9 A (behavior change)
  - Files: `src/main/hive.ts`
  - Verify: instructions test (`foundations.test.cjs:395`, extended)
- [x] **T7 (P2, human: ~30min / CC: ~5min)** — foundations — fallback message carries the exact line with the document id
  - Surfaced by: Codex 3 (correction)
  - Files: `src/renderer/src/components/FoundationCard.tsx`
  - Verify: card pin
- [x] **T8 (P1, human: ~1d / CC: ~30min)** — tests — every test in Test review, in `test/foundations.test.cjs`
  - Surfaced by: Test review
  - Files: `test/foundations.test.cjs`
  - Verify: `npm test`
- [ ] **T9 (P2, human: ~30min / CC: ~10min)** — ship — live check with a brand voice document, a financial statement and a scanned or logo picture; record in the PR
  - Surfaced by: R5, D6 A
  - Files: none
  - Verify: PR notes
- [ ] **T10 (P2, human: ~30min / CC: ~5min)** — docs — CHANGELOG, FEATURES, Behavior changes (D9) at ship
  - Surfaced by: owner rules (FEATURES each land; highlight behavior changes)
  - Files: `CHANGELOG.md`, `docs/FEATURES.md`
  - Verify: no dash suite

## Unresolved decisions

None in this review.

## Suppressed findings

- [P3] (confidence: 4/10) a crafted file could try to talk the fit check into FITS; the owner picks the file themselves, and the prompt keeps it as data inside a nonce delimiter, so this is not a realistic path.

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is (with the owner's additions: the fit check, D3)
- Reality rows: 7/7 applicable rows emitted, 0 unverified premises
- Architecture Review: 4 issues found
- Code Quality Review: 2 issues found
- Test Review: diagram produced, 18 gaps identified
- Performance Review: 1 issue found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to user (added, D11)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: Codex gpt-5.4, completed, 4 findings (3 decided D8 to D10, 1 correction)
- Parallelization: 3 lanes, 0 parallel / 3 sequential (one running branch)
- Lake Score: 6/8 = answers picking a 10/10 option / answers scored for Completeness (D1 A 7, D4 A 8 below 10)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | ISSUES OPEN (other plan, 2026-10-22) | 3 proposals, 1 accepted, 0 deferred |
| Outside Review | Codex gpt-5.4 via `/plan-eng-review` | Independent 2nd opinion | 11 | completed | 4 findings: 3 decided (D8 to D10), 1 correction |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 11 | ISSUES OPEN | 25 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 8 | — (none for this plan) | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** Codex (gpt-5.4, read only), plan review phase, completed with the owner's yes (D7 A); 4 findings, all verified against the code.
- **CROSS-MODEL:** Claude's review and Codex agree on the plan's shape; Codex found 3 gaps Claude's sections missed (profile sync, members not told to open the document, pictures with no words) and 1 fallback detail; no disagreement left open.
- **VERDICT:** ENG REVIEW done with every decision answered; status ISSUES OPEN means mapped work (25 findings turned into tasks T1 to T10), not open questions. The CEO and design rows belong to other plans; this card change has had no design review.

NO UNRESOLVED DECISIONS
