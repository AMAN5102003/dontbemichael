/**
 * The studio's life (branding/DESIGN.md 8.12): short animations driven by real
 * events, so the office moves when the work moves (owner, 2026-09-30: the
 * redesign felt static).
 *
 * - A hive message flies from sender to receiver as an envelope (or a question,
 *   a check, an escalation), lighting the wire as it goes and landing with a ping.
 * - A scheduled run (a message from the scheduler) rings the clock on Michael's
 *   wall and travels down the wire to whoever runs the job, with its name.
 * - A mail tool call raises that person's mailbox flag and carries an envelope
 *   along the mail wire: in for a search or read, out for a draft or send.
 * - Any other tool call pops a small glyph over the desk (web, terminal, file,
 *   search, books).
 * - A task that reaches Done bursts a check over its owner's pod.
 * - Michael points: a beam of light toward the pod he hands work to.
 * - A question for the owner leaves Michael's office as a paper plane and
 *   lands on the Needs you button, which bumps.
 * - Two people messaging back and forth get a conversation arc between their
 *   pods, with a count, until they go quiet for a minute.
 * - Something the owner sends Michael rises from the composer below as a paper
 *   plane in the owner's indigo (owner, 2026-10-10).
 * - A new hire's pod drops in with confetti and a welcome.
 * - Idle banter (DESIGN.md 8.8): two quiet people trade lines as paper planes
 *   (`throwNote`); the stage shows each line where it lands. An envelope is only
 *   ever a real message between the team (owner, 2026-10-04); a plane is what
 *   passes between the owner and Michael, or banter.
 *
 * Apart from the banter, nothing here is invented: every effect starts from a
 * hive message, a hook event or the task ledger. Effects stop while the stage is paused, and with
 * reduced motion a token appears at its destination for a second instead.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Agent } from '@/store/store';
import { MAIL_TOOL_OPS } from '@shared/mailboxes';
import { P, curvePts, dpath, hopPts, type Pt } from './iso';
import { EXIT, HUB, HUB_TOP, POST_GY, postGx, type PodPlan } from './layout';
import { deskSpots } from './StudioArt';
import type { SceneTokens } from './theme';

export const MAX_TOKENS = 16;
export const FLIGHT_MS = 2200;

export type SeatMap = Map<string, { pod: PodPlan<Agent>; index: number }>;

type FlightKind = 'request' | 'question' | 'propose' | 'inform' | 'done' | 'refuse' | 'you' | 'clock' | 'mail' | 'owner' | 'note-plane';
interface Flight { key: string; d: string; start: Pt; end: Pt; kind: FlightKind; color?: string; ping: boolean }
interface Pop { key: string; at: Pt; glyph: Glyph; color: string }
interface Burst { key: string; at: Pt }
interface Bubble { key: string; at: Pt; text: string; tone: 'sched' | 'welcome' }
interface Beam { key: string; to: Pt }
interface Conversation { a: string; b: string; from: Pt; to: Pt; count: number; last: number; ab: boolean; ba: boolean }
type Glyph = 'web' | 'terminal' | 'file' | 'search' | 'books' | 'spark';

export interface LifeInput {
  seatOf: SeatMap;
  godId: string;
  paused: boolean;
  T: SceneTokens;
  /** Each mailbox id in post order, with the agent who watches it. */
  posts: { id: string; ownerId?: string }[];
  /** Accent color of an agent's department, for their envelopes and pops. */
  accentOf: (agentId: string) => string;
  /** Done task ids with their owner, from the task ledger poll. */
  done: Record<string, string | undefined>;
  /** How many things wait on the owner (Needs you). */
  toYou: number;
  /** Every team member's id and name, to notice a new hire. */
  team: { id: string; name: string }[];
}

export interface Life {
  /** SVG effects, drawn over the objects on the stage. */
  svg: ReactNode;
  /** Stage px bubbles (the scheduled job's name), drawn as HTML by the stage. */
  bubbles: Bubble[];
  clockRinging: boolean;
  /** Mailboxes in use right now: an envelope coming in or going out. */
  postActive: Record<string, 'in' | 'out'>;
  /** New hires whose pod is dropping in right now. */
  arriving: Set<string>;
  /** Idle banter: a paper plane (never an envelope) from one person's pod to
   *  another's, in the sender's department color. False when it can't fly
   *  (paused, or either one has no seat). It lands after FLIGHT_MS. */
  throwNote: (fromId: string, toId: string) => boolean;
}

/** Where the Brief Michael composer sits, below the stage. */
const COMPOSER: Pt = [530, 800];

/** Curve every delegation path a little, away from the platform's center line. */
export function bendFor([gx, gy]: Pt): number {
  return (gx - gy > 0 ? -0.5 : 0.5);
}

export function flightPath(from: Pt | 'hub', to: Pt | 'hub' | 'you'): string | null {
  if (to === 'you') {
    const [x0, y0] = HUB_TOP;
    return `M${x0 + 16},${y0 + 2} C700,400 960,400 ${EXIT[0]},${EXIT[1]}`;
  }
  if (from === 'hub' && to !== 'hub') return dpath(curvePts(HUB, to, bendFor(to), 13));
  if (from !== 'hub' && to === 'hub') return dpath(curvePts(from, HUB, -bendFor(from), 13));
  if (from !== 'hub' && to !== 'hub') return dpath(hopPts(from, to, 60, 60, 58));
  return null;
}

const floorAt = (n: Pt | 'hub' | 'you'): Pt => (n === 'hub' ? P(0, 0, 14) : n === 'you' ? EXIT : P(n[0], n[1], 8));

/** Which glyph a tool call shows over the desk, or none. */
export function toolGlyph(tool: string): Glyph | null {
  if (/^mcp__md-mail__/.test(tool)) return null;
  if (/^(WebFetch|WebSearch)$|browser|playwright|chrome/i.test(tool)) return 'web';
  if (/^Bash$|^BashOutput$/.test(tool)) return 'terminal';
  if (/^(Read|Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) return 'file';
  if (/^(Grep|Glob)$/.test(tool)) return 'search';
  if (/quickbooks|qbo/i.test(tool)) return 'books';
  return 'spark';
}

export function useStudioLife({ seatOf, godId, paused, T, posts, accentOf, done, toYou, team }: LifeInput): Life {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [pops, setPops] = useState<Pop[]>([]);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [clockRinging, setClockRinging] = useState(false);
  const [postActive, setPostActive] = useState<Record<string, 'in' | 'out'>>({});
  const [beams, setBeams] = useState<Beam[]>([]);
  const [convs, setConvs] = useState<Record<string, Conversation>>({});
  const [arriving, setArriving] = useState<Set<string>>(new Set());
  const [confetti, setConfetti] = useState<Burst[]>([]);
  const lastPlane = useRef(0);
  const openedAt = useRef(Date.now());

  // Read the latest inputs from inside long-lived listeners.
  const live = useRef({ seatOf, godId, paused, posts, accentOf });
  live.current = { seatOf, godId, paused, posts, accentOf };
  // Pending timeouts only: each leaves the set when it fires, so a day of
  // events doesn't pile up ids (review, 2026-10-01).
  const timers = useRef(new Set<number>());
  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => { timers.current.delete(id); fn(); }, ms);
    timers.current.add(id);
  };
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const lastPop = useRef<Record<string, number>>({});
  const seqRef = useRef(0);

  const deskTop = (agentId: string): Pt | null => {
    const seat = live.current.seatOf.get(agentId);
    if (!seat) return null;
    const sp = deskSpots(seat.pod.members.length)[seat.index] ?? { dx: 0, dy: 0 };
    return P(seat.pod.grid[0] + sp.dx, seat.pod.grid[1] + sp.dy - 0.4, 72);
  };

  const launch = (add: Flight[]) => {
    if (!add.length) return;
    // A paper plane lands on the Needs you button, which bumps to catch it.
    if (add.some((f) => f.kind === 'you')) {
      lastPlane.current = Date.now();
      later(reduced() ? 0 : FLIGHT_MS, () => window.dispatchEvent(new Event('cth:needs-you-ping')));
    }
    setFlights((prev) => [...prev, ...add].slice(-MAX_TOKENS));
    later(reduced() ? 1000 : FLIGHT_MS + 900, () => setFlights((prev) => prev.filter((f) => !add.includes(f))));
  };

  // Hive messages: between people, from the scheduler, from the owner.
  useEffect(() => {
    type Msg = { id: string; from: string; to: string; targets?: string[]; needsHuman?: boolean; act?: string; subject?: string };
    const node = (id: string): Pt | 'hub' | 'you' | null => {
      const { godId: g, seatOf: s } = live.current;
      if (id === g || id === 'god') return 'hub';
      if (id === 'human') return 'you';
      const seat = s.get(id);
      return seat ? seat.pod.grid : null;
    };
    const fly = (e: Msg) => {
      if (live.current.paused) return;
      const scheduled = e.from === 'scheduler';
      if (scheduled) {
        setClockRinging(true);
        later(1700, () => setClockRinging(false));
      }
      const fromOwner = e.from === 'human';
      const from = scheduled ? 'hub' : node(e.from);
      const targets = e.needsHuman ? ['human'] : (e.targets?.length ? e.targets : [e.to]);
      const add: Flight[] = [];
      const pointing = !scheduled && from === 'hub' && e.act === 'request';
      for (const to of targets) {
        const dest = node(to);
        if (!from || !dest) continue;
        // The owner's message rises from the composer under the stage as a
        // paper plane, like the one Michael throws to Ask me (owner, 2026-10-10). The
        // owner only talks to Michael: app notices sent in the owner's name to
        // the team (closing time, office open) fly nothing (owner, 2026-10-04).
        if (fromOwner) {
          if (dest !== 'hub') continue;
          const [ex, ey] = HUB_TOP;
          const d = `M${COMPOSER[0]},${COMPOSER[1]} C${COMPOSER[0]},${COMPOSER[1] - 160} ${ex},${ey + 140} ${ex},${ey}`;
          add.push({ key: `m${seqRef.current++}`, d, start: COMPOSER, end: floorAt(dest), kind: 'owner', ping: true });
          continue;
        }
        if (pointing && dest !== 'hub' && dest !== 'you') {
          const beam: Beam = { key: `l${seqRef.current++}`, to: dest };
          setBeams((prev) => [...prev, beam]);
          later(1300, () => setBeams((prev) => prev.filter((x) => x !== beam)));
        }
        // Back and forth between two people (or a person and Michael) is a conversation.
        if (!scheduled && !fromOwner && dest !== 'you' && e.from !== to) {
          const [a, b] = [e.from, to].sort();
          const k = `${a}|${b}`;
          const fwd = e.from === a;
          const at = (n: Pt | 'hub'): Pt => (n === 'hub' ? HUB : n);
          const [pa, pb] = fwd ? [at(from as Pt | 'hub'), at(dest)] : [at(dest), at(from as Pt | 'hub')];
          setConvs((prev) => {
            const c = prev[k] ?? { a, b, from: pa, to: pb, count: 0, last: 0, ab: false, ba: false };
            return { ...prev, [k]: { ...c, count: c.count + 1, last: Date.now(), ab: c.ab || fwd, ba: c.ba || !fwd } };
          });
        }
        const kind: FlightKind = scheduled ? 'clock'
          : e.needsHuman || dest === 'you' ? 'you'
          : e.act === 'query' ? 'question' : e.act === 'done' || e.act === 'agree' ? 'done'
          : e.act === 'propose' ? 'propose' : e.act === 'inform' ? 'inform' : e.act === 'refuse' ? 'refuse' : 'request';
        const src = from === 'you' ? 'hub' : from;
        const d = flightPath(src, dest);
        if (d) add.push({ key: `m${seqRef.current++}`, d, start: floorAt(src), end: floorAt(dest), kind, ping: dest !== 'you' });
        // The scheduled job's name, beside the pod that runs it.
        if (scheduled && e.subject && dest !== 'you') {
          // On the floor just in front of the pod (or Michael's glass office).
          const at = dest === 'hub' ? P(1.15, 1.15, 0) : P(dest[0] + 0.75, dest[1] + 0.75, 0);
          const b: Bubble = { key: `b${seqRef.current++}`, at, text: e.subject, tone: 'sched' };
          later(scheduled ? 650 : 0, () => setBubbles((prev) => [...prev, b]));
          later(5200, () => setBubbles((prev) => prev.filter((x) => x !== b)));
        }
      }
      // The clock rings (or Michael points) first, then the work leaves his office.
      if (scheduled) later(450, () => launch(add)); else if (pointing) later(380, () => launch(add)); else launch(add);
    };
    const off = window.cth.onHiveMessage(fly);
    // Demo mode has no real hive, so the mock loop sends its own handoffs.
    const onDemo = (ev: Event) => {
      const d = (ev as CustomEvent<{ from: string; to: string; act: string; subject?: string }>).detail;
      fly({ id: 'demo', from: d.from, to: d.to, act: d.act, subject: d.subject });
    };
    window.addEventListener('cth:demo-handoff', onDemo);
    return () => { off(); window.removeEventListener('cth:demo-handoff', onDemo); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tool calls: mail moves an envelope on the mail wire; anything else pops a glyph.
  useEffect(() => {
    const onHook = (e: { agentId?: string; event: string; tool?: string; blocked?: boolean }) => {
      if (e.blocked) return;
      if (live.current.paused || e.event !== 'PreToolUse' || !e.agentId || !e.tool) return;
      const agentId = e.agentId;
      const mail = /^mcp__md-mail__([a-z_]+)$/.exec(e.tool);
      if (mail) {
        const op = MAIL_TOOL_OPS[mail[1]];
        if (!op || op === 'list') return;
        const { posts: ps, seatOf: s } = live.current;
        const i = ps.findIndex((p) => p.ownerId === agentId);
        const seat = s.get(agentId);
        if (i < 0 || !seat) return;
        const dir: 'in' | 'out' = op === 'read' ? 'in' : 'out';
        const post: Pt = [postGx(i, ps.length), POST_GY - 0.3];
        const ptsIn = curvePts(post, seat.pod.grid, 0.3, 12);
        const path = dir === 'in' ? ptsIn : [...ptsIn].reverse();
        const id = ps[i].id;
        setPostActive((prev) => ({ ...prev, [id]: dir }));
        later(3200, () => setPostActive((prev) => { const n = { ...prev }; delete n[id]; return n; }));
        launch([{ key: `e${seqRef.current++}`, d: dpath(path), start: path[0], end: path[path.length - 1], kind: 'mail', color: live.current.accentOf(agentId), ping: true }]);
        return;
      }
      const glyph = toolGlyph(e.tool);
      const at = glyph && deskTop(agentId);
      if (!glyph || !at) return;
      // One pop per person at a time; a burst of tool calls reads as one.
      const now = Date.now();
      if (now - (lastPop.current[agentId] ?? 0) < 1400) return;
      lastPop.current[agentId] = now;
      const p: Pop = { key: `p${seqRef.current++}`, at, glyph, color: live.current.accentOf(agentId) };
      setPops((prev) => [...prev, p].slice(-12));
      later(1900, () => setPops((prev) => prev.filter((x) => x !== p)));
    };
    return window.cth.onHiveHookEvent(onHook);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A task reaching Done bursts a check over its owner's pod (never on first load).
  const seen = useRef<Record<string, string | undefined> | null>(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = done;
    // The first polls after the office opens report work that was already done.
    if (!before || Date.now() - openedAt.current < 6000 || live.current.paused) return;
    for (const [id, owner] of Object.entries(done)) {
      if (id in before || !owner) continue;
      const at = deskTop(owner) ?? (owner === live.current.godId || owner === 'god' ? P(0, -0.2, 148) : null);
      if (!at) continue;
      const b: Burst = { key: `k${seqRef.current++}`, at };
      setBursts((prev) => [...prev, b]);
      later(1400, () => setBursts((prev) => prev.filter((x) => x !== b)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  // A conversation fades a minute after its last message.
  useEffect(() => {
    const id = window.setInterval(() => setConvs((prev) => {
      const now = Date.now();
      const next = Object.fromEntries(Object.entries(prev).filter(([, c]) => now - c.last < 60_000));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    }), 5000);
    return () => window.clearInterval(id);
  }, []);

  // A new Needs you item without a message in flight: Michael still sends a plane.
  const lastToYou = useRef<number | null>(null);
  useEffect(() => {
    const before = lastToYou.current;
    lastToYou.current = toYou;
    // The first counts after the office opens are what was already waiting.
    if (before === null || Date.now() - openedAt.current < 6000 || toYou <= before || live.current.paused) return;
    if (Date.now() - lastPlane.current < 4000) return;
    const d = flightPath('hub', 'you');
    if (d) launch([{ key: `y${seqRef.current++}`, d, start: floorAt('hub'), end: EXIT, kind: 'you', ping: false }]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toYou]);

  // A new hire (not someone already on the team when the office opened).
  const known = useRef<Set<string> | null>(null);
  const teamKey = team.map((m) => m.id).join(',');
  useEffect(() => {
    if (!known.current || Date.now() - openedAt.current < 4000) {
      known.current = new Set([...(known.current ?? []), ...team.map((m) => m.id)]);
      return;
    }
    for (const m of team) {
      if (known.current.has(m.id)) continue;
      known.current.add(m.id);
      if (live.current.paused) continue;
      const id = m.id;
      setArriving((prev) => new Set(prev).add(id));
      later(2600, () => setArriving((prev) => { const n = new Set(prev); n.delete(id); return n; }));
      // Wait a frame for the pod to be planned, then celebrate over it.
      later(450, () => {
        const seat = live.current.seatOf.get(id);
        if (!seat) return;
        const [gx, gy] = seat.pod.grid;
        const c: Burst = { key: `c${seqRef.current++}`, at: P(gx, gy, 80) };
        setConfetti((prev) => [...prev, c]);
        later(1800, () => setConfetti((prev) => prev.filter((x) => x !== c)));
        const b: Bubble = { key: `w${seqRef.current++}`, at: P(gx + 0.75, gy + 0.75, 0), text: m.name, tone: 'welcome' };
        setBubbles((prev) => [...prev, b]);
        later(5200, () => setBubbles((prev) => prev.filter((x) => x !== b)));
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamKey]);

  const still = reduced();
  const svg = (
    <>
      {Object.entries(convs).filter(([, c]) => c.ab && c.ba).map(([k, c]) => <ConversationArc key={k} c={c} T={T} />)}
      {!still && beams.map((b) => <PointBeam key={b.key} to={b.to} T={T} />)}
      {flights.map((f) => <Token key={f.key} f={f} T={T} still={still} />)}
      {!still && confetti.map((c) => <Confetti key={c.key} at={c.at} T={T} />)}
      {pops.map((p) => <ToolPop key={p.key} p={p} T={T} />)}
      {bursts.map((b) => <DoneBurst key={b.key} at={b.at} T={T} />)}
    </>
  );
  const throwNote = (fromId: string, toId: string): boolean => {
    const { seatOf: s, paused: p, accentOf: acc } = live.current;
    const a = s.get(fromId)?.pod.grid;
    const b = s.get(toId)?.pod.grid;
    const d = a && b ? flightPath(a, b) : null;
    if (p || !a || !b || !d) return false;
    launch([{ key: `n${seqRef.current++}`, d, start: floorAt(a), end: floorAt(b), kind: 'note-plane', color: acc(fromId), ping: true }]);
    return true;
  };
  return { svg, bubbles, clockRinging, postActive, arriving, throwNote };
}

/* ── Drawing ──────────────────────────────────────────────────────────────── */

function colorOf(kind: FlightKind, T: SceneTokens, own?: string): string {
  switch (kind) {
    case 'you': return T.coral;
    case 'question': return T.violet;
    case 'done': return T.green;
    case 'propose': return T.amber;
    case 'clock': return T.amber;
    case 'inform': return '#9C98B8';
    case 'refuse': return '#4A4660';
    case 'mail': case 'note-plane': return own ?? T.req;
    case 'owner': return T.indigo;
    default: return T.req;
  }
}

/** A message in flight: the wire lights up behind it, a puff where it leaves
 *  and a ping where it lands. */
function Token({ f, T, still }: { f: Flight; T: SceneTokens; still: boolean }) {
  const ref = useRef<SVGAnimateMotionElement | null>(null);
  useEffect(() => { if (!still) { try { ref.current?.beginElement(); } catch { /* no SMIL */ } } }, [still]);
  const color = colorOf(f.kind, T, f.color);
  const dur = `${FLIGHT_MS / 1000}s`;
  const head = <TokenHead kind={f.kind} color={color} T={T} />;
  // A paper plane turns with its path (rotate="auto" below); flying left it
  // is mirrored so it stays right side up instead of rolling over.
  const plane = f.kind === 'you' || f.kind === 'owner' || f.kind === 'note-plane';
  if (still) return <g transform={`translate(${f.end[0]},${f.end[1] - 12})${plane ? ' rotate(-50)' : ''}`}>{head}</g>;
  const ping = (at: Pt, delay: number, r: number): ReactNode => (
    <ellipse cx={at[0]} cy={at[1]} rx={r} ry={r / 2} fill="none" stroke={color} strokeWidth={2}
      className="cth-st-ping" style={{ animationDelay: `${delay}ms` } as CSSProperties} />
  );
  return (
    <g>
      {/* the wire, faintly, then a bright comet running along it */}
      <path d={f.d} fill="none" stroke={color} strokeOpacity={0.22} strokeWidth={2} strokeDasharray="1 6" strokeLinecap="round" />
      <path d={f.d} pathLength={1} fill="none" stroke={color} strokeWidth={3.2} strokeLinecap="round"
        strokeDasharray="0.16 1.3" className="cth-st-trail" style={{ animationDuration: dur } as CSSProperties} />
      {ping(f.start, 0, 18)}
      {f.ping && ping(f.end, FLIGHT_MS - 120, 30)}
      {f.ping && ping(f.end, FLIGHT_MS + 120, 30)}
      <g>
        <animateMotion ref={ref} dur={dur} begin="indefinite" fill="freeze" path={f.d} calcMode="spline" keyTimes="0;1" keySplines="0.45 0 0.25 1"
          rotate={plane ? 'auto' : undefined} />
        <g className="cth-st-tokenhead">{plane && f.end[0] < f.start[0] ? <g transform="scale(1,-1)">{head}</g> : head}</g>
      </g>
    </g>
  );
}

function TokenHead({ kind, color, T }: { kind: FlightKind; color: string; T: SceneTokens }) {
  return (
    <g>
      <circle r={14} fill={color} opacity={0.16} />
      {kind === 'you' || kind === 'owner' || kind === 'note-plane' ? (
        // A paper plane: Michael folded the question and threw it to you, you
        // sent Michael something, or two idle people pass a line across the
        // office. Nose along +x, the
        // way animateMotion rotate="auto" points a shape down its path.
        <g transform="rotate(32)">
          <path d="M-11,1 L11,-7 L3,9 L0,3 Z" fill="#FFFFFF" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
          <path d="M11,-7 L0,3" fill="none" stroke={color} strokeWidth={1.2} />
          <path d="M0,3 L-2,8 L3,9" fill={color} opacity={0.35} />
        </g>
      ) : kind === 'question' ? (
        <>
          <circle r={9} fill={color} />
          <text y={4} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight={700} fontSize={11} fill="#fff">?</text>
        </>
      ) : kind === 'done' ? (
        <>
          <circle r={9} fill={color} />
          <path d="M-4,0 l3,2.8 l5.2,-5" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : kind === 'clock' ? (
        <>
          <circle r={9} fill={color} />
          <circle r={5.2} fill="none" stroke="#fff" strokeWidth={1.4} />
          <path d="M0,-3 V0 L2.4,1.4" fill="none" stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
        </>
      ) : (
        <>
          <rect x={-10} y={-7} width={20} height={14} rx={2.5} fill={T.tokBg} stroke={color} strokeWidth={1.5} />
          <path d="M-10,-6.5 L0,1 L10,-6.5" fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
        </>
      )}
    </g>
  );
}

const GLYPHS: Record<Glyph, string> = {
  web: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3a13 13 0 0 1 0 18 13 13 0 0 1 0-18z',
  terminal: 'M5 16l5-4-5-4 M12 17h7',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4',
  books: 'M4 19V5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2 M8 7h6 M8 11h6',
  spark: 'M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8z'
};

/** What a person reached for: a small badge that rises off the desk and fades. */
function ToolPop({ p, T }: { p: Pop; T: SceneTokens }) {
  return (
    <g transform={`translate(${p.at[0]},${p.at[1]})`}>
      <g className="cth-st-pop-rise">
        <rect x={-14} y={-14} width={28} height={28} rx={9} fill={p.color} opacity={0.18} transform="scale(1.25)" />
        <rect x={-13} y={-13} width={26} height={26} rx={8} fill={T.tokBg} stroke={p.color} strokeWidth={1.8} />
        <path d={GLYPHS[p.glyph]} transform="translate(-8.4,-8.4) scale(0.7)" fill="none" stroke={p.color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </g>
  );
}

function DoneBurst({ at, T }: { at: Pt; T: SceneTokens }) {
  return (
    <g transform={`translate(${at[0]},${at[1] - 6})`}>
      <g className="cth-st-done">
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <line key={a} x1={0} y1={-15} x2={0} y2={-20} stroke={T.green} strokeWidth={2} strokeLinecap="round" transform={`rotate(${a})`} />
        ))}
        <circle r={11} fill={T.green} />
        <path d="M-4.5,0 l3,3 l6,-6" fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </g>
  );
}

/** Michael pointing: a soft wedge of light from his office to a pod's floor. */
function PointBeam({ to, T }: { to: Pt; T: SceneTokens }) {
  const [sx, sy] = P(0, -0.2, 70);
  const [tx, ty] = P(to[0], to[1], 2);
  return (
    <g className="cth-st-beam" style={{ pointerEvents: 'none' }}>
      <path d={`M${sx - 4},${sy} L${tx - 46},${ty} A46,23 0 0 0 ${tx + 46},${ty} L${sx + 4},${sy} Z`} fill={T.req} opacity={0.2} />
      <ellipse cx={tx} cy={ty} rx={50} ry={25} fill={T.req} opacity={0.28} />
      <ellipse cx={tx} cy={ty} rx={50} ry={25} fill="none" stroke={T.req} strokeOpacity={0.6} strokeWidth={1.5} />
    </g>
  );
}

/** Two people talking it through: an arc over the floor with a count. */
function ConversationArc({ c, T }: { c: Conversation; T: SceneTokens }) {
  const arc = hopPts(c.from, c.to, 40, 40, 36);
  const mid = arc[Math.floor(arc.length / 2)];
  return (
    <g style={{ pointerEvents: 'none' }}>
      <path d={dpath(arc)} fill="none" stroke={T.violet} strokeOpacity={0.55} strokeWidth={2} strokeDasharray="5 6" strokeLinecap="round" className="cth-st-flow" />
      <g transform={`translate(${mid[0]},${mid[1]})`}>
        <g className="cth-st-pop">
        <path d="M-15,-11 h30 a5,5 0 0 1 5,5 v10 a5,5 0 0 1 -5,5 h-18 l-6,6 v-6 h-6 a5,5 0 0 1 -5,-5 v-10 a5,5 0 0 1 5,-5 z" fill={T.tokBg} stroke={T.violet} strokeWidth={1.5} />
        <text y={3.8} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontWeight={600} fontSize={10.5} fill={T.violet}>{c.count}</text>
        </g>
      </g>
    </g>
  );
}

/** A welcome: bits of the five department colors thrown up over a new pod. */
function Confetti({ at, T }: { at: Pt; T: SceneTokens }) {
  const colors = [T.coral, T.amber, T.green, T.blue, T.violet];
  return (
    <g transform={`translate(${at[0]},${at[1]})`} style={{ pointerEvents: 'none' }}>
      {Array.from({ length: 18 }, (_, i) => {
        const ang = (i / 18) * Math.PI * 2;
        const dist = 26 + (i % 3) * 12;
        return (
          <rect key={i} x={-2.5} y={-1.5} width={5} height={3} rx={1} fill={colors[i % colors.length]}
            className="cth-st-confetti"
            style={{ '--cx': `${Math.cos(ang) * dist}px`, '--cy': `${Math.sin(ang) * dist * 0.7 - 18}px`, '--cr': `${(i * 47) % 360}deg`, animationDelay: `${(i % 4) * 40}ms` } as CSSProperties} />
        );
      })}
    </g>
  );
}
