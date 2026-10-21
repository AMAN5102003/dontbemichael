/** CSV and TSV for the file tab's table (docs/designs/open-file-tab.md, E3). */

/** Rows a CSV table shows (E3); the rest is counted in a note. */
export const CSV_ROW_LIMIT = 1000;

/** CSV or TSV into rows, quotes and doubled quotes honored. Null when the
 *  quoting never closes: the view then shows the text as it is. */
export function parseDelimited(text: string, sep: string): string[][] | null {
  // Excel's "CSV UTF-8" starts the file with a byte order mark; left in, the
  // first cell is not empty when its opening quote arrives.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let recordStarted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    recordStarted = true;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
      recordStarted = false;
    } else cell += c;
  }
  if (quoted) return null;
  // A quoted empty field still starts a record, even though its cell is empty.
  if (recordStarted) { row.push(cell); rows.push(row); }
  return rows;
}
