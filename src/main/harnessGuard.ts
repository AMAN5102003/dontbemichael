/**
 * The harness folder is plumbing only (Decision 48) — the "block" half.
 *
 * Agents are TOLD where their work belongs (the folder line in their prompt);
 * this refuses a file-writing tool call that lands in the harness folder anyway,
 * unless it is one of the few files the hive protocol itself tells agents to
 * write. The refusal reason goes straight back to the agent, so it names where
 * the work should go instead and the agent can correct itself.
 *
 * LIMITS, stated plainly:
 *  - Only Claude's file tools (Write/Edit/MultiEdit/NotebookEdit) are checked.
 *    A shell command that writes a file can't be judged from its text.
 *  - The PreToolUse hook fails OPEN for these file tools when the agent's shim
 *    can't reach the app's socket, so this is a strong guard, not an airtight
 *    one. (MCP and MCP resource calls fail closed instead: see HOOK_SHIM and
 *    docs/designs/claude-connectors.md, D8.)
 *
 * Pure: no fs, no electron. The hook server supplies the paths.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { AGENT_TMP_DIR, agentTmpName } from '../shared/folderAccess';
import { ALLOW_TEMP_WORKERS } from '../shared/buildFeatures';
import { isSameOrInside } from './pathInside';

/** Claude's tools that write a file at a path given in their input. */
export const GUARDED_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

export interface HarnessWriteInput {
  tool: string;
  toolInput: unknown;
  /** The agent's working directory, from the hook payload. Relative paths resolve against it. */
  cwd?: string;
  agentId: string;
  isGod: boolean;
  harnessHome: string;
  hiveRoot: string;
  /** macOS and Windows file systems ignore case; Linux does not. */
  caseInsensitive: boolean;
}

export function harnessWriteDecision(i: HarnessWriteInput): { deny: boolean; reason?: string } {
  if (!GUARDED_TOOLS.has(i.tool)) return { deny: false };
  const target = targetPath(i.toolInput, i.cwd);
  if (!target) return { deny: false };

  const norm = (p: string) => (i.caseInsensitive ? p.toLowerCase() : p);
  if (!isSameOrInside(norm(i.harnessHome), norm(target))) return { deny: false };
  // Its own scratch folder, where its Claude session keeps temp files (ship
  // review D6.1: no longer the shared /tmp).
  if (isSameOrInside(norm(join(i.harnessHome, AGENT_TMP_DIR, agentTmpName(i.agentId))), norm(target))) return { deny: false };

  if (isSameOrInside(norm(i.hiveRoot), norm(target))) {
    const rel = relative(norm(resolve(i.hiveRoot)), norm(target)).split(/[\\/]/).join('/');
    if (isPlumbing(rel, norm(i.agentId), i.isGod, i.tool, () => existsSync(target))) return { deny: false };
  }

  const workHere = i.cwd && !isSameOrInside(norm(i.harnessHome), norm(resolve(i.cwd))) ? ` (${i.cwd})` : '';
  return {
    deny: true,
    reason:
      `The hive folder is only for coordination: your memory/inbox.md, your inbox and outbox, ${i.isGod ? 'tasks.json, board.md and the triage folder' : 'and one new file per filing in the triage folder; Michael alone writes tasks.json, so tell him what changed'}. Your memory index (memory.md) is kept by the app: add notes to memory/inbox.md instead. ` +
      `Save documents, drafts and other work in your own folder${workHere} instead.`
  };
}

/**
 * The files the hive protocol tells an agent to write (PROTOCOL.md and the
 * injected prompt). Everything else in the hive is the app's to write.
 */
function isPlumbing(rel: string, agentId: string, isGod: boolean, tool: string, exists: () => boolean): boolean {
  const own = `agents/${agentId}/`;
  // An agent adds notes to its memory inbox; the index (memory.md) is the
  // app's to write (memoryTidy.ts).
  if (rel === `${own}memory/inbox.md`) return true;
  // The handoff it writes before its conversation is cleared (safeClearer.ts).
  if (rel === `${own}memory/handoff.md`) return true;
  if (rel.startsWith(`${own}outbox/`) || rel.startsWith(`${own}inbox/`)) return true;
  // A team member files what its work needs as one new file in triage/
  // (card-lifecycle.md section 10); Michael files them away in triage/.done/.
  // Written once: a new JSON file named with the agent's own id, never an
  // edit, never over a filing already there (its own or another agent's).
  const filing = rel.startsWith('triage/') ? rel.slice('triage/'.length) : '';
  if (tool === 'Write' && filing.endsWith(`-${agentId}.json`) && !filing.includes('/') && !filing.startsWith('.') && !exists()) return true;
  if (isGod && rel.startsWith('triage/.done/')) return true;
  // Michael alone writes the board (ship review D8).
  if (isGod && rel === 'tasks.json') return true;
  // Michael is the board's sole scribe, and the only one who files spawn
  // requests, in a build that has them (ALLOW_TEMP_WORKERS).
  if (isGod && (rel === 'board.md' || (ALLOW_TEMP_WORKERS && rel.startsWith('spawn-requests/')))) return true;
  return false;
}

/** The absolute path a tool call would write, or null if it names none. */
function targetPath(input: unknown, cwd: string | undefined): string | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as { file_path?: unknown; notebook_path?: unknown };
  const p = typeof o.file_path === 'string' ? o.file_path : typeof o.notebook_path === 'string' ? o.notebook_path : null;
  if (!p) return null;
  // resolve() also collapses `..`, so `outbox/../../board.md` is judged as board.md.
  return isAbsolute(p) ? resolve(p) : cwd ? resolve(cwd, p) : null;
}
