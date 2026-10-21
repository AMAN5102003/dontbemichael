/**
 * Catalog search, typo-tolerant without a search library: the catalog is
 * ~1,200 rows, small enough that a few lines of our own matching beats
 * pulling in and maintaining a dependency for it.
 */

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Whether `a` and `b` differ by exactly one edit: a letter added, removed,
 *  changed, or two adjacent letters swapped. Equal strings are not "one
 *  edit" — callers check that separately via substring/equality first. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return false;
  const lenDiff = a.length - b.length;
  if (Math.abs(lenDiff) > 1) return false;

  if (lenDiff === 0) {
    const diffs: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
    if (diffs.length === 1) return true; // one letter changed
    if (diffs.length === 2) { // two adjacent letters swapped
      const [i, j] = diffs;
      return j === i + 1 && a[i] === b[j] && a[j] === b[i];
    }
    return false;
  }

  // One letter added or removed: walk both strings, allow one mismatch
  // where the shorter string is missing a character the longer one has.
  const [shorter, longer] = lenDiff < 0 ? [a, b] : [b, a];
  let i = 0, j = 0, skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) { i++; j++; continue; }
    if (skipped) return false;
    skipped = true;
    j++;
  }
  return true;
}

/** A query word matches a field when it is a plain substring (today's
 *  behavior), or — for words of 5 letters or more, so short words like "ai"
 *  don't match everything — within one edit of a word in the field. */
function wordMatchesField(queryWord: string, field: string): boolean {
  if (field.includes(queryWord)) return true;
  if (queryWord.length < 5) return false;
  return tokenize(field).some((token) => withinOneEdit(queryWord, token));
}

/** Every word of the query must be found, in any order, across the name or
 *  the description. An empty query matches everything. */
export function skillMatchesQuery(name: string, description: string, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const n = name.toLowerCase();
  const d = description.toLowerCase();
  return words.every((w) => wordMatchesField(w, n) || wordMatchesField(w, d));
}

export interface CatalogFilterResult<T> {
  shown: T[];
  total: number;
}

/** Owner and category stay exact filters — only the free-text query is
 *  typo-tolerant. Bounded render: nobody scrolls past a few hundred rows,
 *  and `total` always states the real count before the cap. */
export function filterCatalog<T extends { name: string; description: string; owner: string; category: string }>(
  items: T[],
  query: string,
  owner: string,
  category: string,
  limit = 300
): CatalogFilterResult<T> {
  let list = items;
  if (owner !== 'all') list = list.filter((s) => s.owner === owner);
  if (category !== 'all') list = list.filter((s) => s.category === category);
  list = list.filter((s) => skillMatchesQuery(s.name, s.description, query));
  return { shown: list.slice(0, limit), total: list.length };
}
