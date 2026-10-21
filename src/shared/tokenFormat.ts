interface Unit {
  size: number;
  suffix: string;
  text: (scaled: number) => string;
}

function compact(n: number, units: Unit[]): string {
  // A count that is not a number (a missing field becomes NaN) reads 0, never
  // "NaN" or "InfinityB" on a row; formatUsd does the same.
  if (!Number.isFinite(n)) return '0';
  const whole = Math.round(n);
  let i = -1;
  units.forEach((u, j) => { if (whole >= u.size) i = j; });
  if (i < 0) return String(whole);
  // 999,950 rounds to 1000.0K: the unit is picked after rounding, so it reads 1M.
  if (+units[i].text(whole / units[i].size) >= 1000 && i < units.length - 1) i++;
  return `${units[i].text(whole / units[i].size)}${units[i].suffix}`;
}

const trimmed = (digits: number) => (v: number) => String(+v.toFixed(digits));

/** Compact token count: 1K / 10K / 100K / 1M / 100M / 1B (trailing .0 trimmed). */
export function fmtTokens(n: number): string {
  return compact(n, [
    { size: 1e3, suffix: 'K', text: trimmed(1) },
    { size: 1e6, suffix: 'M', text: trimmed(1) },
    { size: 1e9, suffix: 'B', text: trimmed(2) }
  ]);
}

/** The tool waterfall's count: whole thousands, one decimal of millions. */
export function fmtToolTokens(n: number): string {
  return compact(n, [
    { size: 1e3, suffix: 'K', text: (v) => v.toFixed(0) },
    { size: 1e6, suffix: 'M', text: (v) => v.toFixed(1) }
  ]);
}

/** A worker row's count: 1.5k / 15k / 1.50M. */
export function fmtWorkerTokens(n: number): string {
  return compact(n, [
    { size: 1e3, suffix: 'k', text: (v) => (+v.toFixed(1) < 10 ? v.toFixed(1) : v.toFixed(0)) },
    { size: 1e6, suffix: 'M', text: (v) => v.toFixed(2) }
  ]);
}
