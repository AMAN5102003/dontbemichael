/**
 * The one line an Ask me card shows while folded (owner, 2026-09-30: a board
 * of full questions read as one long paragraph). Michael writes the ask as a
 * bold first sentence, then the context; the headline is that bold lead, or
 * else the first sentence, as plain text.
 */
/** Sentence boundary that does not cut off after common abbreviations (Mr., e.g., No. 42, 9 a.m., etc.). */
const SENTENCE_LEAD = /^[\s\S]*?(?:(?<!\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|inc|ltd|co|corp|approx|dept|est|etc|u\.s|u\.k|e\.g|i\.e|a\.m|p\.m)|\bno(?=\.\s*\d))[.?!](?=\s|$)|\n|$)/i;

export function askHeadline(q: string): string {
  const text = q.trim();
  const bold = /^\*\*([\s\S]+?)\*\*/.exec(text);
  const lead = bold ? bold[1] : (SENTENCE_LEAD.exec(text)?.[0] ?? text);
  return lead
    // One pass, so a code span's text is kept as written, and an underscore
    // inside a word (monthly_report.pdf, first_last@acme.com) is not emphasis.
    .replace(/`([^`]*)`|\*+|(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, (_m, code?: string) => code ?? '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A month name or its short form, as a whole word: "marketing", "junior" and
 *  "Decision" start like a month but are not one. */
const MONTH = '\\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\b\\.?';
/** A bracketed note that is metadata, not part of the name: a date, a mailbox
 *  (`support@`), "per Kelly", "via the form", a ticket number (`#4471`). */
const META = new RegExp(`\\d{1,2}\\s+${MONTH}|${MONTH}\\s+\\d{1,2}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}|\\w*@|\\bper\\s|\\bvia\\s|#\\d+`, 'i');
/** Longer than any title a card can show; agents write the file, so cap it. */
const TITLE_MAX = 300;

/**
 * The title an Ask me card shows (owner, 2026-10-01: headers looked cryptic,
 * e.g. "Acme app user Xk29fLq8ZpR3mN7tV2wB requested CRM setup (support@,
 * 1 Oct)"). Agents are told to write plain titles; this cleans the ones that
 * aren't: opaque ids (uuids, and long tokens with three or more digits) and
 * trailing bracketed metadata go, the rest stays. Agents write tasks.json, so
 * the title may be missing, not a string, or huge: it never throws, and it
 * peels brackets with string search, not a regex that can backtrack.
 */
export function askTitle(title: unknown): string {
  const raw = typeof title === 'string' ? title.trim().slice(0, TITLE_MAX) : '';
  let t = raw;
  for (;;) {
    const end = t.trimEnd();
    if (!end.endsWith(')')) break;
    const open = end.lastIndexOf('(');
    if (open < 0) break;
    const inner = end.slice(open + 1, -1);
    if (inner.includes(')') || !META.test(inner)) break;
    t = end.slice(0, open);
  }
  t = t
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    .replace(/\b(?=(?:[A-Za-z]*\d){3})(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{16,}\b/g, '')
    .replace(/\s+([,.:;])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t || raw;
}

/** "just now", "5m ago", "2h ago", "3 days ago" in the app's language. */
export function askedAgo(iso: string | undefined, now: number, lang: string, justNow = 'just now'): string {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const s = Math.max(0, Math.round((now - at) / 1000));
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'narrow' });
  if (s < 60) return justNow;
  if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), 'hour');
  return rtf.format(-Math.floor(s / 86400), 'day');
}
