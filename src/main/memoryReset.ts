/**
 * What Settings → "Reset memory" erases (app:resetMemory in index.ts), so each
 * team member starts as on its first day while the office stays: the team,
 * cards, waiting messages, schedules, settings and Company knowledge are kept
 * (docs/designs/reset-agent-memory.md).
 *
 * Per member, Michael and Research included:
 *   - its memory index and notes folder (memory.md, memory/), which hold the
 *     tidy up's inbox, procedures, handoffs and the last clear
 *   - its handled messages (inbox/.done, outbox/.sent; R6, R8)
 *   - its Claude Code conversations, by the session ids the app recorded (E3)
 *   - Claude Code's own auto memory for its working folders (R2)
 * and once for the office: the tidy up's copies (hive/backups).
 *
 * Where ids and folders come from (R5): never from the hive's log or registry,
 * which members' shells can write, so no member can steer a delete. Session
 * ids come from Pulse's cost records (harness.db) and the private session
 * record; working folders from the roster and Research's desk.
 *
 * No electron import, so tests drive it with temporary folders.
 */
import { existsSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve, sep } from 'node:path';

/** The private record of each member's session ids, written from
 *  authenticated hook frames (hive.recordSession), one JSON line each. */
export const MEMBER_SESSIONS_FILE = 'member-sessions.jsonl';

/** The session id charset (transcript.ts VALID_SESSION_ID). */
const SESSION_ID = /^[A-Za-z0-9_-]+$/;
const MEMBER_ID = /^[\w-]+$/;

type Ids = Map<string, Set<string>>;

function add(map: Ids, agentId: unknown, sessionId: unknown): void {
  if (typeof agentId !== 'string' || !MEMBER_ID.test(agentId)) return;
  if (typeof sessionId !== 'string') return;
  // A cost sample keyed `transcript:<id>` took that id from the registry,
  // which members can write, so it never names a delete (R5; pre-landing review).
  const id = sessionId;
  if (!id || !SESSION_ID.test(id)) return;
  let set = map.get(agentId);
  if (!set) map.set(agentId, (set = new Set()));
  set.add(id);
}

/** Session ids by member from Pulse's cost rows of this office
 *  (`SELECT agent_id, json_extract(attrs, '$.s') AS s ...`). */
export function idsFromCostRows(rows: Array<{ agent_id: unknown; s: unknown }>, into: Ids = new Map()): Ids {
  for (const r of rows) add(into, r.agent_id, r.s);
  return into;
}

/** Session ids by member from the private record's lines; a bad line is skipped. */
export function idsFromRecord(text: string, into: Ids = new Map()): Ids {
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { agentId?: unknown; sessionId?: unknown };
      add(into, row.agentId, row.sessionId);
    } catch { /* a torn line */ }
  }
  return into;
}

/** Each member's working folders from the roster (its own file in the office
 *  folder, outside every member's writable folders): cwd and worktreePath of
 *  current and archived members. */
export function foldersFromRoster(snapshot: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const snap = snapshot as { agents?: unknown; archived?: unknown; restorable?: unknown } | null;
  // Restorable too: every member waits there from launch until it respawns.
  const entries = [
    ...(Array.isArray(snap?.agents) ? snap!.agents as unknown[] : []),
    ...(Array.isArray(snap?.archived) ? snap!.archived as unknown[] : []),
    ...(Array.isArray(snap?.restorable) ? snap!.restorable as unknown[] : [])
  ];
  for (const e of entries) {
    const a = e as { id?: unknown; cwd?: unknown; worktreePath?: unknown } | null;
    if (!a || typeof a.id !== 'string' || !MEMBER_ID.test(a.id)) continue;
    const list = out.get(a.id) ?? [];
    for (const f of [a.cwd, a.worktreePath]) {
      if (typeof f === 'string' && f.trim() && !list.includes(f)) list.push(f);
    }
    out.set(a.id, list);
  }
  return out;
}

export interface MemoryResetInput {
  hiveRoot: string;
  /** Members to reset: every folder under hive/agents but the owner's. */
  memberIds: string[];
  /** Working folders by member (foldersFromRoster). */
  folders: Map<string, string[]>;
  /** Session ids by member (idsFromCostRows + idsFromRecord). */
  sessions: Ids;
  /** Claude Code's project folders for a working folder (transcript.ts projectDirs). */
  projectDirsOf: (folder: string) => string[];
  /** The git repository root of a folder, or null when it is not in one. */
  gitTop: (folder: string) => string | null;
  /** Research's desk: its project folders are its alone and go whole, as in
   *  Reset & start over (factoryReset.ts). */
  research?: { id: string; desk: string | null };
}

/** Every path the reset removes. Pure: it only builds paths and reads nothing. */
export function memoryResetTargets(p: MemoryResetInput): string[] {
  const out = new Set<string>();
  const ids = p.memberIds.filter((id) => MEMBER_ID.test(id) && id !== 'human');
  for (const id of ids) {
    const dir = join(p.hiveRoot, 'agents', id);
    out.add(join(dir, 'memory.md'));
    out.add(join(dir, 'memory'));
    out.add(join(dir, 'inbox', '.done'));
    out.add(join(dir, 'outbox', '.sent'));
    const sessions = [...(p.sessions.get(id) ?? [])];
    for (const folder of p.folders.get(id) ?? []) {
      for (const proj of p.projectDirsOf(folder)) {
        for (const sid of sessions) {
          out.add(join(proj, `${sid}.jsonl`));
          out.add(join(proj, sid));
        }
      }
      // Claude Code keys auto memory by the repository root (subfolders and
      // worktrees share it); a folder outside a repository is its own key.
      const roots = new Set([folder, p.gitTop(folder) ?? folder]);
      for (const root of roots) for (const proj of p.projectDirsOf(root)) out.add(join(proj, 'memory'));
    }
  }
  if (p.research?.desk && ids.includes(p.research.id)) {
    for (const proj of p.projectDirsOf(p.research.desk)) out.add(proj);
  }
  out.add(join(p.hiveRoot, 'backups'));
  return [...out];
}

/** The folders a reset names to the owner: where Claude Code's own notes go
 *  (R2), one per repository or folder. */
/** The folder Claude Code keys a working folder's auto memory by: its
 *  repository's root, and for a linked worktree the main repository's, since
 *  a repository's worktrees share one auto memory (pre-landing review). Null
 *  outside a repository or when git can't answer within 2 s. */
export function gitTopOf(folder: string): string | null {
  try {
    if (!existsSync(folder)) return null;
    const ask = (...flags: string[]): string[] => {
      const r = spawnSync('git', ['-C', folder, 'rev-parse', ...flags, '--show-toplevel', '--git-common-dir'], { encoding: 'utf8', timeout: 2000, windowsHide: true });
      return r.status === 0 ? r.stdout.split(/\r?\n/).map((l) => l.trim()) : [];
    };
    // git before 2.31 has no --path-format; its common dir is then relative
    // to the folder.
    let [top, common] = ask('--path-format=absolute');
    if (!top) [top, common] = ask();
    if (!top) return null;
    // The main repository's .git folder names its root; a submodule's or a
    // bare one's doesn't, so those keep their own top.
    return common && basename(common) === '.git' ? resolve(folder, dirname(common)) : resolve(top);
  } catch { return null; }
}

export function autoMemoryFolders(folders: Map<string, string[]>, gitTop: (folder: string) => string | null): string[] {
  const out = new Set<string>();
  for (const list of folders.values()) for (const f of list) out.add(gitTop(f) ?? f);
  return [...out].sort();
}

function real(path: string): string | null {
  try { return realpathSync(path); } catch { return null; }
}

function inside(child: string, root: string): boolean {
  return child === root || child.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** Remove each target that sits, link free, under one of `roots`. A target
 *  whose folder resolves anywhere else (a member's folder swapped for a link)
 *  is refused, never followed. Returns what went, what failed and what was
 *  refused. */
export function eraseMemoryTargets(targets: string[], roots: string[]): { removed: number; failed: string[]; refused: string[] } {
  const realRoots = roots.map(real).filter((r): r is string => !!r);
  let removed = 0;
  const failed: string[] = [];
  const refused: string[] = [];
  for (const t of targets) {
    const abs = resolve(t);
    if (!existsSync(abs)) continue;
    const parent = real(dirname(abs));
    const expected = parent ? join(parent, abs.slice(dirname(abs).length + 1)) : null;
    if (!parent || !expected || !realRoots.some((r) => inside(expected, r))) { refused.push(t); continue; }
    // Retried briefly, as Reset & start over does, for a file a stopping
    // process still holds (Windows).
    try { rmSync(expected, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); removed++; } catch { failed.push(t); }
  }
  return { removed, failed, refused };
}

/** Members to reset: every folder under hive/agents except the owner's. */
export function memberIdsIn(hiveRoot: string): string[] {
  try {
    return readdirSync(join(hiveRoot, 'agents'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'human' && MEMBER_ID.test(d.name))
      .map((d) => d.name);
  } catch { return []; }
}
