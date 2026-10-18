/**
 * Surfaces this build hides from the owner. The code behind each stays wired,
 * so bringing one back is flipping its switch here and nothing else.
 */

/** Git: the agents' GIT sidebar tab, and the IDE's CHANGES / HISTORY / COMPARE
 *  rail (the only git view Michael had). Business owners never use version
 *  control, and a diff view reads as something broken (owner, 2026-09-23). */
export const SHOW_GIT = false;

/** Traces: the per agent tool call trace tab. A developer view; in the 380 px
 *  person panel it also pushed the tab row past the edge ("Trac", review
 *  2026-10-01). DESIGN.md 7.11 keeps it behind a flag. */
export const SHOW_TRACES = false;

/** Developer tools on Settings → Prerequisites: the git and Node.js rows, and
 *  every agent engine this build doesn't offer (BUILD_ENGINES). Owners only need
 *  Claude Code, uv and MemPalace; the rest read as problems ("NOT SET UP") that
 *  change nothing they see. git only keeps the office's own history and Node is
 *  covered by the app's bundled copy (owner, 2026-09-25). */
export const SHOW_DEV_TOOLS = false;

/** The IDE: the full window code editor with a file tree, opened from the IDE
 *  button on every agent (Michael's panel, the agent panel, focus mode) and
 *  from file links in a terminal. Owners don't edit code; a file link now shows
 *  the file in Finder instead (owner, 2026-09-23). */
export const SHOW_IDE = false;

/** Focus mode: the full window terminal with a roster of everyone, opened from
 *  the top bar, from Focus on a Work tab terminal, and reopened at launch by a
 *  saved preference. Hidden: the office, the panels and the Work tab cover
 *  what an owner needs (owner, 2026-10-01). */
export const SHOW_FOCUS_MODE = false;

/** Temporary helpers Michael starts on his own (spawn requests → ephemeral
 *  workers), plus the Settings toggle that allowed it and the WORKERS tab that
 *  listed them. Off in this build: starting an agent is a spend the owner never
 *  saw. When a job fits no one on the team and is too big for Michael, he puts
 *  it on the ASK ME board with suggestions instead (owner, 2026-09-24). */
export const ALLOW_TEMP_WORKERS = false;

/** ORGANISATION: an org key that would let teammates' offices message this
 *  one. Configuration only (no transport reads the key yet), so it is hidden
 *  from the Triggers tab and Settings → Connections, and a leftover key no
 *  longer surfaces the History tab (owner, 2026-09-24). */
export const SHOW_ORG_TRIGGER = false;

/** Anonymous usage stats (TELEMETRY.md): the "Share anonymous usage stats" row
 *  in onboarding, the switch in Settings → General, and sending itself. Off
 *  until the owner decides whether to collect anything at all. While off,
 *  nothing is sent even if a release is built with a PostHog key, so the app
 *  never sends without having shown the choice (owner, 2026-09-24). */
export const COLLECT_USAGE_STATS = false;

/** The "auto mode on / off" text in the header bar. It named a developer
 *  setting in words owners don't use, and it wasn't clickable. The setting
 *  itself is unchanged and stays in Settings → Agents
 *  (owner, 2026-09-24). */
export const SHOW_AUTO_MODE_LABEL = false;

/** The red close button on a team member's panel and in its full screen view.
 *  It stopped the agent mid-task and archived it, with no button to bring it
 *  back and no return on relaunch, behind a confirm that spoke of a "PTY"
 *  (owner, 2026-09-24). Michael never had it. */
export const SHOW_CLOSE_AGENT = false;

/** "Block tools" and "stop after this step" on a team member's panel and focus
 *  view. Owners manage the team through Michael; the circuit breaker still
 *  steps in on its own when an agent loops or overspends (owner, 2026-09-25). */
export const SHOW_AGENT_BRAKES = false;

/** "Open a Terminal window here": the open button next to edit on each agent,
 *  the same button in the full screen view, and the terminal icon beside each
 *  folder in Michael's Command Center. A developer tool owners don't use
 *  (owner, 2026-09-24). */
export const SHOW_OPEN_TERMINAL = false;

/** The Auto / Pause switch in Michael's Command Center header, which holds
 *  every queued message for every agent. A power-user control owners had no
 *  use for (owner, 2026-09-24). While it is hidden, a pause saved earlier is
 *  cleared at launch, so no one is left with messages held and no switch to
 *  release them. */
export const SHOW_DELIVERY_SWITCH = false;

/** Hiring by voice: voice Michael's spawn_agent tool, the hiring lines in his
 *  instructions, and the main process accepting a spawn request from him. Off
 *  for now (owner, 2026-09-24); the rest of voice Michael is unchanged. */
export const ALLOW_VOICE_HIRE = false;

/** Voice, entirely: talking to Michael (the Talk toggle on his card and in
 *  full screen) and dictation (the mic in the message box and hold Option in a
 *  terminal), plus the Voice tab in Settings. Main also refuses to start a
 *  voice session or transcribe audio while this is off (owner, 2026-09-24). */
export const SHOW_VOICE = false;

/** Office Theme in Settings → General: the switch that turns on TV show
 *  office maps and the map picker. Hidden (owner, 2026-09-26). While it is
 *  hidden the floor always shows the office, so a theme picked earlier cannot
 *  stay on with no way to turn it off. */
export const SHOW_OFFICE_THEME = false;

/** "Explain things simply" in Settings → General. Hidden (owner, 2026-10-02).
 *  The saved audience still applies: agents keep briefing in plain language
 *  when it was on, and nothing changes for an office that never set it. */
export const SHOW_SIMPLE_MODE_SWITCH = false;

/** "Arabic / RTL text in terminals" in Settings → General. Hidden (owner,
 *  2026-10-02). The terminal shaping still follows the app language, and a
 *  choice saved earlier still applies. */
export const SHOW_ARABIC_TERMINAL_SWITCH = false;

/** The Language section in Settings → General. Hidden (owner, 2026-10-02).
 *  The app keeps a language saved earlier, else English (i18n/index.ts never
 *  reads the OS locale); with this off there is no other picker in the app. */
export const SHOW_LANGUAGE_PICKER = false;

/** Slack: the Slack block in Settings → Connections (switch, signing secret,
 *  bot token, channel, port, posting, Start and Stop, setup steps). Hidden
 *  (owner, 2026-09-26). While hidden the Slack listener never starts, even
 *  with a connection saved earlier, so nothing runs that the owner cannot see
 *  or stop. Webhooks are separate and unchanged. */
export const SHOW_SLACK = false;

/** Mailboxes: the Mailboxes block in Settings → Connections, the Email
 *  section on an agent's Capabilities tab, the mailbox option in the hire
 *  wizard, and the mailbox posts and tags on the office floor. While off, no
 *  agent is started with the md-mail server, even with email saved earlier.
 *  On in this build (docs/designs/multi-mailbox.md, plan section 9). */
export const SHOW_MAILBOXES = true;

/** The "Safe & read only" list in Settings → Connections (Sequential
 *  Thinking, Time, Fetch, Context7 Docs, Filesystem, Git). Hidden (owner,
 *  2026-09-26): none of it is a choice a business owner can make, and none of
 *  it does anything today. Claude Code ignores `mcpServers` in the settings
 *  file each agent starts with, so these servers never load (agents use their
 *  built in file and web tools instead). The servers that need an explicit yes
 *  are listed below it and stay. */
export const SHOW_READONLY_SERVERS = false;

/** The whole Default MCP servers section in Settings → Connections. Hidden
 *  (owner, 2026-10-01): its servers go into each agent's settings file, and
 *  Claude Code ignores `mcpServers` there (probe on 2.1.287: 0 loaded from
 *  `--settings`, loaded from `--mcp-config`), so the GitHub, database and
 *  search switches did nothing either. Bring it back once the servers are
 *  passed with `--mcp-config`, like the md-mail server. */
export const SHOW_MCP_DEFAULTS = false;

/** Import hire in Add Agent: the "import hire…" button, its explainer and the
 *  "generate one with AI…" prompt. Hidden (owner, 2026-09-27); adding a team
 *  member is the form alone. The import code stays for when it comes back. */
export const SHOW_IMPORT_HIRE = false;

/** The hire wizard's engine chips and raw command line: developer options. A
 *  business owner picks only Best or Fast (hire redesign D3, owner 2026-09-27);
 *  every hire runs on the engine set in Settings. */
export const SHOW_ENGINE_PICKER = false;
