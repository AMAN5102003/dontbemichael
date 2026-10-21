/** A desk stays dark at most this long, so a quiet engine never leaves it off
 *  (DESIGN.md 8.12). */
export const CLOCK_IN_CAP_MS = 60_000;

/** Who is still clocking in at `now`: their action is the clocking in `marker`,
 *  first seen less than CLOCK_IN_CAP_MS ago. `since` remembers when each was
 *  first seen and forgets anyone who is in. */
export function clockingIn(agents: ReadonlyArray<{ id: string; action?: string }>, since: Map<string, number>, now: number, marker: string): Set<string> {
  const out = new Set<string>();
  for (const a of agents) {
    if (a.action !== marker) { since.delete(a.id); continue; }
    if (!since.has(a.id)) since.set(a.id, now);
    if (now - (since.get(a.id) ?? now) < CLOCK_IN_CAP_MS) out.add(a.id);
  }
  return out;
}

/** The office opening (DESIGN.md 7.24, design review 2026-10-18): from launch,
 *  or a Restore team, until the team is first all in or the cap passes. Then it
 *  is over for the session, so a mid-day hire clocks in on their desk only. */
export type OfficeOpening =
  | { kind: 'opening'; since: number }
  | { kind: 'done'; at: number; total: number }
  | { kind: 'short'; at: number; total: number; missing: string[] }
  | { kind: 'over' };

/** The opening never ends before the saved team has had its chance to come
 *  back: the automatic restore starts 2.5 s after launch (useRestoreTeam.ts). */
export const OPENING_SETTLE_MS = 4_000;
/** How long "Everyone's in" stays before it fades. */
export const DONE_SHOWN_MS = 2_000;
/** How long the cap's note ("Toby hasn't clocked in") stays before it fades. */
export const SHORT_SHOWN_MS = 4_000;

export interface OpeningInput {
  /** Everyone on the floor, in roster order. */
  team: ReadonlyArray<{ id: string; name: string; action?: string }>;
  /** How many are still clocking in under the cap (clockingIn()). */
  arriving: number;
  /** Michael is starting with no team on the floor yet. */
  michaelStarting: boolean;
  /** A Restore team run is still bringing people back. */
  restoring: boolean;
  /** The clocking in action marker. */
  marker: string;
}

/** The opening's next step at `now`. Returns `o` itself when nothing changes. */
export function nextOpening(o: OfficeOpening, input: OpeningInput, now: number): OfficeOpening {
  if (o.kind === 'over') return o;
  if (o.kind === 'done') return now - o.at >= DONE_SHOWN_MS ? { kind: 'over' } : o;
  if (o.kind === 'short') return now - o.at >= SHORT_SHOWN_MS ? { kind: 'over' } : o;
  if (now - o.since < OPENING_SETTLE_MS || input.restoring || input.arriving > 0) return o;
  // An office with no team ends quietly once Michael is in: the empty floor
  // has its own card, and there is nobody to have been waiting for.
  if (input.team.length === 0) return input.michaelStarting ? o : { kind: 'over' };
  const missing = stillOut(input.team, input.marker);
  const total = input.team.length;
  return missing.length ? { kind: 'short', at: now, total, missing } : { kind: 'done', at: now, total };
}

/** Who has not clocked in yet, by name, in roster order: everyone still
 *  carrying the marker, past the cap or not. */
export function stillOut(team: OpeningInput['team'], marker: string): string[] {
  return team.filter((a) => a.action === marker).map((a) => a.name);
}

/** The first `max` names and how many more ("Toby, Ryan, Oscar and 4 more"). */
export function namesShown(names: ReadonlyArray<string>, max = 3): { names: string[]; more: number } {
  return { names: names.slice(0, max), more: Math.max(0, names.length - max) };
}
