# Architecture, project structure and design system

_Moved out of the README so that document can do its job of explaining the product._
_This is the contributor's map. Start here before your first pull request._

## Architecture

Two data planes feed one renderer:

```
┌───────────────────────────────────────────────────────────────┐
│                     Electron Renderer (React)                  │
│   ┌──────────────────┐    ┌──────────────────────────────┐    │
│   │ Office studio    │    │ Terminal + Talk to Michael   │    │
│   │ (SVG, React)     │    │ person panels (xterm.js)     │    │
│   └─────────▲────────┘    └────────────▲─────────────────┘    │
│             │ avatar state             │ pty bytes / fs / git  │
└─────────────┼──────────────────────────┼───────────────────────┘
              │ IPC (contextBridge: window.cth)
       ┌──────┴──────────┐        ┌──────┴─────────────┐
       │  Event Plane    │        │  Terminal Plane    │
       │  hooks / hive   │        │  node-pty PTYs     │
       │  router + GOD   │        │  + fs + git        │
       └────────▲────────┘        └──────▲─────────────┘
                │ hook payloads          │ stdin / stdout
                └─────────┬──────────────┘
                   ┌──────┴──────────────┐
                   │ claude / agy / codex│
                   └─────────────────────┘
```

- **Terminal plane.** The main process owns a `PtyManager` that spawns each agent as a `node-pty`
  process and streams output over per-id IPC (`pty:data:<id>`). The renderer talks only through a
  typed `window.cth` bridge ([`src/preload/index.ts`](../src/preload/index.ts)), which also exposes
  sandboxed filesystem and git helpers.
- **Hive / event plane.** `hive.ts` is the on-disk multi-agent layer; `hooks.ts` runs the hook
  server that provider bridges POST lifecycle payloads to (`cth-hook` for Claude Code, `agy-hook`
  for Antigravity). `memory.ts` wraps the semantic memory CLI. The router delivers messages, drains
  provider outboxes, the GOD agent adjudicates, and idle/inbox wakeups keep workers draining mail.

## Project structure

```
src/
  main/                      Electron main process (Node)
    index.ts                 window, IPC handlers, quit guard
    pty.ts                   node-pty manager (spawn/write/resize/kill/stream)
    hive.ts                  on-disk multi-agent layer (memory, mailboxes, router)
    hooks.ts                 hook server + provider hook shims (`cth-hook`, `agy-hook`)
    hookShell.ts             the shell Claude Code runs hooks and the status line in (bash, or PowerShell on Windows
                             without Git Bash), and each hook command written for it
    memory.ts                semantic memory layer (CLI wrapper, degrade-to-noop)
    config.ts                harness config persistence + home setup; Claude Code's ~/.claude.json (folder trust,
                             the first-run welcome, an approved API key), written to a copy and swapped in;
                             folder trust is keyed as Claude Code looks it up (forward slashes on Windows, claudeProjectKey);
                             a config.json it cannot read is copied beside it before the next save (damagedConfigCopy)
    engineSetup.ts           Get Michael ready: finds Claude without a shell, Claude's standalone install script,
                             sign in state (`claude auth status`), the Anthropic API key check
                             (docs/designs/get-michael-ready.md; status types in shared/engineSetup.ts)
    transcript.ts            reads ~/.claude/projects/ JSONL transcripts for real token/cost telemetry
    telemetry.ts             live OTel collector + usage/cost feed for observability
    usage.ts / pricing.ts    UsageProvider seam + per-model cost attribution
    breaker.ts / control.ts  cost/runaway circuit breaker (steer/constrain/stop) + HITL gate / steer / stop
    reflect.ts               MemoryReflector — memory condensation
    db.ts                    SQLite durable store (window bounds + history) + durable cost ledger
    github.ts                GitHub issue + CI run ingestion via the gh CLI
    shellEnv.ts              resolve PATH and shell env for child processes
    mail.ts                  IMAP/SMTP client for connected mailboxes; the broker calls it for md-mail tool calls
    integrationBroker.ts     loopback secret broker; answers md-mail calls, holds mailbox passwords, enforces Capabilities
    mailApprovals.ts         Send on approval's store (mail-proposals.json in the app's data folder): emails waiting on
                             Ask me, the owner's decisions, standing approvals, Send only send records and pauses,
                             and the Sending changed notice that hands waiting emails back on Can send
                             (docs/designs/send-on-approval.md, shared-mailboxes.md; the rules are in shared/mailProposals.ts)
    standingCheck.ts         the separate quick check (hidden Claude, no tools) that an email fits a standing approval;
                             anything it can't read counts as no, so the email goes to the owner
    integrations.ts          the secret store: every saved password and key in one safeStorage-encrypted file
                             (integration-secrets.json in userData, 0600); refuses to save over a file it can't read
    atomicFile.ts            crash-safe file write (temp file, fsync, rename); the secret store's writer
    officeBreak.ts           the office break when Claude can't work: the plan's usage limit (hooks.ts reports the
                             StopFailure `rate_limit` and the status line's reset time), no credit left, or a sign in or
                             API key that stopped working (docs/designs/office-stopped-account.md); Claude terminals
                             are held, schedules never are (the view and who it holds are in shared/officeBreak.ts)
    trustLayer.ts            the trust layer around Pete, the Research team member (docs/designs/research-agent-privacy.md):
                             inbound it passes, cleans or denies anything for him; outbound it strips instructions aimed
                             at agents and flags a steering answer to Michael; fixed patterns mark and recheck what
                             goes in to him; anything unsure, slow or failing is refused
    researchGoal.ts          Pete's Work style and jobs, as the trust layer passed them (his built in text until then)
    researchNotes.ts         Pete's notes for the shared memory: plain files inside his own folder only
    factoryReset.ts          what Settings, Reset & start over erases (app:resetAll in index.ts): everything the app
                             made for the office, in the office folder and the app's data folder; team folders,
                             roster backups, the owner's own files and the Claude sign in stay
    closingTime.ts           Closing Time shutdown protocol (the office reopens on next launch, shared/officeOpen.ts)
                             The closing time bar (ClosingTimeBar) lists who is still working (hook `detail` from hooks.ts toolDetail),
                             with Remind and Close without them (never pty:kill: that archives the agent).
                             start({relaunch}) reopens the app once closed (a Claude Code update, shared/cliUpdate.ts)
    fs.ts / git.ts           sandboxed filesystem + git bridges; fs.ts also checks a file Michael names
                             (askFileVerdict) and reads it for a file tab (readAskFile), office and team folders only
    packs.ts                 loads and validates the bundled Office Packs (resources/packs/)
    agentFolders.ts          each agent's folder under ~/Documents/<Business> (Michael's), plus the Office folder
    homeFolder.ts            office (harness home) folder checks behind the "can't find your office" screen
    harnessGuard.ts          PreToolUse guard that keeps agents from saving work in the harness folder
    docText.ts / docTextCli.ts / macOcr.ts   Word, Excel, PowerPoint, PDF and scan reading (OCR via macOS Vision)
    claudeCliVersion.ts      installed Claude Code version, for the Opus 5.5 / Opus 5 model floor and the
                             Claude Code update notice (index.ts records each agent's started version)
    hireCheck.ts             the hire wizard's distinct job check (hidden Claude call, rules as fallback)
    workStyleConvert.ts      turns a plain work style into an agent's instructions and back, and writes the
                             hire wizard's "Suggest me" draft
    transcriptText.ts        reads a hidden Claude call's answer from its own session transcript
    screenAnswer.ts          reads a hidden Claude call's answer off its screen while it streams (a live preview)
  shared/                    code both processes use
    buildFeatures.ts         switches for surfaces hidden in this build (git, IDE, temp workers, org trigger)
    agentProvider.ts         engine presets; BUILD_ENGINES is what setup offers (Claude Code today)
    officePack.ts / officeRoles.ts / businessProfile.ts / teamPlan.ts   Office Pack schema, show roles, business profile, team plan
    agentDefinition.ts       each agent's levels and outward capabilities
    mailboxes.ts             mailbox and Capabilities types, providers, and mailAccess (the one mail rule,
                             Send only grants from another member's mailbox included: shared-mailboxes.md)
    quickbooks.ts            QuickBooks through the owner's Claude account: which connector tools count, read vs change,
                             and quickbooksAccess (the hook's rule: the QuickBooks row's switch in Claude connectors,
                             off by default, then per agent;
                             books roles like Oscar default to Read only)
    officeOpen.ts            the Office open message each agent gets after closing time
    cliUpdate.ts             whether live Claude agents run an older Claude Code than the one installed
                             (cliUpdate:status push, cliUpdate:current pull)
    folderAccess.ts          who may open and change which folder: sandbox, permission rules, hook checks;
                             Pete's walls (his own folders only; his file tools open no temp folder, his shell
                             only /tmp) and everyone's wall around his
    ownValue.ts              reads a lookup table by its own keys only, never one inherited from Object
    appName.ts               app name, data folder name, dontbemichael:// URL scheme
    missions.ts              schedules: ownership, next run, the scheduler's arm plan, one-schedule edits,
                             and agent schedule requests: Michael decides them, the owner only those he passes on
    scheduleTimes.ts         a schedule's "when" lines (every N or at a time, per day) and the next due slot
    hireTemplates.ts         the jobs the hire wizard offers, a hire's own folder, the instant distinct job rules
    workStyleText.ts         work style as plain words and as instructions: the prompts and plain fallbacks
    handoffRule.ts           only Michael assigns: the router sends a teammate's request to another teammate to him
    agentProfile.ts          splits an agent's role line into the parts its Profile tab shows
    messageView.ts           the Messages tab as a day-grouped history, office notices counted on one line
    askMeRouting.ts          where an owner's Ask me answer goes: the agent that raised the question, and
                             Michael as a request to route the follow up; Report cards are entries of kind report
    ownerRequests.ts         Michael's open requests from the owner, Blocked cards with nothing asked, the launch
                             catch-up and "hasn't moved this" in office hours (docs/designs/card-lifecycle.md), and
                             the owner's questions in Michael's conversation dock (docs/designs/michael-replies.md)
    mailProposals.ts         Send on approval's rules: proposals and their states, what an approved send may carry,
                             standing approvals and the fit check's prompt, threading from a Send only member's own sends
    starterJobs.ts           the schedules a pack gives a hire, timed to the pack's office hours (docs/designs/inbox-zero.md)
    firstTask.ts             a hire's first task card and Michael's request to hand it out (docs/designs/first-task-card.md);
                             legacyFirstTasks.ts holds the old First task texts the one-time cleanup matches
    workStyleUpdates.ts      a newer default job description offered on Ask me to someone already hired
    michaelWorkStyle.ts      Michael's default Work style
    agentAccess.ts           what an agent can really reach, for its profile's Uses row
    submitConfirm.ts         confirms a line typed into an agent's terminal was submitted, pressing Enter again if not
    terminalOverflow.ts      the office log line for a terminal still drawn past its box after a fit (sizes only)
    askFiles.ts              which text names a file (a code span or a full path with a known ending), and which
                             files open in a tab or in their own app (docs/designs/open-file-tab.md)
    officeBreak.ts           the office break's view for the renderer (usage limit, credit or sign in), and
                             heldByBreak (Claude agents only)
    research.ts              the Research team member: its id, default name (Pete; the owner may rename it, and
                             researchText shows the current one), house rule 9, refusal reasons and the reply label
    dataClasses.ts           the kinds of data the owner keeps private (Settings, Research & privacy) and the fixed
                             patterns the trust layer marks them with
    webAccess.ts             who may use web pages and search (the Research agent alone, in every office), and the empty
                             shell network list everyone else's sandbox gets, Michael included
  preload/                   contextBridge → typed window.cth API
  renderer/src/
    App.tsx                  top-level layout + wiring
    design/                  tokens.css / tokens.ts / global.css (design source of truth)
    components/              AgentDetailPanel, OnboardingWizard, SettingsModal, TaskDetailOverlay, …
    CommandCenterPanel,      Michael's control surface (Profile/Access/Work/Office schedule/Memory/Advanced tabs, plus
                             History once a webhook exists; Advanced holds Monitor and Activity). Office schedule is a
                             read-only list of every enabled job
    AskMeTab,                the Ask me cards on the Needs you board, agents' schedule requests included, and
                             Report cards (cleared with Got it)
    GetMichaelReady,         setup's Ready step: the Claude Code and Claude account rows, and Use an API key;
                             EngineSetupCard puts the same rows on Ask me while Michael can't start
    MailProposalCards,       Ask me cards for emails waiting on approval (edit, Approve, Ask for changes, Don't send,
                             and the agent's offer to send that kind without asking); sendingLabels.ts names each
                             Sending choice
    CapabilitiesTab,         every agent's Access tab (Michael included): the Email section (the addresses
                             it uses: the one inbox it watches and the one it sends only from, each with
                             Can send / Send on approval / Draft only, and Add a mailbox), the Claude connectors card (a switch per
                             connector the owner turned on; QuickBooks keeps Read only / Can make changes)
                             and the On a schedule section
    MailboxesSettings,       Settings > Connections > Mailboxes and AddMailboxDialog
    ClaudeConnectorsSettings, Settings > Connections > Claude connectors: every connector on the owner's Claude
                             account (main/claudeMcpList.ts runs `claude mcp list`), the owner's switch for each;
                             the rules (shared/claudeConnectors.ts: connectorAccess for the PreToolUse hook,
                             spawnConnectorPlan for start-up) are in docs/designs/claude-connectors.md
    SettingsHeroCard,        Settings > General's one About and Updates card; its What's new link opens
                             WhatsNewPopover (docs/designs/about-updates-card.md)
    triggers/ScheduleList,   per-agent schedules: the On a schedule section of Access (agent mode) and
                             Michael's Office schedule tab (office mode); rules live in shared/missions.ts
    triggers/WhenLines,      the several "when" lines one schedule can have
    ScheduleRequestCards,    Ask me cards for schedule requests Michael passed to the owner (Approve / Decline)
    WorkStyleUpdateCards,    Ask me cards offering a newer default job description (Use the new one / Keep mine)
    ScheduledJobs,           an agent's scheduled jobs and their focus areas, shown with its Work style
    AddAgentModal,           the hire wizard (Who, Job, Role, Finalize); EditAgentModal edits the plain work style
    ResearchPrivacySettings, Settings > Research & privacy: Pete's on and off row and what the team may send him;
                             shell/research.ts starts and stops it, in every office, and gives its current name
    ErrorBoundary,           a crash in the window shows a recovery screen with Reload, not a blank window
    ProfileTab,              the first tab on every agent: job, folder (Open folder), full instructions
    MemoryNotes,             an agent's Memory tab as grouped notes; "Show the file" keeps the raw text
    OwnerViaMichaelBar,      replaces a team member's message box outside 1:1 (Message Michael / Talk 1:1)
    OfficeFolderMissing,     launch screen shown only when the office folder is missing
    CliUpdateNotice,         "team upgrade ready" title-bar chip and corner note; its click runs closing time
                             with relaunch, "later" waits for a newer version (localStorage cth.cliUpdateLaterFor)
    ToolWaterfall,           per-agent tool-span waterfall for the observability view
    TasksKanban,             dependency-aware kanban board (the Tasks view); the owner closes a card as Done,
                             never deletes it, and a Done card shows Michael's result (hiveTasks.ts holds the card
                             types and parser)
    FileChip,                a file named in a reply, an Ask me card or a task, as a chip in place of its path
                             (markdown/remarkFileChips.ts finds them); FileTabView shows an opened file in its tab
                             (store/fileTabs.ts keeps the tabs; docs/designs/open-file-tab.md)
    OfficeBreakNotice,       the office break's card on Ask me and its chip in the top bar
    ThreadsPanel,            hive message conversation viewer (Messages tab)
    MessageQueueComposer,    park messages for a busy agent; on Michael's panel a question goes to his dock (shell/ownerSend.ts)
    scene/studio/            the office studio: isometric SVG stage, pods, Michael's office, life layer (branding/DESIGN.md 8)
    scene/office/            the cast, the idle lines, and each character's prop and department icon (props.tsx,
                             PersonAvatar)
    shell/                   top bar (view tabs: Office, Tasks, Who talks to whom, then file tabs), bottom bar, Needs you board,
                             panel chrome, dialogs; releaseBindings.ts gives a leaving hire's work back to teammates,
                             typedFirstTask.ts sends a First task the owner typed to Michael as a card,
                             MichaelDock.tsx is Michael's conversation dock above the Talk to Michael box, and
                             ownerSend.ts files a question for it (a known slash command still types into his terminal)
    store/ · hooks/          zustand store, event loop, PTY parser, typewriter
    assets/                  fonts (see ATTRIBUTION.md)
resources/packs/             bundled Office Packs (core + one per business type)
resources/md-mail-mcp.cjs    md-mail MCP server: an agent's mail tools, forwarded to the broker
docs/                        `model-catalog.json` and `hero.json` (fetched by the app at runtime)
docs/demo/studio-lab.html    the studio lab, built by `npm run lab`
tools/studio-lab/            the studio lab and the reference screens (`npm run lab`, `npm run shoot`)
docs/designs/                design docs, including business-mode-office-packs.md (the business mode design and its decisions)
                             (the old project's website files still here are tracked for removal in TODOS.md)
branding/reference/studio/   the app's reference screens, also the README's images (npm run shoot)
landing-remotion/            Remotion project that renders the landing page's "how it works" clips
HIVE.md · SPEC.md · DESIGN.md   multi-agent · terminal/event · visual design
docs/message-queue.md        who may type into an agent's terminal, and when
```

<div align="right">(<a href="#architecture-project-structure-and-design-system">↑ back to top</a>)</div>

## Design system

The look is **Studio** (design system v2): a calm isometric office drawn in SVG, with Sora for
the interface and JetBrains Mono for data, in light and dark. [`branding/DESIGN.md`](../branding/DESIGN.md)
is canonical; every component derives from its tokens (`src/renderer/src/design/`). Team members
are the cast of *The Office*, each shown as a pod in their department's color.

