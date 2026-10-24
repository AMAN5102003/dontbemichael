/** Text made safe to paste into a terminal: no control characters but tab,
 *  newline and return. A file, an email or a message holding ESC[201~ would
 *  otherwise end a bracketed paste early and type the rest into a session that
 *  runs with permissions bypassed (ship review, 2026-10-23). */
export function pasteSafe(text: string): string {
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');
}
