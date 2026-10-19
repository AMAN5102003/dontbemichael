/**
 * Pulse's lists of what the privacy check did, filled in for the checks made
 * before the lists kept words (owner, 2026-10-16: "it says 1 was changed but i
 * cant see which message", then "still not saying changed message").
 *
 * Every check before then left both texts on disk, just not side by side:
 *
 *   question to Research ─ what Research got: agents/research/inbox(/.done)
 *                        ─ what was written: the sender's outbox/.sent copy,
 *                          or the owner's answer on its Ask me card (tasks.json);
 *                          the app's own upkeep notes are never questions
 *                          (shared/upkeep.ts), so none is filled in
 *   Research's answer    ─ what it wrote: research-outbox/sent (or its outbox/.sent)
 *                        ─ what the team read: the copy in the recipient's
 *                          inbox, named research-<hash of file name and text>
 *
 * Rows found this way are marked `found`: the kinds of detail taken out and
 * any flag to Michael were never recorded. A question or answer whose other
 * half can't be found is left out; the list counts it as without details.
 * backfillChecked only reads; ensureCheckedBackfill writes the rows and its
 * mark once. Every file is read the safe way (messageFile.ts): an agent's own
 * folder may hold a link or a pipe, and this runs with the owner's rights.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CHECKED_FILE, CHECKED_KEEP_MS, keepText, parseChecked, type CheckedRow } from '../shared/checkedRecord';
import { RESEARCH_REPLY_LABEL, researchText } from '../shared/research';
import { readMessageFile, realFolderIn, researchDeliveredId } from './messageFile';

export interface BackfillInput {
  hiveRoot: string;
  /** <home>/private/research-outbox/sent, where Research's sent answers are kept. */
  researchSentDir: string | null;
  researchId: string;
  /** Research's names over time (today's first): who a teammate addressed. */
  researchNames: string[];
  /** Rows from `from` up to (not including) `until`: before the lists kept words. */
  from: number;
  until: number;
  nameOf: (id: string) => string | null;
}

const parseJson = (raw: string | null): Record<string, unknown> | null => {
  if (raw === null) return null;
  try { const v = JSON.parse(raw) as unknown; return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null; } catch { return null; }
};
const readJson = (file: string): Record<string, unknown> | null => parseJson(readMessageFile(file));
const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));
/** The .json files in `parts` under `base`, only while each step is a real folder. */
const jsonFiles = (base: string, ...parts: string[]): string[] => {
  const dir = realFolderIn(base, ...parts);
  if (!dir) return [];
  try { return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f)); } catch { return []; }
};
const timeOf = (m: Record<string, unknown>, file: string): number => {
  const t = Date.parse(str(m.created_at));
  if (Number.isFinite(t)) return t;
  try { return lstatSync(file).mtimeMs; } catch { return NaN; }
};

/** A text pair as a row keeps it. */
function texts(wrote: { subject: unknown; body: unknown }, got: { subject: unknown; body: unknown }) {
  const w = { s: keepText(str(wrote.subject)), b: keepText(str(wrote.body)) };
  const g = { s: keepText(str(got.subject)), b: keepText(str(got.body)) };
  const changed = w.s.text !== g.s.text || w.b.text !== g.b.text;
  return {
    outcome: changed ? 'clean' as const : 'pass' as const,
    wrote: { subject: w.s.text, body: w.b.text },
    ...(changed ? { sent: { subject: g.s.text, body: g.b.text } } : {}),
    ...(w.s.cut || w.b.cut || (changed && (g.s.cut || g.b.cut)) ? { cut: true as const } : {})
  };
}

/** The owner's answers to Research's Ask me questions, with when they were given. */
function ownerAnswers(hiveRoot: string, researchId: string): Array<{ at: number; title: string; q: string; a: string }> {
  const t = readJson(join(hiveRoot, 'tasks.json'));
  const out: Array<{ at: number; title: string; q: string; a: string }> = [];
  for (const c of Array.isArray(t?.tasks) ? t!.tasks as Array<Record<string, unknown>> : []) {
    for (const e of Array.isArray(c?.humanQA) ? c.humanQA as Array<Record<string, unknown>> : []) {
      const at = Date.parse(str(e?.answeredAt));
      if (e?.raisedBy === researchId && typeof e.a === 'string' && Number.isFinite(at)) out.push({ at, title: str(c.title), q: str(e.q), a: e.a });
    }
  }
  return out;
}

export function backfillChecked(i: BackfillInput): CheckedRow[] {
  const rows: CheckedRow[] = [];
  const agentsDir = join(i.hiveRoot, 'agents');
  const inRange = (at: number): boolean => Number.isFinite(at) && at >= i.from && at < i.until;
  const names = new Set([i.researchId, ...i.researchNames].map((n) => n.trim().toLowerCase()).filter(Boolean));
  const row = (at: number, way: 'in' | 'out', from: string, to: string, t: ReturnType<typeof texts>): CheckedRow =>
    ({ at, way, from, fromName: i.nameOf(from), to, toName: i.nameOf(to), ...t, found: true });

  // ── Questions: what Research got, matched to what was written ──
  const answers = ownerAnswers(i.hiveRoot, i.researchId);
  const used = new Set<string>();
  const sentBy = new Map<string, Array<{ file: string; at: number; m: Record<string, unknown> }>>();
  const sentOf = (id: string) => {
    if (!sentBy.has(id)) {
      sentBy.set(id, jsonFiles(agentsDir, id, 'outbox', '.sent').flatMap((file) => {
        const m = readJson(file);
        if (!m || !names.has(str(m.to).trim().toLowerCase())) return [];
        let at = NaN;
        try { at = lstatSync(file).mtimeMs; } catch { /* skipped */ }
        return Number.isFinite(at) ? [{ file, at, m }] : [];
      }));
    }
    return sentBy.get(id)!;
  };
  const researchInbox = [...jsonFiles(agentsDir, i.researchId, 'inbox'), ...jsonFiles(agentsDir, i.researchId, 'inbox', '.done')];
  for (const file of researchInbox) {
    const m = readJson(file);
    if (!m) continue;
    const from = str(m.from);
    const at = timeOf(m, file);
    if (!from || from === i.researchId || !inRange(at)) continue;
    const got = { subject: m.subject, body: m.body };
    if (from === 'human' && str(m.subject).startsWith('The owner answered: ')) {
      // The answer saved on the card moments before Research got its copy.
      const a = answers.filter((x) => x.at <= at + 5_000 && at - x.at < 10 * 60_000).sort((x, y) => y.at - x.at)[0];
      if (a) rows.push(row(at, 'in', from, i.researchId, texts({ subject: `The owner answered: ${a.title.slice(0, 120)}`, body: `Q: ${a.q}\nA: ${a.a}` }, got)));
      continue;
    }
    if (from === 'human' || from === 'system') continue;
    // A teammate's question: its sent copy, the latest one before Research got it.
    const sent = sentOf(from).filter((s) => !used.has(s.file) && s.at <= at + 5_000 && at - s.at < 35 * 60_000).sort((x, y) => y.at - x.at)[0];
    if (!sent) continue;
    used.add(sent.file);
    rows.push(row(at, 'in', from, i.researchId, texts({ subject: sent.m.subject, body: sent.m.body }, got)));
  }

  // ── Answers: what Research wrote, matched to the copy the team read ──
  const delivered = new Map<string, { m: Record<string, unknown>; file: string }>();
  for (const id of (() => { try { return readdirSync(agentsDir); } catch { return []; } })()) {
    if (id === i.researchId) continue;
    for (const file of [...jsonFiles(agentsDir, id, 'inbox'), ...jsonFiles(agentsDir, id, 'inbox', '.done')]) {
      const m = readJson(file);
      if (m && str(m.id).startsWith('research-') && str(m.from) === i.researchId) delivered.set(str(m.id), { m, file });
    }
  }
  const labels = i.researchNames.map((n) => `${researchText(RESEARCH_REPLY_LABEL, n)}\n\n`);
  const sentAnswers = [...(i.researchSentDir ? jsonFiles(i.researchSentDir) : []), ...jsonFiles(agentsDir, i.researchId, 'outbox', '.sent')];
  for (const file of sentAnswers) {
    const raw = readMessageFile(file);
    const m = parseJson(raw);
    if (!m || raw === null) continue;
    const id = researchDeliveredId(`${basename(file)}\n${raw}`);
    const d = delivered.get(id);
    if (!d) continue;
    const at = timeOf(d.m, d.file);
    if (!inRange(at)) continue;
    const body = str(d.m.body);
    const label = labels.find((l) => body.startsWith(l));
    rows.push(row(at, 'out', i.researchId, str(d.m.to), texts({ subject: m.subject, body: m.body }, { subject: d.m.subject, body: label ? body.slice(label.length) : body })));
  }
  return rows.sort((a, b) => a.at - b.at);
}

export const CHECKED_BACKFILL_MARK = 'checked-backfill.json';

/** Once per office: rows for the 62 days before the lists kept words, put in
 *  front of the rows kept since, then a mark so it never runs again. Sync, on
 *  the main process like the hive's own appends, so nothing interleaves. */
export function ensureCheckedBackfill(privateDir: string, input: Omit<BackfillInput, 'from' | 'until' | 'researchSentDir'>, now = Date.now()): void {
  const mark = join(privateDir, CHECKED_BACKFILL_MARK);
  if (existsSync(mark)) return;
  const live = join(privateDir, CHECKED_FILE);
  let existing: string[] = [];
  try { existing = readFileSync(live, 'utf8').split('\n').filter((l) => l.trim()); } catch { /* none yet */ }
  const kept = existing.map(parseChecked).filter((r): r is CheckedRow => !!r);
  const until = kept.reduce((m, r) => Math.min(m, r.at), now);
  const rows = backfillChecked({ ...input, researchSentDir: join(privateDir, 'research-outbox', 'sent'), from: now - CHECKED_KEEP_MS, until });
  mkdirSync(privateDir, { recursive: true });
  if (rows.length) writeFileSync(live, `${[...rows.map((r) => JSON.stringify(r)), ...existing].join('\n')}\n`, 'utf8');
  writeFileSync(mark, JSON.stringify({ at: now, rows: rows.length }), 'utf8');
}
