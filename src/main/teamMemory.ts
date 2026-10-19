/**
 * What the team remembers, for Pulse's Learning row (owner, 2026-10-15,
 * proposal 3): each member's memory index notes (id, date, where they came
 * from, and the one line itself for the list of new notes, owner 2026-10-18)
 * and written procedures, only for the members on the team. The counts never
 * rest on this file alone: a new note is counted from the app's own record.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseIndex } from '../shared/memoryIndex';
import type { NoteFact } from '../shared/teamLearning';

export function readTeamMemory(hiveRoot: string, ids: string[]): { notes: NoteFact[]; procedures: Record<string, number> } {
  const notes: NoteFact[] = [];
  const procedures: Record<string, number> = {};
  for (const id of ids) {
    const dir = join(hiveRoot, 'agents', id);
    try {
      for (const e of parseIndex(readFileSync(join(dir, 'memory.md'), 'utf8')).entries) notes.push({ agentId: id, source: e.source, date: e.date, id: e.id, text: e.text });
    } catch { /* no memory yet */ }
    try {
      const n = readdirSync(join(dir, 'memory', 'procedures')).filter((f) => f.endsWith('.md')).length;
      if (n) procedures[id] = n;
    } catch { /* no procedures yet */ }
  }
  return { notes, procedures };
}
