/**
 * Environment construction for agent PTYs, as a pure function so the layering
 * is testable off-process (the same trick `buildMissingCliScript` uses for its
 * `platform` parameter).
 *
 * The layering rule, bottom to top:
 *   1. the inherited environment, minus the parent Claude session's identity
 *   2. the app's own defaults (PATH, terminal identity, locale)
 *   3. per-agent values (`opts.env`) — always win, even over the strip below
 */

/**
 * The app is often launched from INSIDE a Claude Code session (`npm run dev`
 * typed into a claude terminal), so that session's identity markers arrive via
 * `process.env` and would flow into every agent CLI. CLAUDE_CODE_CHILD_SESSION
 * makes the agent believe it is a child session and silently DISABLES
 * transcript saving ("Transcript saving is off — inherited
 * CLAUDE_CODE_CHILD_SESSION marker"), which breaks --resume for every agent of
 * that run: their sessions never reach disk (bit us live 2026-08-16/17 — no
 * worker transcript ever existed). The session id, pid, messaging socket+token,
 * effort, execpath and entrypoint likewise all describe the PARENT session,
 * never a fresh agent.
 *
 * Stripped by PREFIX rather than by name: the CLI grows new markers faster
 * than a hardcoded list keeps up (a five-name list was already seven short of
 * a live session's dump when review caught it). Agents are top-level sessions
 * regardless of how the app was launched, so they inherit NONE of the parent's
 * Claude identity.
 */
const CLAUDE_MARKER_RE = /^CLAUDE(CODE|_)/;

/**
 * Configuration, not identity: these share the prefix but are the OPERATOR's
 * own choices — where the CLI keeps its config, how it authenticates, which
 * backend serves it. An operator who exported them wants agents to see them,
 * and stripping them breaks agents in exactly the quiet way the strip above
 * exists to prevent. Everything session-scoped stays out of this list.
 */
const CLAUDE_CONFIG_KEEP = new Set([
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX'
]);

/**
 * Names that look like a key, token or password. An agent whose shell reaches
 * the internet (Research, issue #230) inherits none of these: a web page could
 * ask it to print and send them. The sign in Claude Code itself uses is
 * kept (providerAuth), because the CLI needs it and its subprocess scrub
 * removes those from every command it runs.
 */
const SECRET_NAME_RE = /(?:TOKEN|SECRET|PASSWORD|PASSWD|PASS|PAT|KEY|CREDENTIALS?|AUTH|DSN|WEBHOOK)(?:_|$)|CONNECTION_STRING|DATABASE_URL/i;
/** A value holding a password in an address: a scheme, then user, colon,
 *  password and @ before the host. */
const URL_PASSWORD_RE = /[a-z][\w+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i;

/** The sign in Claude Code itself needs, kept only for the backend in use:
 *  its subprocess scrub removes these from every command it runs. */
function providerAuth(name: string, env: Record<string, string | undefined>): boolean {
  if (/^CLAUDE_/.test(name)) return true;
  if (['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_CUSTOM_HEADERS'].includes(name)) return true;
  if (env.CLAUDE_CODE_USE_BEDROCK && /^AWS_/.test(name)) return true;
  if (env.CLAUDE_CODE_USE_VERTEX && (name === 'GOOGLE_APPLICATION_CREDENTIALS' || /^CLOUDSDK_/.test(name))) return true;
  return false;
}

export function isInheritedSecret(name: string, value = '', env: Record<string, string | undefined> = {}): boolean {
  if (providerAuth(name, env)) return false;
  return SECRET_NAME_RE.test(name) || URL_PASSWORD_RE.test(value);
}

export function buildPtyEnv(
  parentEnv: NodeJS.ProcessEnv,
  userPath: string,
  agentEnv?: Record<string, string>,
  platform: NodeJS.Platform = process.platform
): Record<string, string> {
  // Layer 1 — inherit, minus the parent session's Claude identity. Only this
  // layer is stripped: a marker set deliberately via `agentEnv` below survives,
  // so per-agent environment overrides (and future per-agent env features)
  // cannot be silently wiped by the strip.
  const inherited: Record<string, string> = {};
  // Set for Research (index.ts): commands it runs get no keys or tokens.
  const scrub = agentEnv?.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB === '1';
  for (const [k, v] of Object.entries(parentEnv)) {
    if (v === undefined) continue;
    if (CLAUDE_MARKER_RE.test(k) && !CLAUDE_CONFIG_KEEP.has(k)) continue;
    if (scrub && isInheritedSecret(k, v, parentEnv)) continue;
    // Windows names it "Path", and names ignore case there: kept beside the
    // PATH below, the child reads the inherited one and never sees ours.
    if (platform === 'win32' && k.toUpperCase() === 'PATH') continue;
    inherited[k] = v;
  }
  return {
    ...inherited,
    PATH: userPath,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    // Help apps that look for a real interactive shell
    FORCE_COLOR: '1',
    // A Finder/Dock-launched Electron app inherits NO locale from launchd
    // (`launchctl getenv LANG` is empty), so without this every child runs in
    // the C/POSIX locale — where macOS's CoreFoundation default text encoding
    // is Mac OS Roman (__CF_USER_TEXT_ENCODING=<uid>:0:0). Any locale-sensitive
    // tool an agent runs then decodes UTF-8 as MacRoman and paints mojibake
    // into the grid ("—" → "‚Äî"), which copy faithfully reproduces. This
    // terminal IS UTF-8 (xterm.js + Unicode11), so say so.
    //
    // LC_CTYPE only, deliberately: it is the character-encoding category. Using
    // LC_ALL would also override collation and date formatting for every user
    // who never exported a locale. A locale the user really did export wins.
    ...(platform === 'win32'
      ? {}
      : {
          LANG: parentEnv.LANG ?? 'en_US.UTF-8',
          LC_CTYPE:
            parentEnv.LC_ALL ?? parentEnv.LC_CTYPE ?? parentEnv.LANG ?? 'en_US.UTF-8'
        }),
    // Per-agent hive identity (AGENT_ID, HIVE_ROOT, …) when provided.
    ...(agentEnv ?? {})
  };
}
