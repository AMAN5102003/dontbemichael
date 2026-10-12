/** CSV and TSV for the file tab's table (docs/designs/open-file-tab.md, E3). */

/** Rows a CSV table shows (E3); the rest is counted in a note. */
export const CSV_ROW_LIMIT = 1000;

/** CSV or TSV into rows, quotes and doubled quotes honored. Null when the
 *  quoting never closes: the view then shows the text as it is. */
export function parseDelimited(text: string, sep: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (quoted) return null;
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
