'use strict';
/**
 * The live descendants of a process, from one Windows process snapshot.
 *
 * Windows keeps a process's parent id after the parent exits, and reuses
 * process ids. So a process whose parent died long ago can name, as its
 * parent, an id that now belongs to a new process: csrss.exe and winlogon.exe
 * name their session's long gone smss.exe, and once a PTY shell gets that id
 * they look like its children (CI run 39170943061, 2026-10-18). A real child
 * is never older than its parent, so a row created before its parent is left
 * out. A row with no creation time is kept only when its parent has none too.
 *
 * @param {Array<{ ProcessId: number, ParentProcessId: number, Created?: number | null }>} rows
 *   one snapshot; `Created` is the creation time in milliseconds, or null/0
 *   when Windows does not report one (System, Idle)
 * @param {number} root
 * @returns {number[]} the descendants' ids, never `root` itself
 */
function descendantsFromSnapshot(rows, root) {
  const created = new Map();
  const byParent = new Map();
  for (const row of rows) {
    created.set(row.ProcessId, row.Created || 0);
    const list = byParent.get(row.ParentProcessId) ?? [];
    list.push(row);
    byParent.set(row.ParentProcessId, list);
  }
  const out = [];
  const seen = new Set([root]);
  const stack = [root];
  while (stack.length) {
    const parent = stack.pop();
    const parentCreated = created.get(parent) || 0;
    for (const row of byParent.get(parent) ?? []) {
      const child = row.ProcessId;
      if (seen.has(child)) continue;
      const childCreated = row.Created || 0;
      if (parentCreated && (!childCreated || childCreated < parentCreated)) continue;
      seen.add(child);
      out.push(child);
      stack.push(child);
    }
  }
  return out;
}

module.exports = { descendantsFromSnapshot };
