# Where a team member may send data on the web (issue #230)

Status: draft for eng review. Owner chose "accept, plan the full fix" on 2026-10-12. Its per member Sites list is superseded by `docs/designs/research-agent-privacy.md` (only Pete, the Research team member, uses the internet); its enforcement findings still hold.

## The gap

Outgoing email is gated: a proposal on Ask me, the approved text sent as kept, a
re-check before SMTP, and a separate no-tools model for standing approvals. A web
request has no gate.

- `HookServer.handle` (`src/main/hooks.ts`) checks file, mail, connector and
  QuickBooks calls. `WebFetch` and `WebSearch` reach none of them. The only
  `WebFetch` line is in `toolDetail`, which pulls the host for the closing-time
  line, for display only.
- `hookSettings` (`src/main/hive.ts`) writes `sandbox.filesystem` and
  `permissions.deny`, with no network rule.
- A shell command can reach the network too (`curl`, `Invoke-WebRequest`,
  `node -e fetch(...)`). The issue does not cover this, but a fix that gates
  `WebFetch` alone and leaves the shell open promises more than it holds.

The member at risk is the one reading untrusted mail. Text in a customer email
can ask it to fetch `https://example.net/?d=<client list>`, and nothing stops it
or shows the owner.

## What the owner sees

One field per team member on the Access tab: **Sites**.

- **Any site**: today's behavior and the default, so no office changes on upgrade.
- **Only sites I list**: a short list of hosts (`example.com` also allows
  `www.example.com`; no wildcards beyond that at first).

Fields only; the explanation goes behind the info icon (less verbose UI). A
refused call returns one plain reason the member reads, as a denied connector does:
"The owner allows this team member only these sites: a.com, b.com."

Michael is not covered (his folder rules exclude him by design). Decide in review
whether he gets the same field.

## How it is enforced

1. **A pure rule** `webAccess(cfg, agentId, host)` in `src/shared`, beside
   `mailAccess` and `folderPolicy`. No fs, no electron, unit tested.
2. **App hook gate** in `HookServer.handle` for `WebFetch` and `WebSearch`, next
   to the mail gate. Live check (Claude Code 2.1.296, 2026-10-12): PreToolUse fires
   for both, with `tool_name` "WebFetch" and "WebSearch". This works on every engine
   whose bridge posts PreToolUse, and on Windows. For `WebSearch` the gate can only
   allow or refuse the whole tool: the query text is the data, so a member on
   "Only sites I list" gets no `WebSearch` at all.
3. **Shell network, Claude Code on a Mac.** Live check (2.1.296, auto mode,
   `--settings` with `sandbox.enabled`, `allowUnsandboxedCommands: false`):
   - `sandbox.network.allowedDomains: ["example.com"]` alone does **not** block:
     `curl https://example.org` returned 200. In auto mode the list only saves
     prompts.
   - Adding `sandbox.network.strictAllowlist: true` blocks it: curl to example.org
     failed with "sandbox denied network-outbound to example.org:443; the host is
     not on the allow list", Python's urllib got the same 403, and example.com
     still returned 200.
   - The CLI's own description says `strictAllowlist` covers sandboxed commands
     only; in-process tools such as `WebFetch` are not gated by it. So the app hook
     gate (2) and the sandbox list are both needed.
   So for a member on "Only sites I list", `hookSettings` writes
   `sandbox.network.allowedDomains` (the list) and `strictAllowlist: true`, beside
   the folder rules. This relies on `allowUnsandboxedCommands: false`, which team
   members on a Mac already have (`sandboxOnly`).
   - Windows: today the app turns the sandbox off there (#187). The 2.1.296 binary
     mentions a Windows sandbox user and a network filter, so a newer Claude Code
     may now have one: check live on the Windows PC before saying anything.
   - Michael runs unsandboxed, so his shell network is not covered either way.
   - Other engines: record per engine what holds, in the per engine capability
     record #48 plans.
4. **Honest claims.** The Access tab says "enforced" only where a test or a live
   check proves it.

## Tests

- `webAccess`: Any site allows all; a listed host and its `www.` form pass; an
  unlisted host, an IP address, a punycode lookalike and a `user@host` URL are
  refused; a bad URL is refused.
- Hook: a `WebFetch` to an unlisted host is denied with the reason; a listed one
  passes; `WebSearch` is denied under "Only sites I list"; Any site changes nothing.
- Settings: a member on "Only sites I list" gets `sandbox.network.allowedDomains`
  and `strictAllowlist: true` in its Claude settings; Any site writes no network
  key; Windows and Michael get none.

## Open questions for review

0. Does a strict list break anything a member's own shell needs on this machine:
   the `kg` and memory CLIs, the app's local services, package installs? Check
   live with the list on before building.

1. Should the default change for members with a watched mailbox (they read
   untrusted mail)? That changes an existing office's behavior, so it is the owner's call.
2. Does Michael get the field?
3. A listed host that needs a credential belongs in the integration broker
   (`src/main/integrationBroker.ts`), which already refuses hosts the owner did not
   register. Is that a second step or out of scope?
4. Should a refused call also notify Michael (the injection flag rule: high
   confidence flags go to Michael, never the owner)?

---

# Eng review (plan-eng-review, 2026-10-12)

Target: `docs/designs/agent-web-access.md` (this file, sections above). Reviewer: Claude, session 89074-1791863750-42796971.

## Evidence (live checks on Claude Code 2.1.296, auto mode, `--settings`)

| Check | Result |
|---|---|
| PreToolUse fires for `WebFetch` and `WebSearch` | Yes, `tool_name` "WebFetch" and "WebSearch" in the hook payload |
| `sandbox.network.allowedDomains` alone, curl to an unlisted host | Not blocked (200) |
| Same plus `strictAllowlist: true` | curl and Python urllib refused: "host is not on the allow list"; listed host 200 |
| `WebFetch` under `strictAllowlist` to an unlisted host | Not blocked (httpbin.org, example.net fetched): the app hook gate is required |
| A subagent's `WebFetch` | Reaches PreToolUse, with `agent_id` and `agent_type` set |
| `WebFetch` to a URL that redirects to another host | Not followed: the tool returns the `Location` and asks for a second call, which the gate sees |

## Reality rows

| premise | claim | receipt | verdict |
|---|---|---|---|
| P1 | hook gates cover file, mail, connector, QuickBooks only | `src/main/hooks.ts:494-632` | true |
| P2 | `WebFetch` host pulled only for display | `src/main/hooks.ts:976` | true |
| P3 | settings carry no network rule | `src/main/hive.ts` sandbox block in `hookSettings` | true |
| P4 | team members on a Mac already have `sandboxOnly` | `src/shared/folderAccess.ts:75` vs `src/main/index.ts:2220` | **false** for offices without a business folder |
| P5 | integration broker refuses unregistered hosts | issue #230 quote of `integrationBroker.ts` | unverified |
| P6 | 2.1.296 has a Windows sandbox | binary strings only | unverified |

REALITY: premise-table finding unverified=2, P4 false src/main/index.ts:2220
REALITY: already-done pass no WebFetch or network gating on origin/main since 2026-10-12 src/main/hooks.ts:976
REALITY: surface-check pass sandbox.network.allowedDomains and strictAllowlist exist in 2.1.296 and behave as tested src/main/hive.ts:1600-1625
REALITY: binding-decisions pass Windows sandbox off (2026-10-09), auto mode without asking, less verbose UI, injection flags to Michael only; none overruled src/main/hive.ts:1604-1612
REALITY: numbers pass file count about 11 [estimated], effort M [estimated] docs/designs/agent-web-access.md:42-73
REALITY: deferred-asks finding issue #230 also asks for the integration broker step; listed under NOT in scope docs/designs/agent-web-access.md:96-97
REALITY: pr-count pass one PR (no ship-policy, default) docs/designs/agent-web-access.md:1

## Scope Challenge

Complexity: about 11 files touched [estimated]: `src/shared/webAccess.ts` (new), `src/shared/mailboxes.ts` (capability type), `src/main/hooks.ts`, `src/main/hive.ts`, `src/main/index.ts`, `src/renderer/src/components/CapabilitiesTab.tsx`, three locale files, two or three tests. One new module. The gate trips (8+ files).

Findings:
- S1 [P1] (confidence: 9/10) `src/main/index.ts:2220` `return { ...folderPolicy({ isGod, cwd }, layout, process.platform !== 'linux'), sandboxOnly: false };`. An office without a business folder lets an agent rerun a shell command outside the sandbox, so a strict network list there is advisory. The plan's "team members on a Mac already have sandboxOnly" holds only with a business folder.
- S2 [P1] (confidence: 9/10) `src/main/hive.ts:1312-1314` "these settings set its sandbox at its next start". The hook gate reads config per call, but the shell list changes only when the member restarts, so the two disagree in between.
- S3 [P2] (confidence: 8/10) design "example.com also allows www.example.com" vs the sandbox `allowedDomains` wildcard syntax. The hook rule and the sandbox list must mean the same thing for one owner list, or `WebFetch` and `curl` disagree.
- Open owner questions carried from the design: default for members with a watched mailbox, Michael, notify Michael on a refusal.

Scope record: feature answers: none proposed (no cuts); structure: A Original arrangement (D1, owner 2026-10-12); accepted scope: the design as written, arranged as new `src/shared/webAccess.ts` + `test/web-access.test.cjs`, edits to `mailboxes.ts`, `hooks.ts`, `hive.ts`, `index.ts`, `CapabilitiesTab.tsx`, three locales, extended sandbox and hook tests; pending remedies: R1 (S1), R2 (S2), R3 (S3), R4 (default), R5 (Michael), R6 (notify Michael).

## Decision ledger

### R1: shell sites in an office without a business folder
Finding: S1 [P1] (confidence: 9/10) `src/main/index.ts:2220`, reviewer Claude
Plan baseline: design says the strict list "relies on `allowUnsandboxedCommands: false`, which team members on a Mac already have" (original proposal, not approved)
Runtime evidence: `privateOnlyFolderPolicy` returns `sandboxOnly: false`, so without a business folder `allowUnsandboxedCommands: false` is not written (`src/main/hive.ts` sandbox block) and an agent can rerun a command outside the sandbox
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 member on a list, no business folder | unspecified | `allowUnsandboxedCommands: false` for that member (Mac) | unchanged; Access tab says shell sites are not enforced there |
| R2 to R6 | pending | pending | pending |
Question D2:
D2 — In an office without a business folder, should a member on "Only sites I list" also be held to the sandbox? <gstack-qid:plan-eng-review-r1-no-business-folder>
Project/branch/task: eng review of docs/designs/agent-web-access.md (issue #230).
ELI10: The shell part of Sites works only when a member can't run commands outside the sandbox. Offices with a business folder already block that. Offices without one don't (`src/main/index.ts:2220`), so there a member could rerun `curl` outside the sandbox and skip the list.
Stakes if we pick wrong: a Sites list that looks enforced but is skipped by one retried command.
Recommendation: A because a list the owner sets should hold; only members the owner put on a list are affected.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Hold listed members to the sandbox (recommended)
  ✅ The strict list holds for every Mac member on a list, business folder or not
  ✅ Members left on Any site, and offices that never use Sites, see no change at all
  ❌ A listed member in such an office can no longer run a command the sandbox refuses
B) Leave it; say so on the Access tab
  ✅ No change to how commands run in offices without a business folder
  ❌ The owner's list is skippable there, and the tab needs one more caveat to read
Net: make the owner's list real everywhere on a Mac, at the cost of stricter shells for listed members only.
Header: No folder
Options:
A) Hold listed members (recommended)
For a member on "Only sites I list", write `allowUnsandboxedCommands: false` on a Mac even without a business folder; Any site members unchanged. Test: settings for such a member carry it.
B) Leave it, note on the tab
Keep `sandboxOnly: false` there; the Access tab says shell sites are not enforced in an office without a business folder.

State: approved
Actual answer: A) Hold listed members (D2, owner 2026-10-12)
Accepted scope: for a member on "Only sites I list", write `allowUnsandboxedCommands: false` on a Mac even without a business folder; members on Any site unchanged; a settings test proves it.
History: none

### R2: when a changed Sites setting reaches the shell
Finding: S2 [P1] (confidence: 9/10) `src/main/hive.ts:1312-1314`, reviewer Claude
Plan baseline: design writes the network list into `hookSettings` at spawn (original proposal, not approved); R1 approved
Runtime evidence: the settings file is written at spawn ("these settings set its sandbox at its next start"); hook gates read config per call (`src/main/hooks.ts:513`, "Read per call, so a revoke takes effect on the next one"); a model change already restarts the member (locale `modelRestarts`: "(restarts agent)")
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 shell list after a Sites change | unspecified | member restarts at once with new settings, as a model change does; web tools change on the next call | web tools change on the next call; shell list at the member's next start; Access tab says so |
| R1 | approved (D2) | approved (D2) | approved (D2) |
| R3 to R6 | pending | pending | pending |
Question D3:
D3 — When the owner changes a member's Sites, when should shell commands follow? <gstack-qid:plan-eng-review-r2-change-timing>
Project/branch/task: eng review of docs/designs/agent-web-access.md (issue #230).
ELI10: The app's own check on WebFetch and WebSearch reads the setting on every call, so a change applies at once. The shell list sits in the member's settings file, which Claude Code reads only when the member starts. Without a restart, a member just put on a list can still `curl` anywhere until its next start.
Stakes if we pick wrong: the owner tightens Sites after a suspicious email, and the member keeps sending data out until it happens to restart.
Recommendation: A because a security change should hold the moment the owner makes it, and restarting on a settings change already exists for model changes.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Restart the member on a Sites change (recommended)
  ✅ The shell list and the web tools agree from the moment the owner saves
  ✅ Reuses the restart a model change already does, so no new mechanism to build or test
  ❌ The member's current turn is cut short; it resumes its conversation after the restart
B) Apply at the member's next start
  ✅ No interruption to work in progress when the owner edits the list
  ❌ Until the next start, the shell can still reach any site, and the tab needs a note saying so
Net: an immediate, consistent rule at the cost of one interrupted turn, versus no interruption and a window where the list does not hold.
Header: Timing
Options:
A) Restart on a change (recommended)
Saving a changed Sites setting restarts that member with new settings, the way a model change does; WebFetch and WebSearch follow on the next call. Test: a Sites change triggers the restart; an unchanged save does not.
B) Next start, noted on the tab
WebFetch and WebSearch follow on the next call; the shell list applies when the member next starts; the Access tab says so.

State: approved
Actual answer: A) Restart on a change (D3, owner 2026-10-12)
Accepted scope: saving a changed Sites setting restarts that member with new settings, the way a model change does; WebFetch and WebSearch follow on the next call; tests: a Sites change triggers the restart, an unchanged save does not.
History: none

### R3: what a listed site matches
Finding: S3 [P2] (confidence: 8/10) design "example.com also allows www.example.com; no wildcards beyond that at first", reviewer Claude
Plan baseline: exact host plus `www.` (original proposal, not approved); R1, R2 approved
Runtime evidence: Claude Code 2.1.296 `allowedDomains` takes exact names and `*.` wildcards (binary strings: "add ... (or a covering wildcard) to allowedDomains"); the hook gets the host from `new URL(url).hostname` (lowercase, punycode)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 a listed name matches | unspecified | the name and every subdomain (`example.com`, `www.example.com`, `api.example.com`); sandbox gets `example.com` and `*.example.com` | the name and `www.` only; sandbox gets `example.com` and `www.example.com` |
| Both checks from one list (common work) | n/a | yes, one normalized list feeds hook and sandbox, parity test | yes, same |
| R1, R2 | approved (D2, D3) | approved | approved |
| R4 to R6 | pending | pending | pending |
Question D4:
D4 — When the owner lists a site, should it cover that site's subdomains too? <gstack-qid:plan-eng-review-r3-host-match>
Project/branch/task: eng review of docs/designs/agent-web-access.md (issue #230).
ELI10: An owner who lists "quickbooks.com" probably means the whole company site, including api.quickbooks.com. The draft allows only the exact name and its www. form. Either way, one list feeds both the WebFetch check and the shell list, so they never disagree; the question is only how wide a listed name reaches.
Stakes if we pick wrong: too narrow and listed sites half work; too wide and a site that hosts other people's pages under its subdomains becomes a way out.
Recommendation: A because owners list companies, not exact host names, and the risk is limited to sites that host strangers' content under subdomains.
Completeness: A=9/10, B=7/10
Pros / cons:
A) A name covers its subdomains (recommended)
  ✅ Listing quickbooks.com also lets api.quickbooks.com and app.quickbooks.com work, as an owner expects
  ✅ Matches the sandbox wildcard form exactly, so WebFetch and curl agree by construction
  ❌ Listing a host of other people's sites (a shared hosting domain) would open all of them
B) Exact name and www only
  ✅ The tightest rule: nothing the owner did not type, apart from www
  ❌ Services that use an api. or app. subdomain fail until the owner lists each one
Net: owner-friendly breadth versus the tightest list; both keep one list for both checks.
Header: Site match
Options:
A) Name and subdomains (recommended)
A listed name matches itself and every subdomain (dot boundary, so notexample.com never matches); the sandbox gets the name and `*.name`; one normalized list feeds both, with a parity test and a lookalike (punycode) test.
B) Name and www only
A listed name matches itself and `www.` only; the sandbox gets both forms; one normalized list feeds both, with a parity test.

State: approved
Actual answer: A) Name and subdomains (D4, owner 2026-10-12)
Accepted scope: a listed name matches itself and every subdomain on a dot boundary (notexample.com never matches); the sandbox gets the name and `*.name`; one normalized list feeds hook and sandbox; tests: parity between the two, lookalike (punycode) host refused.
History: none

### R4: the default for members who read a mailbox
Finding: design open question 1, reviewer Claude
Plan baseline: Any site for everyone, "so no office changes on upgrade" (original proposal, not approved); R1 to R3 approved
Runtime evidence: injection screening already flags high confidence injection to Michael (owner 2026-10-12); members with a watched mailbox read outside mail today with no web limit
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R4 default Sites for a member with a watched mailbox | Any site (no field yet) | Any site for everyone; the owner opts members in | new hires with a watched mailbox start on "Only sites I list" with an empty list; existing members unchanged |
| R1 to R3 | approved (D2 to D4) | approved | approved |
| R5, R6 | pending | pending | pending |
Question D5:
D5 — Should a new team member who reads a mailbox start with web access limited? <gstack-qid:plan-eng-review-r4-default>
Project/branch/task: eng review of docs/designs/agent-web-access.md (issue #230).
ELI10: The members most at risk are those reading customer mail, because that is where planted instructions arrive. The draft keeps "Any site" as the default for everyone, so nothing changes until you set a list. The alternative starts new hires who watch a mailbox on an empty list (no web at all) until you add sites; current members stay as they are.
Stakes if we pick wrong: a safe default that quietly breaks research a support member needs, or an open default that leaves the riskiest members exposed until you act.
Recommendation: A because the office should keep working without the owner configuring anything, and injection screening already flags planted instructions to Michael; you can tighten a member any time.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Any site for everyone (recommended)
  ✅ No office or new hire changes behavior; nothing breaks the day this ships
  ✅ The owner decides per member, with the Sites field right on the Access tab
  ❌ A new mailbox reader can still reach any site until the owner sets a list
B) New mailbox readers start with no web
  ✅ The riskiest new members are closed by default, before any mail arrives
  ❌ Their web research fails until the owner lists sites, a new setup step that goes against agents working without asking
Net: working by default versus closed by default for the members most exposed to planted instructions.
Header: Default
Options:
A) Any site for everyone (recommended)
Every member, new or existing, starts on Any site; the owner sets a list per member on the Access tab.
B) New mailbox readers: no web
A new hire with a watched mailbox starts on "Only sites I list" with an empty list; existing members unchanged; the hire wizard says so in one line.

State: approved
Actual answer: A) Any site for everyone (D5, owner 2026-10-12)
Accepted scope: every member, new or existing, starts on Any site; the owner sets a list per member on the Access tab; no hire wizard change.
History: none

### R5: Michael and the Sites field
Finding: design open question 2, reviewer Claude
Plan baseline: Michael not covered (original proposal, not approved); R1 to R4 approved
Runtime evidence: Michael runs unsandboxed by design (`src/shared/folderAccess.ts:75` `sandboxOnly: !agent.isGod`), so no shell list can hold for him; the hook gate does run for his WebFetch and WebSearch
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R5 Sites for Michael | none | no field; Michael keeps Any site | a field that limits his WebFetch and WebSearch only; the tab says his shell is not limited |
| R1 to R4 | approved (D2 to D5) | approved | approved |
| R6 | pending | pending | pending |
Question D6:
D6 — Should Michael get a Sites field too? <gstack-qid:plan-eng-review-r5-michael>
Project/branch/task: eng review of docs/designs/agent-web-access.md (issue #230).
ELI10: Michael runs outside the sandbox by design, so a list could only stop his WebFetch and WebSearch, never his shell. Team members read customer mail directly; Michael mostly reads what the team sends him.
Stakes if we pick wrong: a Michael limit that looks complete but is half a rule, or no way to limit the one agent that sees everything.
Recommendation: A because a rule that only half holds on Michael would mislead the owner, and the members reading outside mail are the ones the field protects.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) No Sites field for Michael (recommended)
  ✅ Every Sites field the owner sees holds fully on a Mac; no half rules to explain
  ✅ Michael keeps the research he needs to run the office, with nothing new to configure
  ❌ The owner cannot limit Michael's web access, even partly
B) A web tools only field for Michael
  ✅ The owner can stop Michael's WebFetch and WebSearch if they choose to
  ❌ His shell still reaches any site, so the field needs a caveat and promises less than it seems
Net: only rules that fully hold versus a partial limit on the agent with the widest view.
Header: Michael
Options:
A) No field for Michael (recommended)
Michael keeps Any site; the Sites field appears for team members only.
B) Web tools only for Michael
Michael gets the field; it limits his WebFetch and WebSearch; the tab says his shell commands are not limited.

State: approved
Actual answer: A) No field for Michael (D6, owner 2026-10-12)
Accepted scope: Michael keeps Any site; the Sites field shows for team members only; the hook gate skips Michael.
History: none

### R6: telling Michael about a refused site
Finding: design open question 4, reviewer Claude
Plan baseline: a refused call returns a reason to the member only (original proposal, not approved); R1 to R5 approved
Runtime evidence: injection screening sends only high confidence flags, to Michael, never the owner (owner 2026-10-12); a refused WebFetch is often plain research, not injection; shell refusals happen inside the sandbox and the app does not see them
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R6 a refused WebFetch or WebSearch | n/a | the member gets the reason; nothing else | the member gets the reason, and Michael gets one message per member and site per day |
| R1 to R5 | approved (D2 to D6) | approved | approved |
Question D7:
D7 — When a member is refused a site, should Michael hear about it? <gstack-qid:plan-eng-review-r6-notify-michael>
Project/branch/task: eng review of docs/designs/agent-web-access.md (issue #230).
ELI10: A member on a list who tries an unlisted site gets a plain reason and can ask Michael to have the site added. Most such tries are ordinary research, not an attack. A message to Michael for each refusal would make him notice planted instructions, but also adds noise, and the app cannot see refused shell commands anyway.
Stakes if we pick wrong: Michael buried in routine refusals, or a real planted instruction refused with nobody noticing the attempt.
Recommendation: A because the refusal already stops the data leaving, the member can ask Michael itself, and the injection rule keeps Michael's alerts to high confidence only.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Reason to the member only (recommended)
  ✅ No new messages for Michael; the block itself already stops the data leaving
  ✅ Matches the rule that only high confidence injection flags reach Michael
  ❌ A refused attempt caused by a planted instruction goes unnoticed unless the member mentions it
B) Also tell Michael, once per member and site per day
  ✅ Michael can spot a pattern, such as a member repeatedly trying an odd site after reading mail
  ❌ Routine research refusals reach Michael too, and this is an agent behavior change to list at ship
Net: quiet enforcement versus visibility of attempts at the cost of noise.
Header: Notify
Options:
A) Reason to member only (recommended)
A refused WebFetch or WebSearch returns one plain reason naming the listed sites; no message to Michael.
B) Also tell Michael daily
The member gets the reason, and Michael gets one message per member and site per day naming the tool and host; listed as an agent behavior change.

State: approved
Actual answer: A) Reason to member only (D7, owner 2026-10-12)
Accepted scope: a refused WebFetch or WebSearch returns one plain reason naming the listed sites; no message to Michael.
History: none

Scope Challenge result: scope accepted as-is (R1 to R6 approved, no cuts).

## Section 1: Architecture

```
owner edits Sites (CapabilitiesTab)
        |
        v
mail:setCapabilities IPC ---> config.agentCapabilities[id].web  (list or any)
        |                               |
        | changed? restart member (R2)  | read per call
        v                               v
hookSettings at spawn              HookServer.handle PreToolUse
  sandbox.network.allowedDomains     WebFetch -> URL hostname -> webAccess()
  + strictAllowlist                  WebSearch -> refused under a list
  + allowUnsandboxedCommands:false     (Michael skipped, R5)
  (Mac, list only, R1)              deny -> one plain reason (R6)
        |
        v
Claude Code sandbox: curl, python, node in the shell -> refused off the list
```

Findings:
- A1 [P2] (confidence: 8/10) design open question 0. A listed member's own shell needs: live check (2.1.296) shows an empty strict list refuses every host and `mempalace --help` still runs. `mempalace search` loads a local model; if the model was never downloaded, the first search needs the network. Required proof before ship: run `mempalace search` and a hive message round trip as a listed member on a Mac. Not a new choice (proof for R1 to R3).
- A2 [P3] (confidence: 6/10, medium confidence, verify) config read failure: a missing `web` field means Any site, so an unreadable config opens the hook gate; the shell list written at spawn still holds. Existing gates read the same config. Note in failure modes; no change.
- Windows: the hook gate holds; the shell is not limited (sandbox off, #187); the Access tab says so on Windows. Already in the design.

Dispositions: A1 required proof (task), A2 noted, Windows already planned.

## Section 2: Code quality

Findings:
- Q1 [P2] (confidence: 9/10) `new URL()` hostname edge cases (node, live): `https://Example.COM./x` gives `example.com.` (trailing dot kept), userinfo and port are dropped, punycode stays punycode, IP literals come through. Required proof for R3: strip one trailing dot, lowercase, refuse IP literals unless listed, punycode lookalike refused, `user@host` uses the real host.
- Q2 [P3] (confidence: 7/10) `src/main/hooks.ts:976` `toolDetail` uses `.host` (with port) for display; the gate needs `.hostname`. Different contracts, so no shared helper (rejected extraction, about 2 lines).
- Q3 [P2] (confidence: 8/10) what the owner types into the list is not specified (a pasted URL, `www.`, a wildcard, an IP). New choice R7 below.

### R7: cleaning up what the owner types into the list
Finding: Q3 [P2] (confidence: 8/10), reviewer Claude
Plan baseline: not specified (original proposal); R1 to R6 approved
Runtime evidence: node `new URL()` gives lowercase hostnames, keeps a trailing dot, drops userinfo and port (live, above)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R7 an entry the owner types | unspecified | a pasted URL or host becomes its hostname, lowercase, trailing dot and a leading `www.` removed; an IP address or a wildcard is refused with one plain line | a pasted URL or host becomes its hostname, lowercase, trailing dot removed; `www.` kept as typed; an IP address or a wildcard is refused |
| R1 to R6 | approved (D2 to D7) | approved | approved |
Question D8:
D8 — How should the app clean up a site the owner types into the list? <gstack-qid:plan-eng-review-r7-list-input>
Project/branch/task: eng review of docs/designs/agent-web-access.md (issue #230).
ELI10: Owners will paste things like "https://www.quickbooks.com/pricing". Either way the app keeps only the site name. The question is whether to drop a leading "www." too: since a listed name already covers its subdomains (D4), "www.quickbooks.com" alone would leave out api.quickbooks.com. IP addresses and "*" patterns are refused either way, with one plain line.
Stakes if we pick wrong: an owner lists www.example.com, and the app's api.example.com calls fail for no reason they can see.
Recommendation: A because owners mean the company, and with subdomains covered, dropping www makes "www.example.com" behave like "example.com".
Completeness: A=9/10, B=7/10
Pros / cons:
A) Keep the site name and drop a leading www (recommended)
  ✅ "https://www.example.com/x" and "example.com" become the same entry, covering api. and app. too
  ✅ The list shows clean, short names the owner recognizes
  ❌ An owner who really meant only www.example.com cannot list just that host
B) Keep the site name as typed, with www
  ✅ The list holds exactly the host the owner typed, nothing broader than that and its subdomains
  ❌ Listing www.example.com leaves api.example.com out, which owners will not expect
Net: match how owners think about sites versus exactly what they typed.
Header: List entries
Options:
A) Drop www (recommended)
A pasted URL or host becomes its hostname, lowercase, with a trailing dot and a leading `www.` removed; an IP address or a wildcard is refused with one plain line. Tests cover each form.
B) Keep www as typed
A pasted URL or host becomes its hostname, lowercase, trailing dot removed, `www.` kept; an IP address or a wildcard is refused with one plain line. Tests cover each form.

State: approved
Actual answer: A) Drop www (D8, owner 2026-10-12)
Accepted scope: a pasted URL or host becomes its hostname, lowercase, with a trailing dot and a leading `www.` removed; an IP address or a wildcard is refused with one plain line; tests cover each form.
History: none

Dispositions: Q1 required proof (tests below), Q2 rejected extraction (different contract), Q3 approved as R7 (D8).

## Section 3: Tests

Framework: node:test, `test/*.test.cjs`, `test/load-ts.cjs` for TypeScript sources (existing). Run: `node tools/run-tests.cjs`.

```
CODE PATHS                                              USER FLOWS
[+] src/shared/webAccess.ts (new)                       [+] Owner sets Sites on the Access tab
  |-- normalizeSite(input)  (R7)                          |-- [GAP] Any site -> list -> member restarts (R2)
  |   |-- [GAP] URL, www, trailing dot, case              |-- [GAP] pasted URL saved as clean name (R7)
  |   `-- [GAP] IP / wildcard / empty refused             |-- [GAP] IP or "*" shows one plain line (R7)
  |-- webAccess(cfg, agentId, tool, input)                `-- [GAP] unchanged save does not restart (R2)
  |   |-- [GAP] Any site / no field -> allow            [+] Listed member at work
  |   |-- [GAP] Michael -> allow (R5)                     |-- [GAP] WebFetch listed / subdomain -> ok
  |   |-- [GAP] WebSearch under a list -> deny            |-- [GAP] WebFetch unlisted -> plain reason (R6)
  |   |-- [GAP] host on dot boundary, subdomain (R3)      |-- [GAP] subagent WebFetch gated like parent
  |   `-- [GAP] lookalike, userinfo, IP, bad URL          `-- [GAP] [->E2E live] curl refused, listed ok, Mac
  `-- sandboxNetwork(list)  (R3)                        [+] Windows
      `-- [GAP] name + *.name; empty list stays []        `-- [GAP] Access tab says shell not limited
[+] src/main/hooks.ts gate                              
  |-- [GAP] deny returns permissionDecision deny + reason
  `-- [GAP] non web tools never read the web setting
[+] src/main/hive.ts hookSettings
  |-- [GAP] list -> allowedDomains + strictAllowlist (Mac)
  |-- [GAP] list, no business folder -> allowUnsandboxedCommands:false (R1)
  |-- [GAP] Any site / Michael / Windows -> no network key
  `-- [GAP] parity: hook allows exactly what the sandbox list allows (R3)

COVERAGE: 0/22 paths tested (new feature) | GAPS: 22 (1 live check)
```

Tests to add (all required proof for R1 to R7, no new policy):
- `test/web-access.test.cjs` (new, unit): normalizeSite forms; webAccess allow/deny table (Any, Michael, WebSearch, dot boundary, subdomain, lookalike, userinfo, IP, trailing dot, bad URL); sandboxNetwork output; parity between webAccess and the sandbox list over the same table.
  Value: protects=a listed member reaches only listed sites by WebFetch; fails_when=suffix match drops the dot boundary or a trailing dot or userinfo slips through; why_new=no web rule exists; seam=none; no_claim=sandbox enforcement (settings only, live check covers it)
- extend `test/auto-mode-sandbox.test.cjs`: list -> `sandbox.network.allowedDomains` + `strictAllowlist: true`; no business folder -> `allowUnsandboxedCommands: false`; Any site, Michael, Windows -> no network key.
  Value: protects=the shell list reaches Claude's settings exactly when it should; fails_when=hookSettings drops the network block or forgets R1; why_new=no network key today; seam=none; no_claim=that Claude Code honors it (live check)
- extend `test/claude-connectors.test.cjs` (it drives `HookServer.handle` for the connector gate): WebFetch unlisted -> deny with reason; listed -> pass; WebSearch under a list -> deny; Michael -> pass; config read per call.
  Value: protects=the app gate refuses unlisted sites on every engine and on Windows; fails_when=the gate is skipped or reads a stale setting; why_new=no web gate; seam=none; no_claim=none beyond protects
- capability save test (index.ts IPC): a changed Sites restarts the member; an unchanged save does not (R2).
  Value: protects=a tightened list holds at once; fails_when=the restart is skipped or fires on every save; why_new=no Sites setting; seam=none; no_claim=restart timing in the running app
- Live check before ship (Mac, Claude Code current): a listed member: curl to an unlisted host refused, a listed host works, `mempalace search` works, a hive message round trip works.

Tests made obsolete: none.

Dispositions: all GAPs above are required proof for approved R1 to R7.

## Section 4: Performance

No issues found. The gate is one config read and one `new URL()` per WebFetch or WebSearch call, both rare next to file tools; the other gates already read config per call (`src/main/hooks.ts:513`). The shell check runs inside Claude Code's sandbox proxy.

## Outside voice

Skipped by the owner (D9, 2026-10-12): Codex is reserved for the adversarial pass, with no Claude stand-in. The adversarial pass runs on the diff at ship.

## TODOS.md

- Updated the issue #230 entry with this review's decisions and the pre-ship live check (P1).
- Added "Route a listed site that needs a login through the integration broker" (P3, D10).

Approval readiness: PASS (R1 D2, R2 D3, R3 D4, R4 D5, R5 D6, R6 D7, R7 D8, structure D1, outside voice D9, TODO D10; all owner answers 2026-10-12)

## NOT in scope

- Routing credentialed listed sites through the integration broker: its own design; TODO added (D10).
- Shell limits on Windows: the app turns the sandbox off there (#187); the Access tab says so.
- Michael's web access: no field (D6).
- Other engines: none are offered today (`BUILD_ENGINES`); the per engine record belongs to #48.
- Telling Michael about refusals (D7).

## What already exists

- Hook gate pattern: `mailAccess`, `connectorAccess`, `quickbooksAccess` in `HookServer.handle`, each a pure rule in `src/shared` read per call. Reused as the model.
- Per member access storage: `AgentCapabilities` (`src/shared/mailboxes.ts`) saved through `mail:setCapabilities`. Reused: the Sites setting is one more field there.
- Sandbox settings: `hookSettings` in `src/main/hive.ts` already writes `sandbox` and `allowUnsandboxedCommands`. Extended with `sandbox.network`.
- Member restart on a settings change: the model change path. Reused for R2.
- Host parsing: the standard `new URL().hostname`. No new dependency.

## Failure modes

| Path | Realistic failure | Covered by | Owner sees |
|---|---|---|---|
| WebFetch gate | host spoofed with userinfo, trailing dot or lookalike | unit table (Q1) | the member gets a plain refusal |
| Shell list | Claude Code changes `strictAllowlist` meaning in a new version | live check before ship; settings test | nothing, silently open: re-run the live check on each Claude Code bump (task T7) |
| No business folder | member reruns a command outside the sandbox | settings test (R1) | refused in the terminal |
| Sites change | member keeps the old shell list | restart test (R2) | the member restarts once |
| Config unreadable | `web` field missing reads as Any site | existing config copy-aside; spawn-time shell list still holds | not visible (A2, P3) |
| Empty list | read as unrestricted | live check (deny all on 2.1.296) | every site refused |

Critical gaps: 0. The Claude Code version row is silent if a bump changes behavior; task T7 covers it with a repeatable live check.

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|------|----------------|------------|
| Rule and tests | src/shared, test | — |
| Hook gate | src/main (hooks) | Rule |
| Settings and restart | src/main (hive, index) | Rule |
| Access tab | src/renderer, locales | Rule |

Lane A: Rule then Hook gate then Settings (shared src/main). Lane B: Access tab (after Rule). Execution: build Rule first, then Lane A and Lane B in parallel, merge, then the live check. Conflict flag: `src/main/index.ts` is shared by the restart and IPC changes; keep them in Lane A.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~3h / CC: ~20min)** — src/shared — Add `webAccess.ts`: normalizeSite (R7), webAccess (R3, R5, WebSearch rule), sandboxNetwork (R3)
  - Surfaced by: Section 2 Q1, Q3; R3, R5, R7
  - Files: src/shared/webAccess.ts, src/shared/mailboxes.ts, test/web-access.test.cjs
  - Verify: node --test test/web-access.test.cjs
- [ ] **T2 (P1, human: ~2h / CC: ~10min)** — hooks — Gate WebFetch and WebSearch in `HookServer.handle` with one plain reason (R6)
  - Surfaced by: design step 2; R6
  - Files: src/main/hooks.ts, test/claude-connectors.test.cjs
  - Verify: node --test test/claude-connectors.test.cjs
- [ ] **T3 (P1, human: ~2h / CC: ~15min)** — hive — Write `sandbox.network` + `strictAllowlist` for listed members on a Mac, and `allowUnsandboxedCommands: false` without a business folder (R1)
  - Surfaced by: Scope S1, R1
  - Files: src/main/hive.ts, src/main/index.ts, test/auto-mode-sandbox.test.cjs
  - Verify: node --test test/auto-mode-sandbox.test.cjs
- [ ] **T4 (P1, human: ~2h / CC: ~15min)** — index — Restart a member when its Sites setting changes, not on an unchanged save (R2)
  - Surfaced by: Scope S2, R2
  - Files: src/main/index.ts, a capability save test
  - Verify: node tools/run-tests.cjs
- [ ] **T5 (P1, human: ~4h / CC: ~20min)** — Access tab — Sites field: Any site / Only sites I list, list entry cleanup, Windows note, info icon text; team members only (R5)
  - Surfaced by: design "What the owner sees"; R4, R5, R7
  - Files: src/renderer/src/components/CapabilitiesTab.tsx, src/renderer/src/i18n/locales/{en,zh-CN,ar}.json
  - Verify: node tools/run-tests.cjs (locale parity, no dashes); check the tab in the running app
- [ ] **T6 (P1, human: ~1h / CC: ~10min)** — live — On a Mac, as a listed member: unlisted curl refused, listed works, WebFetch refused off list, `mempalace search` and a hive message round trip work
  - Surfaced by: Section 1 A1
  - Files: none (manual check, record results in the PR)
  - Verify: the four results recorded
- [ ] **T7 (P2, human: ~1h / CC: ~10min)** — tools — Make the T6 shell check repeatable for each Claude Code version bump
  - Surfaced by: Failure modes, Claude Code version row
  - Files: a script under tools/ or a RELEASE.md step
  - Verify: run it against the installed Claude Code

## Unresolved decisions

None in this review.

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 applicable rows emitted (PLAN_REALITY phase=eng rows=7/7 verdict=complete), 2 unverified premises
- Architecture Review: 2 issues found
- Code Quality Review: 3 issues found
- Test Review: diagram produced, 22 gaps identified (new feature)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to user (added), 1 entry updated
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, skipped (owner rule, D9)
- Parallelization: 2 lanes, 1 parallel / 1 sequential
- Lake Score: 6/6 = answers picking a 10/10 option or the top score / answers scored for Completeness

---

# Design review (plan-design-review, 2026-10-12)

Target: the Sites group on a team member's Access tab (this file). Reviewer: Claude, session 89074-1791865013-f29ce111. DESIGN.md: `branding/DESIGN.md` (§2.4 Only what's real, §2.6 Fields first, §7.12 Access). Mockup (HTML/CSS with app tokens, owner rule): `/Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/designs/sites-access-tab-20261012/mockup.html`. Outside voices: skipped (D2, owner rule for Codex).

Step 0: 4/10. The plan named a field and two choices, but no placement, list editing, states, Windows wording, keyboard or right to left.

## The Sites group (approved)

```
Access tab (team member; Michael's panel has no Sites group, eng D6)
  Email                 [Mailboxes: 1]
  Claude connectors     [2 of 4]
  Sites                 [Any site | 3 sites | No sites]      <- new, closed by default (D3)
    Where {name} can send data on the web.
    ( Any site | Only sites I list )  (i)                     <- inline RadioRows, info icon
    [Windows + list only] On Windows this covers web pages and searches, not shell commands yet.  (D11)
    quickbooks.com ......................... [Remove]         <- rows, A to Z, mono, dir=ltr (D8, D9)
    northwindtraders.com ................... [Remove]
    [ Add a site, like example.com ] [Add]                    <- aria-label, Enter adds (D7)
  On a schedule         [2 on]
  (amber) Restarting {name} to apply…                         <- after a change, at once (D6)
```

| Element | Spec |
|---|---|
| Group | `TriggerCard` after Claude connectors, before On a schedule, closed by default (D3) |
| Title / blurb | "Sites" / "Where {name} can send data on the web." (D12) |
| Chip | "Any site", "{n} sites", "No sites" (D3, D12) |
| Switch | inline `RadioRows` [Any site, Only sites I list] with an InfoTip; arrow keys as today |
| Info icon | "A listed site covers its subdomains: example.com also allows app.example.com. With a list, {name} can't search the web. Other sites are refused, and {name} is told why." (D12) |
| Rows | one per site, A to Z, `--cth-font-mono` 12.5 px 500, `overflow-wrap: anywhere`, `dir="ltr"`, line between rows, `MiniButton` Remove with `aria-label` "Remove {site}" (D8, D9) |
| Add field | placeholder "Add a site, like example.com", `aria-label` "Add a site to {name}'s list", `dir="ltr"`, Enter or Add adds; entries cleaned per eng D8 (R7) (D7) |
| Windows line | `ink-3` 12 px, on Windows only and only with a list (D11) |
| Member refusal | "The owner allows {name} only these sites: {sites}." with site names bidi isolated (D9, D12) |

## Interaction states

```
  FEATURE          | LOADING            | EMPTY                                   | ERROR                                            | SUCCESS                         | PARTIAL
  -----------------|--------------------|-----------------------------------------|--------------------------------------------------|---------------------------------|------------------------
  Sites switch     | group hidden until | n/a                                     | "Didn't save. Try again." (existing coral alert) | "Restarting {name} to apply…"   | Windows line (D11)
                   | config loads (tab  |                                         |                                                  | then gone (D6)                  |
                   | today)             |                                         |                                                  |                                 |
  Site list        | n/a                | "No sites yet, so {name} can't reach    | invalid: text kept, coral outline, "Type a site  | row appears A to Z, field clears| n/a
                   |                    | the web." + add field; chip "No sites"  | name, like example.com." role=alert (D5); dup:   |                                 |
                   |                    | (D4)                                    | field clears (D5)                                |                                 |
  Remove           | n/a                | last removed -> empty state, focus to   | save fails -> row stays, existing alert          | row gone, focus next Remove,    | n/a
                   |                    | field (D10)                             |                                                  | "{site} removed" live (D10)     |
  Restart          | "Restarting {name} | n/a                                     | "Couldn't restart {name}. It tries again         | notice clears                   | n/a
                   | to apply…"         |                                         | shortly, or press Restart now." (existing)       |                                 |
```

## Journey

```
  STEP | USER DOES                                | USER FEELS              | PLAN SPECIFIES?
  -----|------------------------------------------|-------------------------|-------------------------------------------
  1    | reads that Kelly handles customer mail   | wary                    | Sites chip "Any site" visible, group closed
  2    | opens Sites, picks Only sites I list     | in control              | empty state names the effect (D4)
  3    | adds quickbooks.com (pastes a URL)       | confident               | cleaned to the name, row appears (eng D8)
  4    | sees "Restarting Kelly to apply…"        | reassured it took       | notice at once (D6)
  5    | later, Kelly is refused a site           | (not told; eng D7)      | Kelly sees the reason; asks Michael if needed
  6    | adds the site Kelly needed               | fine                    | same add flow
  5 sec: chip tells the state. 5 min: list edits never lose text. 5 years: the list stays readable, A to Z, one row each.
```

## Passes

| Pass | Before | After | Remaining gap |
|---|---|---|---|
| 1 Information architecture | 3 | 9 | none material |
| 2 Interaction states | 2 | 9 | none material |
| 3 Journey | 5 | 8 | the owner is not told about refusals (eng D7, by choice) |
| 4 AI slop (App UI) | 7 | 8 | placeholder stays the only visible label (D7, accepted, spoken label added) |
| 5 Design system | 6 | 9 | DESIGN.md §7.12 needs its Sites row (task) |
| 6 Responsive and accessibility | 4 | 9 | none material |

Pass 4 evidence: App UI (Operate). No hard rejections. Litmus: each section one job YES; cards necessary YES (TriggerCard is the tab's container); premium without shadows YES; motion none. Universal rule hit: placeholder as only label (D7).

## Design decisions

| ID | Issue | Answer |
|---|---|---|
| D3 | placement and header | 1A after Claude connectors, chip always shows the state |
| D4 | empty list | 2A allowed, quiet line + add field, chip "No sites" |
| D5 | bad or duplicate entry | 3A keep text, coral line; duplicate clears |
| D6 | restart after a change | 4A keep eng D3: restart at once, "Restarting {name} to apply…" |
| D7 | add field label | 5A aria-label, placeholder kept |
| D8 | list style | 6A rows with Remove, like mailboxes |
| D9 | Arabic | 7A site names left to right, isolated |
| D10 | focus after Remove | 8A next Remove, else previous, else field; live announce |
| D11 | Windows | 9A one ink-3 line, Windows and list only |
| D12 | wording | 10A as in the table above |

## Design NOT in scope

- A notice to Michael or the owner on refusals (eng D7).
- A Sites field for Michael (eng D6).
- Chips for many sites (D8 chose rows; revisit only if owners list dozens).

## What already exists (design)

`TriggerCard` and `Chip` (`src/renderer/src/components/triggers/ui.tsx`), `RadioRows` inline and `MiniButton`, `InfoTip`, the mailbox row styles and the `pendingRestart` notice in `CapabilitiesTab.tsx`, the existing `capabilities.restarting`, `capabilities.restartFailed` and `capabilities.saveFailed` strings.

## Design implementation tasks

- [ ] **DT1 (P1, human: ~4h / CC: ~20min)** — Access tab — Build the Sites group per the table above (D3 to D12)
  - Files: src/renderer/src/components/CapabilitiesTab.tsx, src/renderer/src/i18n/locales/{en,zh-CN,ar}.json
  - Verify: node tools/run-tests.cjs (locale parity, no dashes, i18n keys exist); check the group in the running app, light and dark
- [ ] **DT2 (P1, human: ~1h / CC: ~10min)** — Access tab — Focus after Remove and the live announcement (D10); Arabic site names ltr (D9)
  - Files: CapabilitiesTab.tsx, test/arabic-ui.test.cjs
  - Verify: keyboard walk through add, remove to empty; Arabic UI test asserts dir=ltr on rows and field
- [ ] **DT3 (P2, human: ~20min / CC: ~5min)** — DESIGN.md — Add the Sites row to the §7.12 Access table and a changelog line
  - Files: branding/DESIGN.md
  - Verify: the table lists Sites with its controls

## Design completion summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | DESIGN.md present (branding/), UI scope: one Access group |
  | Step 0               | 4/10, all 7 dimensions (D1)                 |
  | Pass 1  (Info Arch)  | 3/10 → 9/10 after fixes                     |
  | Pass 2  (States)     | 2/10 → 9/10 after fixes                     |
  | Pass 3  (Journey)    | 5/10 → 8/10 after fixes                     |
  | Pass 4  (AI Slop)    | 7/10 → 8/10 after fixes                     |
  | Pass 5  (Design Sys) | 6/10 → 9/10 after fixes                     |
  | Pass 6  (Responsive) | 4/10 → 9/10 after fixes                     |
  | Pass 7  (Decisions)  | 2 resolved, 0 deferred                      |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (3 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 1 HTML mockup, approved through D3 to D12   |
  | Decisions made       | 10 added to plan                            |
  | Decisions deferred   | 0                                           |
  | Overall design score | 2/10 → 8/10                                 |
  +====================================================================+
```

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|----------------|-------------|-----------|-------|
| Access tab, Sites group | /Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/designs/sites-access-tab-20261012/mockup.html | rows with Remove under an inline switch, chip state in the header | HTML/CSS with app tokens (owner rule, no image designer); updated to D3 to D12 |

## Unresolved design decisions

None.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex outside voices (eng plan review and design) | Independent 2nd opinion | 3 | skipped | skipped by owner rule (eng D9, design D2) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 4 | ISSUES OPEN | 27 issues, 0 critical gaps (mapped to T1 to T7, all decisions answered) |
| Design Review | `/plan-design-review` | UI/UX gaps | 4 | CLEAR | score: 2/10 → 8/10, 10 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review and design phases, skipped by the owner's rule (Codex for the adversarial pass only); no findings; the adversarial pass runs on the diff at ship.
- **VERDICT:** DESIGN CLEARED (8/10, every rated pass 8 or more, 0 unresolved). Eng review is not CLEAR (issues_open counts its mapped tasks); eng review required.

NO UNRESOLVED DECISIONS
