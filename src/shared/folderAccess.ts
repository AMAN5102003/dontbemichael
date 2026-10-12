/**
 * Who may open and change which folder in an office (owner, 2026-09-25).
 *
 *  - Every agent's folder is private: only that agent (and anyone sharing the
 *    folder, which agents in the same role do by default) and anyone above it
 *    can open it. Michael's folder is no exception: only he and the owner (who
 *    isn't an agent) open it.
 *  - Michael works in the business folder (`~/Documents/<Business>`), and every
 *    team member's folder sits inside it by default. He is the only boss today.
 *  - A boss can READ a team member's folder but not change it. To get a file
 *    into it, the boss asks the team member.
 *  - Company wide information, policies and rules are shared through the
 *    knowledge feature, which every agent searches; no folder is shared.
 *
 * One pure module feeds both layers that enforce this:
 *  - `folderPolicy` becomes the Claude Code settings for a spawn: the OS
 *    sandbox (which covers shell commands, even in auto mode, on a Mac and
 *    Linux; Claude Code has no sandbox on Windows, so shell commands are not
 *    limited there, owner 2026-10-09) plus permission deny rules (which cover
 *    Claude's own file tools on every platform).
 *  - `folderDecision` is asked by the PreToolUse hook on every file tool call,
 *    so it sees folders created after the agent started, and it covers Michael's
 *    own top-level files, which a static rule can't express without also hiding
 *    the folders inside it.
 *
 * Kept in one place so a later owner-defined sharing screen can replace the
 * rules without touching the plumbing.
 */

import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface FolderLayout {
  /** Michael's folder: the business folder. Undefined on an office without one. */
  business?: string;
  /** Every team member's working folder (never Michael's), each once. */
  teamFolders: string[];
  /** The app's own private folder (`<harnessHome>/private`, issue #63): agents'
   *  mail tokens and the owner's sent questions. No agent, Michael included,
   *  opens or changes it. */
  appPrivate?: string;
  /** The app's own program and settings folders: the hook program
   *  (`<harnessHome>/hive/bin`), which Claude Code runs outside the sandbox on
   *  every tool call, and each agent's Claude settings
   *  (`<harnessHome>/agent-settings`), which set its sandbox at its next start
   *  (issue 100). Any agent may read them; none, Michael included, changes them. */
  appLocked?: string[];
}

export interface AgentFolderPolicy {
  /** `sandbox.filesystem` additions for Claude Code. */
  sandbox: { denyWrite: string[]; denyRead: string[]; allowRead: string[] };
  /** `permissions.deny` rules, e.g. `Read(//Users/a/Documents/Biz/Finance/**)`. */
  deny: string[];
  /** No shell command may run outside the sandbox (`allowUnsandboxedCommands:
   *  false`). Without it, an agent in auto mode can rerun a command with the
   *  sandbox off and read any folder (owner, 2026-09-25). Team members only. */
  sandboxOnly: boolean;
}

export interface FolderAgent {
  isGod: boolean;
  /** The folder the agent works in. */
  cwd: string;
}

/** Claude's file tools that only read. */
export const FOLDER_READ_TOOLS: ReadonlySet<string> = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
/** Claude's file tools that write. */
export const FOLDER_WRITE_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** The Claude Code settings that hold an agent to its folders. */
export function folderPolicy(agent: FolderAgent, layout: FolderLayout, caseInsensitive: boolean): AgentFolderPolicy {
  const same = sameFn(caseInsensitive);
  const inside = insideFn(caseInsensitive);
  const policy: AgentFolderPolicy = { sandbox: { denyWrite: [], denyRead: [], allowRead: [] }, deny: [], sandboxOnly: !agent.isGod };
  // Nobody opens the app's private folder: a sibling's live mail token sits
  // there while it runs (#63). Claude's CLI still reads its own --mcp-config.
  if (layout.appPrivate) {
    policy.sandbox.denyRead.push(layout.appPrivate);
    policy.sandbox.denyWrite.push(layout.appPrivate);
    policy.deny.push(rule('Read', layout.appPrivate), rule('Edit', layout.appPrivate));
  }
  for (const f of layout.appLocked ?? []) {
    policy.sandbox.denyWrite.push(f);
    policy.deny.push(rule('Edit', f));
  }

  if (agent.isGod) {
    // Read everything; change nothing that belongs to a team member.
    for (const f of teamFoldersOf(layout, same)) {
      if (inside(f, agent.cwd)) continue; // never lock Michael out of his own folder
      policy.sandbox.denyWrite.push(f);
      policy.deny.push(rule('Edit', f));
    }
    return policy;
  }

  const own = agent.cwd;
  const others = teamFoldersOf(layout, same).filter((f) => !same(f, own) && !inside(f, own));
  // Michael's folder, except this agent's own. allowRead wins over denyRead in
  // Claude's sandbox, so the agent keeps its own folder when it sits inside
  // Michael's.
  if (layout.business && !inside(own, layout.business)) {
    policy.sandbox.denyRead.push(layout.business);
    policy.sandbox.allowRead.push(own);
  }
  for (const f of others) {
    policy.sandbox.denyRead.push(f);
    policy.deny.push(rule('Read', f), rule('Edit', f));
  }
  return policy;
}

/**
 * Whether one file tool call is allowed. `target` is absolute. Reasons go
 * straight back to the agent, so each one says what to do instead.
 */
export function folderDecision(
  agent: FolderAgent,
  layout: FolderLayout,
  tool: string,
  target: string,
  caseInsensitive: boolean,
  godName = 'Michael'
): { deny: boolean; reason?: string } {
  const writes = FOLDER_WRITE_TOOLS.has(tool);
  if (!writes && !FOLDER_READ_TOOLS.has(tool)) return { deny: false };
  const same = sameFn(caseInsensitive);
  const inside = insideFn(caseInsensitive);
  const teamFolder = teamFoldersOf(layout, same).find((f) => inside(f, target));

  if (layout.appPrivate && inside(layout.appPrivate, target)) {
    return { deny: true, reason: 'That folder is the app\'s own and holds private settings. Nobody on the team opens it.' };
  }
  if (writes && (layout.appLocked ?? []).some((f) => inside(f, target))) {
    return { deny: true, reason: 'That folder holds the app\'s own program and settings. You can read it, but nobody on the team changes it.' };
  }

  if (agent.isGod) {
    if (writes && teamFolder && !inside(teamFolder, agent.cwd)) {
      return {
        deny: true,
        reason: 'Team members\' folders are theirs to change. You can read this one, but to get something into it, ask the team member it belongs to.'
      };
    }
    return { deny: false };
  }

  const own = agent.cwd;
  if (inside(own, target)) return { deny: false };
  if (teamFolder) {
    return {
      deny: true,
      reason: `That folder belongs to another team member, and only they and ${godName} can open it. If you need something from it, ask ${godName}.`
    };
  }
  if (layout.business && inside(layout.business, target)) {
    return {
      deny: true,
      reason: `That is ${godName}'s folder, and only ${godName} can open it. If you need something from it, ask ${godName}.`
    };
  }
  return { deny: false };
}

/** A Claude Code permission rule for everything under an absolute folder. */
function rule(tool: 'Read' | 'Edit', folder: string): string {
  const p = resolve(folder).replace(/\\/g, '/');
  // Absolute paths are written with a leading `//` in permission rules.
  return `${tool}(/${p.startsWith('/') ? p : `/${p}`}/**)`;
}

/** Team folders, each once, never Michael's folder itself. */
function teamFoldersOf(layout: FolderLayout, same: (a: string, b: string) => boolean): string[] {
  const out: string[] = [];
  for (const f of layout.teamFolders) {
    if (!f || !isAbsolute(f)) continue;
    if (layout.business && same(f, layout.business)) continue;
    if (out.some((o) => same(o, f))) continue;
    out.push(resolve(f));
  }
  return out;
}

function sameFn(ci: boolean) {
  const n = (p: string) => (ci ? resolve(p).toLowerCase() : resolve(p));
  return (a: string, b: string) => n(a) === n(b);
}

/** `insideFn(ci)(parent, child)`: child is parent or anything under it. */
function insideFn(ci: boolean) {
  const n = (p: string) => (ci ? resolve(p).toLowerCase() : resolve(p));
  return (parent: string, child: string) => {
    const rel = relative(n(parent), n(child));
    // `..x` is a name inside the parent; only `..` itself or `../…` climbs out.
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  };
}

/**
 * The absolute path a file tool call touches, or null if it names none (a Grep
 * or Glob with no path runs in the agent's own folder). A Glob is judged by the
 * part of its pattern before the first wildcard.
 */
export function folderToolTarget(tool: string, input: unknown, cwd: string | undefined): string | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === 'string' && (o[k] as string).length > 0 ? (o[k] as string) : null);
  let p = str('file_path') ?? str('notebook_path') ?? str('path');
  if (tool === 'Glob') {
    // Judged by the part before the first wildcard, relative or not and with
    // or without a path: `../Finance/**` lists another folder's files.
    const pattern = str('pattern');
    const cut = pattern ? pattern.search(/[*?[{]/) : -1;
    const prefix = pattern ? (cut === -1 ? pattern : pattern.slice(0, cut)) : '';
    if (prefix) p = p && !isAbsolute(prefix) && !prefix.startsWith('~/') && !prefix.startsWith('~\\') ? join(p, prefix) : prefix;
  }
  if (!p) return null;
  if (typeof process !== 'undefined') {
    const home = process.env.HOME || process.env.USERPROFILE || (process.env.HOMEDRIVE && process.env.HOMEPATH ? process.env.HOMEDRIVE + process.env.HOMEPATH : null);
    if (home) {
      if (p === '~') p = home;
      else if (p.startsWith('~/') || p.startsWith('~\\')) p = resolve(home, p.slice(2));
    }
  }
  return isAbsolute(p) ? resolve(p) : cwd ? resolve(cwd, p) : null;
}
