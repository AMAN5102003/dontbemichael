/** Graphemes, not UTF-16 units: an emoji, a flag, a family or an accented
 *  letter is one character to the owner and is never cut in half. */
const segmenter: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

function graphemes(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return Array.from(text); // code points: never splits a surrogate pair
}

/** `text` when it fits in `max` characters, else its first `max - 1`
 *  characters and "…". At most `max` characters either way. */
export function cutText(text: string, max: number): string {
  if (!text) return '';
  const limit = Math.floor(max);
  if (!(limit >= 1)) return '';          // max <= 0 or NaN
  if (text.length <= limit) return text; // fast path: units >= graphemes
  const parts = graphemes(text);
  if (parts.length <= limit) return text;
  if (limit === 1) return '…';
  return `${parts.slice(0, limit - 1).join('')}…`;
}
