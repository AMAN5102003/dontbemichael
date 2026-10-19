/**
 * Pulse's lists of what the privacy check did (owner, 2026-10-16: "business
 * owner wants to see what exactly was let go and what modified message was
 * sent"; eng review D1 to D5, design review D3 to D17): each question to
 * Research the check ran on, and each of Research's answers, with what was
 * written and, when it changed, what the other side got.
 *
 *   check done ─ hive ─┬─ row ─► private/checked.jsonl ─(daily, > 62 days)─► private/checked-archive/YYYY-MM.jsonl
 *                      └─ trust-checked (way, decision, flagged; no text) ─► telemetry ─► the Kept safe counts
 *   view ─ pulse:checked ─► rows ─► the list (marks per wordChanges)
 *
 * No electron or node imports: main and the renderer share it, tests load it.
 */

export type CheckedOutcome = 'pass' | 'clean' | 'stop';

export interface CheckedText { subject: string; body: string }

export interface CheckedRow {
  at: number;
  /** in: a question headed to Research; out: Research's answer. */
  way: 'in' | 'out';
  from: string;
  /** The name when it was checked; null for the owner and the app. */
  fromName: string | null;
  to: string;
  toName: string | null;
  outcome: CheckedOutcome;
  /** What the sender wrote (D1: whole, up to CHECKED_TEXT_MAX each). */
  wrote: CheckedText;
  /** What the other side got, when it differs from what was written. An
   *  answer's label, which the app adds before delivery, is left out (DD1). */
  sent?: CheckedText;
  /** in: the kinds of detail taken out (clean) or needed (stop). */
  kinds?: string[];
  /** out: flagged to Michael. */
  flagged?: boolean;
  /** A text was longer than CHECKED_TEXT_MAX and was cut. */
  cut?: boolean;
  /** Put together later from the office's files, for a check made before the
   *  lists kept words: the kinds taken out and any flag were not recorded. */
  found?: boolean;
}

/** A span's rows for one list, and the time of the first row ever kept for
 *  it (null: none yet), so the list can say from when words are kept (DD4). */
export interface CheckedList { rows: CheckedRow[]; since: number | null }

/** Rows show 62 days, all Pulse can show (eng D2); older rows move to the
 *  archive and are never deleted by the app, only by a reset (D3). */
export const CHECKED_KEEP_MS = 62 * 86_400_000;
export const CHECKED_TEXT_MAX = 4000;
export const CHECKED_FILE = 'checked.jsonl';
export const CHECKED_ARCHIVE_DIR = 'checked-archive';

/** A text as kept: as written, line breaks and all, cut at the cap. */
export function keepText(text: unknown): { text: string; cut: boolean } {
  const s = typeof text === 'string' ? text : text === undefined || text === null ? '' : String(text);
  return s.length > CHECKED_TEXT_MAX ? { text: s.slice(0, CHECKED_TEXT_MAX), cut: true } : { text: s, cut: false };
}

const isText = (x: unknown): x is CheckedText => !!x && typeof x === 'object' && typeof (x as CheckedText).subject === 'string' && typeof (x as CheckedText).body === 'string';

/** One row as stored, or null for a line that is not one. */
export function parseChecked(line: string): CheckedRow | null {
  try {
    const r = JSON.parse(line) as Partial<CheckedRow>;
    if (typeof r?.at !== 'number' || (r.way !== 'in' && r.way !== 'out') || typeof r.from !== 'string' || typeof r.to !== 'string') return null;
    if (r.outcome !== 'pass' && r.outcome !== 'clean' && r.outcome !== 'stop') return null;
    if (!isText(r.wrote)) return null;
    return {
      at: r.at, way: r.way, from: r.from, fromName: typeof r.fromName === 'string' ? r.fromName : null,
      to: r.to, toName: typeof r.toName === 'string' ? r.toName : null, outcome: r.outcome, wrote: r.wrote,
      ...(isText(r.sent) ? { sent: r.sent } : {}),
      ...(Array.isArray(r.kinds) ? { kinds: r.kinds.filter((k): k is string => typeof k === 'string') } : {}),
      ...(r.flagged === true ? { flagged: true } : {}),
      ...(r.cut === true ? { cut: true } : {}),
      ...(r.found === true ? { found: true } : {})
    };
  } catch { return null; }
}

/** The month an archived row is filed under, from its own time (UTC). */
export function archiveMonth(at: number): string {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Split the live file's lines into those kept and those archived, by month.
 *  A line that is not a row stays in the live file (the reader skips it), so
 *  nothing is ever dropped. */
export function splitForArchive(lines: string[], now: number): { keep: string[]; archive: Map<string, string[]> } {
  const keep: string[] = [];
  const archive = new Map<string, string[]>();
  for (const l of lines) {
    if (!l.trim()) continue;
    const r = parseChecked(l);
    if (!r || r.at >= now - CHECKED_KEEP_MS) { keep.push(l); continue; }
    const m = archiveMonth(r.at);
    const list = archive.get(m);
    if (list) list.push(l); else archive.set(m, [l]);
  }
  return { keep, archive };
}

// ── What changed, word by word (design DD1, DD6, DD7) ─────────────────────

export type ChangePart = { op: 'same' | 'del' | 'ins'; text: string };

/** Words and the gaps between them; Intl.Segmenter splits Chinese too. One
 *  segmenter for every call. */
let segmenter: { segment: (s: string) => Iterable<{ segment: string }> } | null | undefined;
function tokens(text: string): string[] {
  if (segmenter === undefined) {
    const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter;
    segmenter = Seg ? new Seg(undefined, { granularity: 'word' }) : null;
  }
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/** Above this many words a side, no word comparison: the two texts are shown. */
const MAX_TOKENS = 2500;

/** Spacing only changes count as the same. */
const keyOf = (t: string): string => (/^\s+$/.test(t) ? ' ' : t);

/** The changes from `a` to `b`, or null when the texts are too long to
 *  compare. Spacing only changes count as the same. The shared opening and
 *  ending are taken off first, since a cleaned text differs in a few spots,
 *  and each word's key is worked out once (ship review 2026-10-17). */
export function wordChanges(a: string, b: string): ChangePart[] | null {
  const x = tokens(a);
  const y = tokens(b);
  if (x.length > MAX_TOKENS || y.length > MAX_TOKENS) return null;
  const kx = x.map(keyOf);
  const ky = y.map(keyOf);
  let head = 0;
  while (head < x.length && head < y.length && kx[head] === ky[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && kx[x.length - 1 - tail] === ky[y.length - 1 - tail]) tail++;
  const n = x.length - head - tail;
  const m = y.length - head - tail;
  // Longest common run of the middle, filled from the end.
  const w = m + 1;
  const len = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      len[i * w + j] = kx[head + i] === ky[head + j] ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
    }
  }
  const out: ChangePart[] = [];
  const push = (op: ChangePart['op'], text: string): void => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text; else out.push({ op, text });
  };
  for (let k = 0; k < head; k++) push('same', y[k]);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (kx[head + i] === ky[head + j]) { push('same', y[head + j]); i++; j++; }
    else if (len[(i + 1) * w + j] >= len[i * w + j + 1]) { push('del', x[head + i]); i++; }
    else { push('ins', y[head + j]); j++; }
  }
  while (i < n) push('del', x[head + i++]);
  while (j < m) push('ins', y[head + j++]);
  for (let k = y.length - tail; k < y.length; k++) push('same', y[k]);
  return out;
}

/** Marks in one text, or the two texts one above the other (DD1): over 40% of
 *  the words the other side got are new, more than 4 separate changes, or
 *  too long to compare. Measured on what went out, so a name and a price taken
 *  out of a question stays marks while a full rewrite shows both texts. */
export function showAsMarks(parts: ChangePart[] | null): parts is ChangePart[] {
  if (!parts) return false;
  const words = (s: string): number => (s.match(/[\p{L}\p{N}]+(?:[.,'][\p{L}\p{N}]+)*/gu) ?? []).length;
  let added = 0;
  let got = 0;
  let changes = 0;
  let inChange = false;
  for (const p of parts) {
    const n = words(p.text);
    if (p.op !== 'del') got += n;
    if (p.op === 'same') { if (n > 0) inChange = false; continue; }
    if (p.op === 'ins') added += n;
    if (!inChange) { changes++; inChange = true; }
  }
  return got > 0 && added / got <= 0.4 && changes <= 4;
}

/** The changes with only about `around` characters of unchanged text kept on
 *  each side; null marks a gap shown as "…" (DD6). */
export function changesInContext(parts: ChangePart[], around = 80): Array<ChangePart | null> {
  const out: Array<ChangePart | null> = [];
  parts.forEach((p, k) => {
    if (p.op !== 'same') { out.push(p); return; }
    const first = k === 0;
    const last = k === parts.length - 1;
    const t = p.text;
    if (t.length <= around * 2 + 20 && !first && !last) { out.push(p); return; }
    if (!first) out.push({ op: 'same', text: t.slice(0, around) });
    if (t.length > (first || last ? around : around * 2)) out.push(null);
    if (!last) out.push({ op: 'same', text: t.slice(Math.max(first ? 0 : around, t.length - around)) });
  });
  // A leading or trailing gap stays; two gaps in a row become one.
  return out.filter((p, k) => p !== null || out[k - 1] !== null);
}

/** Characters nobody can see (zero width, joiners, direction controls,
 *  invisible tags): web pages hide instructions to AI agents in them (DD7). */
const HIDDEN = /[­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{E0000}-\u{E007F}]/u;
const HIDDEN_RUN = new RegExp(`(?:${HIDDEN.source})+`, 'gu');

/** A text split into what can be seen and runs of hidden characters, counted. */
export function withHidden(text: string): Array<string | { hidden: number }> {
  const out: Array<string | { hidden: number }> = [];
  let at = 0;
  for (const m of text.matchAll(HIDDEN_RUN)) {
    if (m.index! > at) out.push(text.slice(at, m.index));
    out.push({ hidden: Array.from(m[0]).length });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
