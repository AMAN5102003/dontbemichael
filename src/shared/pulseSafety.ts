/**
 * Pulse's Kept safe tiles (owner, 2026-10-15, proposal 3): what the Research
 * trust layer did with what went to the internet and what came back, and the
 * steps the owner's settings stopped. The processor folds each trust layer
 * decision and each refusal into a per day counter (telemetry_safety); this
 * module names the counters and sums them for a period.
 *
 * No electron or node imports: main and the renderer share it, tests load it.
 */

/** The gates in the hook server that stop a step (hooks.ts). Questions a
 *  member is sent to Michael with are routing, not a protection, so they are
 *  not counted. `impostor` is a hook frame with no secret or another member's
 *  secret; a frame with an old secret is a process left from an earlier start
 *  shutting down, so it is refused but not counted (2026-10-15: Research's
 *  status line sent 20 such frames at each restart). */
export type RefusalGate =
  | 'paused' | 'connector' | 'quickbooks' | 'mail' | 'sandbox' | 'internet'
  | 'office-files' | 'folder' | 'impostor';
export const REFUSAL_GATES: readonly RefusalGate[] = ['connector', 'quickbooks', 'mail', 'internet', 'sandbox', 'folder', 'office-files', 'paused', 'impostor'];

/** A trust layer log line as trustLayer.ts writes it. */
export interface TrustDecision { way?: unknown; decision?: unknown; by?: unknown; flagged?: unknown; v?: unknown }

/** The counters one trust layer decision adds to. A deny the model or the
 *  patterns reached is a stop; one where the check could not run (no answer,
 *  unreadable, too long) is held: nothing went out unchecked. From v 2
 *  (2026-10-16) a hold is counted from the hive's own trust-held line, which
 *  the held list shares, so a v 2 line adds no held key; older lines still do. */
export function trustKeys(e: TrustDecision): string[] {
  const way = e.way === 'out' ? 'out' : e.way === 'in' ? 'in' : null;
  // From v 3 the hive's trust-checked line counts these (checkedKeys).
  if (!way || (typeof e.v === 'number' && e.v >= 3)) return [];
  const d = String(e.decision ?? '');
  const by = String(e.by ?? '');
  const held = d === 'deny' && (by === 'no-answer' || by === 'unreadable' || by === 'length' || by === '');
  const keys: string[] = [];
  if (d === 'pass') keys.push(`${way}-pass`);
  else if (d === 'clean') keys.push(`${way}-clean`);
  else if (d === 'deny') {
    if (held || way === 'out') { if (e.v !== 2) keys.push(`${way}-held`); }
    else keys.push(`${way}-stop`);
  }
  if (way === 'out' && e.flagged === true) keys.push('out-flagged');
  return keys;
}

/** The counters one hive trust-checked line adds to: one per message the check
 *  let through or stopped, the same event Pulse's lists read (owner, D5). */
export function checkedKeys(e: { way?: unknown; decision?: unknown; flagged?: unknown }): string[] {
  const way = e.way === 'out' ? 'out' : e.way === 'in' ? 'in' : null;
  const d = String(e.decision ?? '');
  if (!way || !(d === 'pass' || d === 'clean' || (d === 'stop' && way === 'in'))) return [];
  return [`${way}-${d}`, ...(way === 'out' && e.flagged === true ? ['out-flagged'] : [])];
}

export const refusalKey = (gate: RefusalGate): string => `rule-${gate}`;

export interface KeptSafe {
  /** Questions headed to the internet: sent as written, private parts taken out first, stopped. */
  toInternet: { pass: number; clean: number; stop: number };
  /** Web answers before the team read them: nothing to remove, cleaned, flagged to Michael. */
  webAnswers: { pass: number; clean: number; flagged: number };
  /** Messages held because the check could not run, both ways. */
  held: number;
  /** The same, by way, for the lists' pointer to the held list (DD11). */
  heldIn: number;
  heldOut: number;
  /** Steps stopped by the owner's settings, by gate. */
  rules: Partial<Record<RefusalGate, number>>;
  /** True once anything at all was counted, so an office without Research still shows its rules. */
  any: boolean;
}

/** Sum a period's counters. */
export function keptSafe(rows: Array<{ key: string; n: number }>): KeptSafe {
  const c = new Map<string, number>();
  for (const r of rows) c.set(r.key, (c.get(r.key) ?? 0) + (Number(r.n) || 0));
  const get = (k: string): number => c.get(k) ?? 0;
  const rules: Partial<Record<RefusalGate, number>> = {};
  for (const g of REFUSAL_GATES) { const n = get(refusalKey(g)); if (n) rules[g] = n; }
  return {
    toInternet: { pass: get('in-pass'), clean: get('in-clean'), stop: get('in-stop') },
    webAnswers: { pass: get('out-pass'), clean: get('out-clean'), flagged: get('out-flagged') },
    held: get('in-held') + get('out-held'),
    heldIn: get('in-held'),
    heldOut: get('out-held'),
    rules,
    any: [...c.values()].some((n) => n > 0)
  };
}
