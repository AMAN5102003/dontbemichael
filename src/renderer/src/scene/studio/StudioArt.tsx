/**
 * The studio illustration (branding/DESIGN.md 8): platform, department pods,
 * Michael's glass pod, mailbox posts and the paths between them. Pure SVG, drawn
 * on the fixed 1060 x 816 stage; StudioStage scales it and lays the HTML cards
 * over it. Ported from the approved reference generator.
 */
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { P, S, curvePts, dpath, pts, type Pt } from './iso';
import { Box, EllipseAt, Poly } from './shapes';
import type { Family, SceneTokens } from './theme';
import { PROP_ART, hasProp } from '@/scene/office/props';
import { cutText } from '@shared/cutText';

/** What a desk's screen and floor show (DESIGN.md 3.5, 8.5). */
export type DeskState = 'working' | 'thinking' | 'waiting' | 'needs' | 'compacting' | 'looping' | 'success' | 'idle';

/* ── Shared defs ──────────────────────────────────────────────────────────── */

export function StudioDefs({ T, families }: { T: SceneTokens; families: Record<string, Family> }) {
  return (
    <defs>
      {Object.entries(families).map(([k, c]) => (
        <Fragment key={k}>
          <radialGradient id={`st-glow-${k}`}>
            <stop offset="0" stopColor={c.acc} stopOpacity={T.glowOp[0]} />
            <stop offset=".55" stopColor={c.acc} stopOpacity={T.glowOp[1]} />
            <stop offset="1" stopColor={c.acc} stopOpacity={0} />
          </radialGradient>
          <linearGradient id={`st-scr-${k}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={T.scr0} />
            <stop offset=".55" stopColor={c.lit} />
            <stop offset="1" stopColor={c.litM} />
          </linearGradient>
        </Fragment>
      ))}
      <radialGradient id="st-glow-coral"><stop offset="0" stopColor={T.coral} stopOpacity=".40" /><stop offset=".55" stopColor={T.coral} stopOpacity=".12" /><stop offset="1" stopColor={T.coral} stopOpacity="0" /></radialGradient>
      <radialGradient id="st-glow-violet"><stop offset="0" stopColor={T.violet} stopOpacity=".36" /><stop offset=".55" stopColor={T.violet} stopOpacity=".12" /><stop offset="1" stopColor={T.violet} stopOpacity="0" /></radialGradient>
      <radialGradient id="st-glow-hub"><stop offset="0" stopColor="#7C6CF2" stopOpacity=".30" /><stop offset=".6" stopColor="#7C6CF2" stopOpacity=".08" /><stop offset="1" stopColor="#7C6CF2" stopOpacity="0" /></radialGradient>
      <linearGradient id="st-floor" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={T.floor0} /><stop offset="1" stopColor={T.floor1} /></linearGradient>
      <linearGradient id="st-glassB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={T.glassB[0]} stopOpacity={T.glassB[1]} /><stop offset="1" stopColor={T.glassB[2]} stopOpacity={T.glassB[3]} /></linearGradient>
      <linearGradient id="st-glassF" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={T.glassF[0]} stopOpacity={T.glassF[1]} /><stop offset="1" stopColor={T.glassF[2]} stopOpacity={T.glassF[3]} /></linearGradient>
      <linearGradient id="st-scr-hub" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset=".5" stopColor="#E6E2FF" /><stop offset="1" stopColor="#B9B0F7" /></linearGradient>
      <linearGradient id="st-scr-think" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset=".5" stopColor="#EDE5FF" /><stop offset="1" stopColor="#C8B4FA" /></linearGradient>
      <linearGradient id="st-scr-needs" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset=".5" stopColor="#FFE6E7" /><stop offset="1" stopColor="#FFB9BB" /></linearGradient>
      <linearGradient id="st-beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#7C6CF2" stopOpacity="0" /><stop offset=".4" stopColor="#7C6CF2" stopOpacity=".18" /><stop offset="1" stopColor="#7C6CF2" stopOpacity="0" /></linearGradient>
      <filter id="st-soft" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="14" /></filter>
      <filter id="st-halo" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6" /></filter>
      <marker id="st-arr-coral" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M1,1 L8,5 L1,9" fill="none" stroke={T.coral} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </marker>
    </defs>
  );
}

/* ── Platform ─────────────────────────────────────────────────────────────── */

export function Platform({ T }: { T: SceneTokens }) {
  const A = 5;
  const TH = 22;
  const shadow = [P(-A, -A, -TH - 10), P(A, -A, -TH - 10), P(A, A, -TH - 10), P(-A, A, -TH - 10)].map(([x, y]) => [x, y + 26] as Pt);
  const lines: ReactNode[] = [];
  for (let i = -4; i <= 4; i++) {
    const [a, b, c, d] = [P(i, -A), P(i, A), P(-A, i), P(A, i)];
    lines.push(<line key={`a${i}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={T.grid} strokeOpacity={T.gridOp} strokeWidth={1} />);
    lines.push(<line key={`b${i}`} x1={c[0]} y1={c[1]} x2={d[0]} y2={d[1]} stroke={T.grid} strokeOpacity={T.gridOp} strokeWidth={1} />);
  }
  return (
    <g>
      <polygon points={pts(shadow)} fill={T.platSh} opacity={T.platShOp} filter="url(#st-soft)" />
      <Poly ps={[P(-A, A, 0), P(A, A, 0), P(A, A, -TH), P(-A, A, -TH)]} fill={T.platL} />
      <Poly ps={[P(A, -A, 0), P(A, A, 0), P(A, A, -TH), P(A, -A, -TH)]} fill={T.platR} />
      <polyline points={pts([P(-A, A, -TH + 6), P(A, A, -TH + 6), P(A, -A, -TH + 6)])} fill="none" stroke="#FFFFFF" strokeOpacity={T.bandOp} strokeWidth={1} />
      <polygon points={pts([P(-A, -A), P(A, -A), P(A, A), P(-A, A)])} fill="url(#st-floor)" />
      {lines}
      <polyline points={pts([P(-A, A), P(A, A), P(A, -A)])} fill="none" stroke={T.edgeF} strokeWidth={1.6} />
      <polyline points={pts([P(-A, A), P(-A, -A), P(A, -A)])} fill="none" stroke={T.edgeB} strokeWidth={1} />
    </g>
  );
}

// Glass monitors (owner, 2026-10-15; docs/designs/office-floor-plates-glass.md):
// a frameless slab, a faint clear pane when idle, tinted with scrolling lines at work.
const GLASS_TOP = 'rgba(220,228,246,0.35)';
const GLASS_LEFT = 'rgba(226,234,250,0.2)';
const GLASS_RIGHT = 'rgba(200,210,236,0.35)';
const GLASS_IDLE = 'rgba(226,234,250,0.38)';
const GLASS_SHINE = 'rgba(255,255,255,0.55)';

/* ── A desk (station) ─────────────────────────────────────────────────────── */

export function Station({ gx, gy, st, sc = 1, plant = false, prop, c, famKey, T, dark }: {
  gx: number; gy: number; st: DeskState; sc?: number; plant?: boolean; c: Family; famKey: string; T: SceneTokens; dark: boolean;
  /** Whose desk this is: their signature prop stands on it. */
  prop?: string;
}) {
  const mz0 = 33;
  const mh = sc >= 1 ? 24 : 21;
  const mw = 0.36 * sc;
  // The pane fills the whole slab: no frame.
  const iw = mw - 0.008;
  const inset = 0.6;
  const scr = [P(gx - iw, gy - 0.37, mz0 + inset), P(gx + iw, gy - 0.37, mz0 + inset), P(gx + iw, gy - 0.37, mz0 + mh - inset), P(gx - iw, gy - 0.37, mz0 + mh - inset)];
  const on = st !== 'idle';
  // Idle glass is clear; at work it takes the color it shows (about 13%).
  const screenFill = st === 'idle' ? GLASS_IDLE
    : st === 'thinking' || st === 'compacting' ? 'rgba(124,92,231,0.14)'
    : st === 'needs' ? 'rgba(255,90,95,0.16)'
    : `${c.acc}22`;
  const lineColor = st === 'thinking' || st === 'compacting' ? T.violet : st === 'needs' ? T.coral : c.acc;
  const cw = 0.19 * Math.min(sc, 1);
  const lines = st === 'working' || st === 'needs' || st === 'thinking' || st === 'looping' || st === 'success';
  // While someone works or thinks, their screen scrolls: six lines in a
  // repeating pattern of three, moving up one pattern (15px) per loop, clipped
  // to the screen.
  const scrolling = st === 'working' || st === 'looping' || st === 'thinking' || st === 'compacting';
  const clip = `st-clip-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [mugX, mugY] = P(gx + 0.38 * sc - 0.03, gy - 0.03, 36);
  return (
    <g className={st === 'working' ? 'cth-st-breathe' : undefined}>
      <Box gx={gx - 0.5 * sc} gy={gy - 0.48} w={1.0 * sc} d={0.56} h={22} z0={6} top={T.desk} left={c.m} right={c.d} T={T} />
      <Box gx={gx - 0.04} gy={gy - 0.38} w={0.08} d={0.05} h={5} z0={28} top={T.metal[0]} left={T.metal[1]} right={T.metal[2]} rim={false} T={T} />
      <Box gx={gx - 0.14 * sc} gy={gy - 0.42} w={0.28 * sc} d={0.12} h={1.5} z0={28} top={T.kbase} left={T.metal[1]} right={T.metal[2]} rim={false} T={T} />
      <Box gx={gx - mw} gy={gy - 0.4} w={2 * mw} d={0.02} h={mh} z0={mz0} top={GLASS_TOP} left={GLASS_LEFT} right={GLASS_RIGHT} rim={false} T={T} />
      {dark && on && <polygon points={pts(scr)} fill={lineColor} opacity={0.25} filter="url(#st-halo)" />}
      <polygon points={pts(scr)} fill={screenFill} />
      {!on && (
        // a soft reflection across the glass
        <polygon points={pts([P(gx - iw * 0.55, gy - 0.37, mz0 + mh - inset), P(gx - iw * 0.2, gy - 0.37, mz0 + mh - inset), P(gx - iw * 0.75, gy - 0.37, mz0 + inset), P(gx - iw, gy - 0.37, mz0 + inset)])} fill={GLASS_SHINE} />
      )}
      {lines && !scrolling && [[-0.72, 0.33], [-0.72, 0.55], [-0.72, 0.05]].map(([x0, x1], i) => {
        const zz = mz0 + mh - 7 - i * 5;
        const [a, b] = [P(gx + x0 * iw, gy - 0.37, zz), P(gx + x1 * iw, gy - 0.37, zz)];
        return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={lineColor} strokeWidth={1.6} strokeLinecap="round" opacity={0.9 - i * 0.2} />;
      })}
      {scrolling && (
        <g clipPath={`url(#${clip})`}>
          <clipPath id={clip}><polygon points={pts(scr)} /></clipPath>
          <g className="cth-st-scroll">
            {[[-0.72, 0.33], [-0.72, 0.55], [-0.72, 0.05], [-0.72, 0.33], [-0.72, 0.55], [-0.72, 0.05], [-0.72, 0.33]].map(([x0, x1], i) => {
              const zz = mz0 + mh - 7 - i * 5 + 0;
              const [a, b] = [P(gx + x0 * iw, gy - 0.37, zz), P(gx + x1 * iw, gy - 0.37, zz)];
              return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={lineColor} strokeWidth={1.6} strokeLinecap="round" opacity={0.85} />;
            })}
          </g>
        </g>
      )}
      {on && st !== 'waiting' && (
        <polygon points={pts([P(gx - 0.34 * sc, gy - 0.3, 28.2), P(gx + 0.34 * sc, gy - 0.3, 28.2), P(gx + 0.3 * sc, gy + 0.02, 28.2), P(gx - 0.3 * sc, gy + 0.02, 28.2)])} fill={lineColor} opacity={T.spillOp} />
      )}
      <polygon points={pts([P(gx - 0.2 * sc, gy - 0.12, 28.3), P(gx + 0.18 * sc, gy - 0.12, 28.3), P(gx + 0.18 * sc, gy, 28.3), P(gx - 0.2 * sc, gy, 28.3)])} fill={T.kb} stroke={T.kbBd} strokeWidth={0.8} />
      <Box gx={gx + 0.38 * sc - 0.08} gy={gy - 0.08} w={0.1} d={0.1} h={7} z0={28} top={T.mug} left={c.acc} right={c.d} rim={false} T={T} />
      {scrolling && [0, 1].map((i) => (
        <path key={i} className="cth-st-steam" style={{ animationDelay: `${i * 1.2}s` }}
          d={`M${mugX + i * 3 - 1.5},${mugY} c-3,-4 3,-6 0,-10 c-3,-4 3,-6 0,-10`}
          fill="none" stroke={T.stem} strokeWidth={1.3} strokeLinecap="round" />
      ))}
      {/* chair */}
      <Box gx={gx - 0.03} gy={gy + 0.3} w={0.06} d={0.06} h={12} z0={6} top={T.metal[0]} left={T.metal[1]} right={T.metal[2]} rim={false} T={T} />
      <Box gx={gx - cw} gy={gy + 0.2} w={2 * cw} d={0.32} h={4} z0={16} top={T.seat[0]} left={T.seat[1]} right={T.seat[2]} T={T} />
      <Box gx={gx - cw} gy={gy + 0.46} w={2 * cw} d={0.07} h={20} z0={20} top={T.back[0]} left={T.back[1]} right={T.back[2]} T={T} />
      {plant && <Plant gx={gx - 0.47 * sc} gy={gy - 0.45} T={T} />}
      {hasProp(prop) && <DeskProp at={P(gx - 0.34 * sc, gy - 0.1, 28)} size={15 * Math.min(sc, 1)}>{PROP_ART[prop]}</DeskProp>}
      {(st === 'thinking') && <ThinkBubble at={P(gx + 0.1, gy - 0.4, 70)} T={T} />}
      {st === 'compacting' && <CompactGlyph at={P(gx + 0.25 * sc, gy - 0.2, 36)} T={T} />}
      {st === 'looping' && <LoopRing at={P(gx, gy + 0.36, 16)} T={T} />}
      {st === 'success' && <CheckBurst at={P(gx, gy - 0.4, 74)} T={T} />}
    </g>
  );
}

/** A prop standing on a desk: drawn flat, its base on the desk top at `at`. */
function DeskProp({ at: [x, y], size, children }: { at: Pt; size: number; children: ReactNode }) {
  return (
    <g>
      <ellipse cx={x} cy={y - 0.5} rx={size * 0.32} ry={size * 0.12} fill="#1E1B2E" opacity={0.12} />
      <svg x={x - size / 2} y={y - size} width={size} height={size} viewBox="0 0 24 24" overflow="visible">{children}</svg>
    </g>
  );
}

/* ── Floor decor (owner, 2026-10-03: more life on the floor) ──────────────── */

/** Plants and the water cooler, on open floor clear of every ring slot,
 *  the mailbox row and Michael's office. Grid points. */
export const DECOR: { kind: 'plant' | 'cooler'; at: Pt }[] = [
  { kind: 'cooler', at: [4.45, -4.45] },
  { kind: 'plant', at: [2.1, -1.9] },
  { kind: 'plant', at: [-1.95, 2.15] },
  { kind: 'plant', at: [-4.55, -4.55] }
];

export function Decor({ kind, at: [gx, gy], T }: { kind: 'plant' | 'cooler'; at: Pt; T: SceneTokens }) {
  if (kind === 'plant') {
    const [x, y] = P(gx, gy, 30);
    return (
      <g>
        <EllipseAt gx={gx} gy={gy} z={0} r={0.24} fill={T.papSh} opacity={T.papShOp} />
        <Box gx={gx - 0.13} gy={gy - 0.13} w={0.26} d={0.26} h={16} z0={0} top={T.pot[0]} left={T.pot[1]} right={T.pot[2]} T={T} />
        <g className="cth-st-sway">
          <circle cx={x - 7} cy={y + 2} r={8} fill="#4DB97E" />
          <circle cx={x + 7} cy={y} r={8.5} fill="#3FA463" />
          <circle cx={x} cy={y - 7} r={8} fill="#6BCB94" />
          <circle cx={x + 1} cy={y + 4} r={6.5} fill="#86D9A8" />
        </g>
      </g>
    );
  }
  const [bx, by] = P(gx, gy, 34);
  return (
    <g>
      <EllipseAt gx={gx} gy={gy} z={0} r={0.26} fill={T.papSh} opacity={T.papShOp} />
      <Box gx={gx - 0.14} gy={gy - 0.14} w={0.28} d={0.28} h={34} z0={0} top={T.seat[0]} left={T.seat[1]} right={T.seat[2]} T={T} />
      <Box gx={gx + 0.1} gy={gy - 0.06} w={0.02} d={0.12} h={4} z0={20} top="#3D8BE6" left="#3D8BE6" right="#2F6FBF" rim={false} T={T} />
      <rect x={bx - 9} y={by - 25} width={18} height={24} rx={7} fill="#B4D5F8" stroke="#93BEEE" strokeWidth={1} opacity={0.92} />
      <rect x={bx - 4} y={by - 22} width={3} height={16} rx={1.5} fill="#FFFFFF" opacity={0.65} />
    </g>
  );
}

function Plant({ gx, gy, T }: { gx: number; gy: number; T: SceneTokens }) {
  const [x, y] = P(gx + 0.06, gy + 0.06, 42);
  return (
    <g>
      <Box gx={gx} gy={gy} w={0.12} d={0.12} h={7} z0={28} top={T.pot[0]} left={T.pot[1]} right={T.pot[2]} rim={false} T={T} />
      <g className="cth-st-sway">
        <circle cx={x - 3} cy={y + 2} r={5.2} fill="#6BCB94" />
        <circle cx={x + 3} cy={y} r={5.5} fill="#4DB97E" />
        <circle cx={x} cy={y - 4} r={4.8} fill="#86D9A8" />
      </g>
    </g>
  );
}

function ThinkBubble({ at: [x, y], T }: { at: Pt; T: SceneTokens }) {
  return (
    <g>
      <rect x={x - 17} y={y - 9} width={34} height={18} rx={9} fill={T.bub} stroke={T.bubBd} />
      {[0, 1, 2].map((i) => <circle key={i} className="cth-st-dot" style={{ animationDelay: `${i * 0.18}s` }} cx={x - 8 + i * 8} cy={y} r={2.4} fill={T.violet} />)}
    </g>
  );
}

function CompactGlyph({ at: [x, y], T }: { at: Pt; T: SceneTokens }) {
  return (
    <g>
      <rect x={x - 7} y={y - 6} width={14} height={11} rx={2} fill={T.bub} stroke={T.violet} strokeWidth={1.4} />
      <path d={`M${x - 7},${y - 2} h14 M${x - 2},${y - 2} v3 h4 v-3`} fill="none" stroke={T.violet} strokeWidth={1.2} />
    </g>
  );
}

function LoopRing({ at: [x, y], T }: { at: Pt; T: SceneTokens }) {
  return (
    <ellipse className="cth-st-spin" cx={x} cy={y} rx={22} ry={11} fill="none" stroke={T.amber} strokeWidth={2} strokeDasharray="14 8" />
  );
}

function CheckBurst({ at: [x, y], T }: { at: Pt; T: SceneTokens }) {
  return (
    <g className="cth-st-burst">
      <circle cx={x} cy={y} r={11} fill={T.green} />
      <path d={`M${x - 4.5},${y} l3,3 l6,-6`} fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/* ── A department pod ─────────────────────────────────────────────────────── */

export interface PodDesk {
  st: DeskState;
  /** The character at this desk, for their prop. */
  prop?: string;
  /** This person has not clocked in yet: their desk light is off. */
  away?: boolean;
}

/** A light that has just come on flickers like a strip light (DESIGN.md 8.12).
 *  Returns the class while it flickers, after `off` goes from true to false. */
function useLightsOn(off: boolean): string | undefined {
  const [on, setOn] = useState(false);
  const was = useRef(off);
  useEffect(() => {
    if (was.current && !off) {
      setOn(true);
      const id = window.setTimeout(() => setOn(false), 1000);
      was.current = off;
      return () => window.clearTimeout(id);
    }
    was.current = off;
    return undefined;
  }, [off]);
  return on ? 'cth-st-lightson' : undefined;
}

/** Desk offsets for a pod of 1 to 4 people (DESIGN.md 8.9). */
export function deskSpots(n: number): { dx: number; dy: number; sc: number }[] {
  if (n <= 1) return [{ dx: 0, dy: 0, sc: 1 }];
  if (n === 2) return [{ dx: -0.48, dy: 0, sc: 0.9 }, { dx: 0.48, dy: 0, sc: 0.9 }];
  const back = [{ dx: -0.48, dy: -0.5, sc: 0.9 }, { dx: 0.48, dy: -0.5, sc: 0.9 }];
  const front = n === 3 ? [{ dx: 0, dy: 0.62, sc: 0.9 }] : [{ dx: -0.48, dy: 0.62, sc: 0.9 }, { dx: 0.48, dy: 0.62, sc: 0.9 }];
  return [...back, ...front];
}

export function Pod({ grid: [gx, gy], desks, c, famKey, selected, T, dark, arriving = false, lightsOut = false, label }: {
  grid: Pt; desks: PodDesk[]; c: Family; famKey: string; selected: boolean; T: SceneTokens; dark: boolean;
  /** The department's name, on a plate in front of the chairs, so an owner who
   *  doesn't know the show sees what the office does (owner, 2026-10-15). */
  label?: string;
  /** A new hire's pod, dropping into place. */
  arriving?: boolean;
  /** Everyone here confirmed at closing time: the lights are off. */
  lightsOut?: boolean;
}) {
  const n = desks.length;
  const spots = deskSpots(n);
  const plate = label ? plateSize(label) : null;
  // The pad grows only by what the plate needs (owner, 2026-10-15): just deeper
  // at the front, and just wider when a word is longer than a small office.
  const hw = Math.max(n === 1 ? 0.65 : 1.0, plate ? plate.w / (2 * S) + 0.06 : 0);
  const hd = n <= 2 ? 0.65 : 1.2;
  const plateGy = (n <= 2 ? CHAIR_END : FRONT_ROW + CHAIR_END) + 0.1;
  const front = plate ? Math.max(0, plateGy + 0.12 - hd) : 0;
  const allIdle = desks.every((d) => d.st === 'idle');
  const needs = desks.some((d) => d.st === 'needs');
  const podFlicker = useLightsOn(lightsOut);
  return (
    <g className={[allIdle ? 'cth-st-idle' : '', arriving ? 'cth-st-arrive' : '', lightsOut ? 'cth-st-lightsout' : '', podFlicker ?? ''].filter(Boolean).join(' ') || undefined}>
      <Box gx={gx - hw} gy={gy - hd} w={2 * hw} d={2 * hd + front} h={6} z0={0} top={c.l} left={c.m} right={c.d} T={T} />
      <polygon points={pts([P(gx - hw + 0.1, gy - hd + 0.1, 6), P(gx + hw - 0.1, gy - hd + 0.1, 6), P(gx + hw - 0.1, gy + hd + front - 0.1, 6), P(gx - hw + 0.1, gy + hd + front - 0.1, 6)])}
        fill="none" stroke={T.inset} strokeOpacity={T.insetOp} strokeWidth={1} />
      {spots.map((sp, i) => {
        const d = desks[i];
        const inner = <Station gx={gx + sp.dx} gy={gy + sp.dy} st={d.st} sc={sp.sc} plant={i === 0 && n <= 2} prop={d.prop} c={c} famKey={famKey} T={T} dark={dark} />;
        return <DeskLight key={i} away={!lightsOut && !!d.away} idle={d.st === 'idle' && !allIdle}>{inner}</DeskLight>;
      })}
      {plate && <DeptPlate at={P(gx, gy + plateGy, 6)} {...plate} c={c} dark={dark} />}
      {needs && <Beacon at={[gx + 0.42, gy - hd + 0.2]} T={T} />}
      {selected && (
        <EllipseAt gx={gx} gy={gy} z={2} r={Math.max(hw, hd) + 0.3} fill="none" stroke={dark ? '#ECEAF4' : '#1E1B2E'} strokeWidth={1.6} strokeDasharray="6 4" />
      )}
    </g>
  );
}

/** How far past its desk a chair's back reaches, and where the front row of a
 *  three or four person pod sits (deskSpots, Station). */
const CHAIR_END = 0.53;
const FRONT_ROW = 0.62;

/** A department plate's word and width in stage px. Latin words are spaced
 *  capitals; spacing would break Arabic's joined letters, so it has none. */
export function plateSize(label: string): { word: string; w: number; spaced: boolean } {
  const spaced = /^[\u0000-\u024F\s]+$/.test(label);
  const word = spaced ? label.toLocaleUpperCase() : label;
  return { word, w: Math.round(10 + word.length * 4.6), spaced };
}

/** The department plate, lying on the pad in the floor's plane (the plane of
 *  Michael's name plate), in the department's color. */
function DeptPlate({ at: [x, y], word, w, spaced, c, dark }: { at: Pt; word: string; w: number; spaced: boolean; c: Family; dark: boolean }) {
  return (
    <g transform={`matrix(1,0.5,-1,0.5,${x.toFixed(1)},${y.toFixed(1)})`}>
      <rect x={-w / 2} y={-4.5} width={w} height={9} rx={2.2} fill={dark ? '#24222F' : '#FFFFFF'} fillOpacity={0.92} stroke={c.acc} strokeWidth={0.7} />
      <text x={0} y={2.1} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight={700} fontSize={5.8} letterSpacing={spaced ? 0.5 : 0} fill={c.acc}>{word}</text>
    </g>
  );
}

/** One desk's light: off until its person clocks in, then it flickers on. */
function DeskLight({ away, idle, children }: { away: boolean; idle: boolean; children: ReactNode }) {
  const flicker = useLightsOn(away);
  const cls = [idle ? 'cth-st-idle' : '', away ? 'cth-st-lightsout' : '', flicker ?? ''].filter(Boolean).join(' ');
  return <g className={cls || undefined}>{children}</g>;
}

/** Floor glow under a pod, drawn beneath everything (DESIGN.md 8.3). */
export function PodGlow({ grid: [gx, gy], desks, famKey }: { grid: Pt; desks: PodDesk[]; famKey: string }) {
  const sts = desks.map((d) => d.st);
  if (sts.includes('needs')) return <EllipseAt gx={gx} gy={gy} z={0} r={1.3} fill="url(#st-glow-coral)" className="cth-st-breathe" />;
  if (sts.includes('working') || sts.includes('looping') || sts.includes('success')) return <EllipseAt gx={gx} gy={gy} z={0} r={1.25} fill={`url(#st-glow-${famKey})`} />;
  if (sts.includes('thinking') || sts.includes('compacting')) return <EllipseAt gx={gx} gy={gy} z={0} r={1.2} fill="url(#st-glow-violet)" />;
  return null;
}

function Beacon({ at: [bx, by], T }: { at: Pt; T: SceneTokens }) {
  const [a, b] = [P(bx, by, 28), P(bx, by, 76)];
  return (
    <g>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={T.pole} strokeWidth={2} strokeLinecap="round" />
      <ellipse className="cth-st-ring" cx={b[0]} cy={b[1]} rx={16} ry={16} fill="none" stroke={T.coral} strokeWidth={1.6} />
      <circle cx={b[0]} cy={b[1]} r={13} fill={T.coral} opacity={0.18} />
      <circle cx={b[0]} cy={b[1]} r={7.5} fill={T.coral} />
      <circle cx={b[0] - 2.2} cy={b[1] - 2.4} r={2.4} fill="#FFFFFF" opacity={0.75} />
    </g>
  );
}

/* ── Michael's glass pod ──────────────────────────────────────────────────── */

export function Hub({ T, dark, board, busy = false, ringing = false, lightsOut = false, stats, name = 'Michael', plateLit = false }: {
  T: SceneTokens; dark: boolean; board: { todo: number; doing: number; blocked: number; done: number };
  /** Michael is at work: his screens scroll, the marker writes on the board. */
  busy?: boolean;
  /** A scheduled job just started: the wall clock rings. */
  ringing?: boolean;
  /** Closing time is done: Michael's office goes dark last. */
  lightsOut?: boolean;
  /** His name, on the plate by his door. */
  name?: string;
  /** His card is open (hovered or selected): the plate's rim lights up. */
  plateLit?: boolean;
  /** His numbers, shown on the sign on his right wall (DESIGN.md 8.4). */
  stats?: { delegated: number; toYou: number; kept: number; ctx: number | null };
}) {
  const a = 1.05;
  const ph = 14;
  // Taller glass than the pods' desks, so the board and the sign have room
  // above the monitors (owner, 2026-09-30: his numbers live on his walls).
  const wh = 72;
  const z0 = ph;
  const z1 = ph + wh;
  const bz0 = z0 + 18;
  const bz1 = z0 + 62;
  // Left to right as you read the wall: To do, Doing, Blocked, Done.
  const cols: [number, string, number][] = [
    [0.15, '#9C97CC', board.todo], [-0.21, T.blue, board.doing], [-0.57, T.coral, board.blocked], [-0.93, T.green, board.done]
  ];
  const hubFlicker = useLightsOn(lightsOut);
  return (
    <g className={lightsOut ? 'cth-st-lightsout' : hubFlicker}>
      <EllipseAt gx={0} gy={0} z={0} r={2.2} fill="url(#st-glow-hub)" />
      <Box gx={-a - 0.12} gy={-a - 0.12} w={2 * a + 0.24} d={2 * a + 0.24} h={5} z0={0} top={T.hbBase[0]} left={T.hbBase[1]} right={T.hbBase[2]} T={T} />
      <Box gx={-a} gy={-a} w={2 * a} d={2 * a} h={ph - 5} z0={5} top={T.hbFloor[0]} left={T.hbFloor[1]} right={T.hbFloor[2]} T={T} />
      <EllipseAt gx={0} gy={0} z={ph} r={0.92} fill="none" stroke={T.ring} strokeOpacity={0.35} strokeWidth={1.5} />
      <EllipseAt gx={0} gy={0} z={ph} r={0.72} fill="none" stroke={T.ring} strokeOpacity={0.18} strokeWidth={1} strokeDasharray="2 4" />
      <polygon points={pts([P(-a, -a, z0), P(-a, a, z0), P(-a, a, z1), P(-a, -a, z1)])} fill="url(#st-glassB)" />
      <polygon points={pts([P(-a, -a, z0), P(a, -a, z0), P(a, -a, z1), P(-a, -a, z1)])} fill="url(#st-glassB)" />
      {/* the task board on the back glass: one sticky per task, up to 4 per column */}
      <polygon points={pts([P(-a + 0.01, -0.97, bz0), P(-a + 0.01, 0.47, bz0), P(-a + 0.01, 0.47, bz1), P(-a + 0.01, -0.97, bz1)])} fill={T.board} stroke={T.boardBd} strokeWidth={1} />
      {/* Each column's count at its head, written on the board's plane. */}
      {cols.map(([g0, col, n]) => {
        const [tx, ty] = P(-a + 0.02, g0 + 0.155, bz1 - 13);
        return (
          <g key={`n-${g0}`} transform={`matrix(1,-0.5,0,1,${tx.toFixed(1)},${ty.toFixed(1)})`}>
            <text key={n} className="cth-st-tick" y={0} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontWeight={600} fontSize={11} fill={col}>{n}</text>
          </g>
        );
      })}
      {/* A sticky pops onto its column when it arrives; the Doing column's
          stickies breathe, since that work is in progress right now. */}
      {cols.map(([g0, col, n], ci) => Array.from({ length: Math.min(n, 4) }, (_, j) => {
        const zz = bz1 - 19 - j * 6;
        return <polygon key={`${g0}-${j}`} className={ci === 1 ? 'cth-st-pop cth-st-doing' : 'cth-st-pop'}
          style={ci === 1 ? { animationDelay: `0s, ${j * 0.3}s` } : undefined}
          points={pts([P(-a + 0.02, g0 + 0.03, zz - 4.2), P(-a + 0.02, g0 + 0.28, zz - 4.2), P(-a + 0.02, g0 + 0.28, zz), P(-a + 0.02, g0 + 0.03, zz)])} fill={col} opacity={0.9} />;
      }))}
      {/* Michael's marker writing a line under the columns while he works. */}
      {busy && (() => {
        const [p0, p1] = [P(-a + 0.02, 0.4, bz0 + 3), P(-a + 0.02, -0.88, bz0 + 3)];
        return <line x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]} pathLength={1} className="cth-st-write" stroke={T.req} strokeWidth={1.4} strokeLinecap="round" strokeDasharray="1 1" />;
      })()}
      <WallClock at={P(-a + 0.01, 0.8, z1 - 30)} plane="left" ringing={ringing} T={T} />
      {stats && <StatsSign at={P(-0.6, -a + 0.01, z1 - 3)} stats={stats} T={T} dark={dark} />}
      {[[P(-a, a, z0), P(-a, a, z1)], [P(-a, -a, z0), P(-a, -a, z1)], [P(a, -a, z0), P(a, -a, z1)]].map(([p0, p1], i) => (
        <line key={i} x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]} stroke={T.wall} strokeWidth={1.4} />
      ))}
      <polyline points={pts([P(-a, a, z1), P(-a, -a, z1), P(a, -a, z1)])} fill="none" stroke={T.wall} strokeWidth={1.6} />
      <Box gx={-0.62} gy={-0.5} w={1.24} d={0.6} h={22} z0={ph} top={T.hdesk[0]} left={T.hdesk[1]} right={T.hdesk[2]} T={T} />
      {[-0.36, 0.12].map((ox) => {
        const scr = [P(ox - 0.04, -0.4, ph + 29.5), P(ox + 0.36, -0.4, ph + 29.5), P(ox + 0.36, -0.4, ph + 46.5), P(ox - 0.04, -0.4, ph + 46.5)];
        return (
          <g key={ox} className="cth-st-breathe">
            <Box gx={ox + 0.1} gy={-0.42} w={0.06} d={0.05} h={5} z0={ph + 22} top={T.metal[0]} left={T.metal[1]} right={T.metal[2]} rim={false} T={T} />
            <Box gx={ox - 0.07} gy={-0.43} w={0.46} d={0.02} h={22} z0={ph + 27} top={GLASS_TOP} left={GLASS_LEFT} right={GLASS_RIGHT} rim={false} T={T} />
            {dark && <polygon points={pts(scr)} fill="#8C80F0" opacity={0.25} filter="url(#st-halo)" />}
            <polygon points={pts([P(ox - 0.065, -0.4, ph + 27.6), P(ox + 0.385, -0.4, ph + 27.6), P(ox + 0.385, -0.4, ph + 48.4), P(ox - 0.065, -0.4, ph + 48.4)])} fill={busy ? 'rgba(108,92,231,0.14)' : GLASS_IDLE} />
            <clipPath id={`st-hubclip${ox < 0 ? 'a' : 'b'}`}><polygon points={pts(scr)} /></clipPath>
            <g clipPath={`url(#st-hubclip${ox < 0 ? 'a' : 'b'})`}>
              <g className={busy ? 'cth-st-scroll' : undefined}>
                {(busy ? [0, 1, 2, 3, 4, 5] : [0, 1]).map((i) => {
                  const zz = ph + 42 - i * 5;
                  const [p1, p2] = [P(ox + 0.01, -0.4, zz), P(ox + 0.24 - (i % 3) * 0.08, -0.4, zz)];
                  return <line key={i} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke="#6C5CE7" strokeWidth={1.5} strokeLinecap="round" opacity={0.8} />;
                })}
              </g>
            </g>
          </g>
        );
      })}
      <polygon points={pts([P(-0.2, -0.16, ph + 22.3), P(0.2, -0.16, ph + 22.3), P(0.2, -0.04, ph + 22.3), P(-0.2, -0.04, ph + 22.3)])} fill={T.kb} stroke={T.kbBd} strokeWidth={0.8} />
      <DeskProp at={P(-0.48, -0.06, ph + 22)} size={14}>{PROP_ART.michael}</DeskProp>
      <Box gx={0.36} gy={-0.2} w={0.2} d={0.16} h={3} z0={ph + 22} top={T.tray[0]} left={T.tray[1]} right={T.tray[2]} rim={false} T={T} />
      <Box gx={0.38} gy={-0.18} w={0.16} d={0.12} h={2} z0={ph + 25} top={T.tray2[0]} left={T.tray2[1]} right={T.tray2[2]} rim={false} T={T} />
      <Box gx={-0.03} gy={0.28} w={0.06} d={0.06} h={12} z0={ph} top={T.metal[0]} left={T.metal[1]} right={T.metal[2]} rim={false} T={T} />
      <Box gx={-0.2} gy={0.18} w={0.4} d={0.34} h={4} z0={ph + 10} top={T.hseat[0]} left={T.hseat[1]} right={T.hseat[2]} T={T} />
      <Box gx={-0.2} gy={0.46} w={0.4} d={0.07} h={20} z0={ph + 14} top={T.hback[0]} left={T.hback[1]} right={T.hback[2]} T={T} />
      <polygon points={pts([P(-a, a, z0), P(a, a, z0), P(a, a, z1), P(-a, a, z1)])} fill="url(#st-glassF)" />
      <polygon points={pts([P(a, -a, z0), P(a, a, z0), P(a, a, z1), P(a, -a, z1)])} fill="url(#st-glassF)" />
      {[[-0.7, -0.45], [-0.3, -0.2]].map(([g0, g1]) => (
        <polygon key={g0} points={pts([P(g0, a, z0 + 6), P(g1, a, z0 + 6), P(g1 + 0.25, a, z1 - 6), P(g0 + 0.25, a, z1 - 6)])} fill="#FFFFFF" opacity={T.reflOp[0]} />
      ))}
      <polygon points={pts([P(a, 0.2, z0 + 6), P(a, 0.38, z0 + 6), P(a, 0.13, z1 - 6), P(a, -0.05, z1 - 6)])} fill="#FFFFFF" opacity={T.reflOp[1]} />
      <NamePlate at={P(...plateAt(name))} name={name} busy={busy} lit={plateLit} T={T} dark={dark} />
      <polyline points={pts([P(-a, a, z1), P(a, a, z1), P(a, -a, z1)])} fill="none" stroke={T.wall} strokeWidth={1.8} />
      <line x1={P(a, a, z0)[0]} y1={P(a, a, z0)[1]} x2={P(a, a, z1)[0]} y2={P(a, a, z1)[1]} stroke={T.wall} strokeWidth={1.6} />
      <line x1={P(-0.25, a, z0)[0]} y1={P(-0.25, a, z0)[1]} x2={P(0.25, a, z0)[0]} y2={P(0.25, a, z0)[1]} stroke="#7C6CF2" strokeOpacity={0.5} strokeWidth={2} strokeLinecap="round" />
    </g>
  );
}

/** The office clock on Michael's back wall, showing the real time. It rings
 *  when a scheduled job starts. Drawn in the wall's plane (a 0.5 shear). */
function WallClock({ at: [x, y], ringing, T, plane = 'right' }: { at: Pt; ringing: boolean; T: SceneTokens; plane?: 'left' | 'right' }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const m = now.getMinutes();
  const h = (now.getHours() % 12) + m / 60;
  const hand = (deg: number, len: number) => `M0,0 L${(Math.sin((deg * Math.PI) / 180) * len).toFixed(2)},${(-Math.cos((deg * Math.PI) / 180) * len).toFixed(2)}`;
  return (
    <g transform={`matrix(1,${plane === 'left' ? -0.5 : 0.5},0,1,${x},${y})`}>
      <g className={ringing ? 'cth-st-shake' : undefined}>
        {ringing && [0, 1].map((i) => (
          <circle key={i} r={13} fill="none" stroke={T.amber} strokeWidth={1.6} className="cth-st-ringout" style={{ animationDelay: `${i * 0.35}s` }} />
        ))}
        <circle r={12} fill={T.tokBg} stroke={ringing ? T.amber : T.req} strokeOpacity={ringing ? 1 : 0.55} strokeWidth={1.8} />
        {[0, 90, 180, 270].map((d) => <path key={d} d={hand(d, 10).replace('M0,0 L', `M${(Math.sin((d * Math.PI) / 180) * 8).toFixed(2)},${(-Math.cos((d * Math.PI) / 180) * 8).toFixed(2)} L`)} stroke={T.stem} strokeWidth={1.2} />)}
        <path d={hand(h * 30, 5.5)} stroke={T.req} strokeWidth={1.9} strokeLinecap="round" />
        <path d={hand(m * 6, 8.5)} stroke={T.req} strokeWidth={1.3} strokeLinecap="round" />
        <circle r={1.2} fill={T.req} />
      </g>
    </g>
  );
}

/** Michael's numbers as a lit sign on his right glass wall, above his
 *  monitors: jobs he handed out today, things waiting on the owner (coral), and
 *  jobs he kept, with his context gauge along the bottom. Numbers tick when
 *  they change. Drawn in the wall's plane (a 0.5 shear). */
function StatsSign({ at: [x, y], stats, T, dark }: { at: Pt; stats: { delegated: number; toYou: number; kept: number; ctx: number | null }; T: SceneTokens; dark: boolean }) {
  const W = 80; const H = 17;
  const bg = dark ? '#0F0E17' : '#1E1B2E';
  const items: [string, number, string][] = [
    // arrow out of a box: handed out
    ['M2,7 L7,2 M4,2 H7 V5 M1,3 V8 H6', stats.delegated, '#C9C3FF'],
    // a bell: waiting on the owner
    ['M2,6 Q2,2 4.5,2 Q7,2 7,6 L8,7 H1 Z M3.6,8 H5.4', stats.toYou, stats.toYou > 0 ? '#FF8C90' : '#C9C3FF'],
    // a pin: kept for himself
    ['M4.5,1 L7,3.5 L5.5,4 L4,6.5 L2.5,5 L5,3.5 Z M3,6 L1,8', stats.kept, '#C9C3FF']
  ];
  return (
    <g transform={`matrix(1,0.5,0,1,${x.toFixed(1)},${y.toFixed(1)})`}>
      <rect x={0} y={0} width={W} height={H} rx={3} fill={bg} />
      <rect x={0} y={0} width={W} height={H} rx={3} fill="none" stroke={T.req} strokeOpacity={0.6} strokeWidth={0.8} />
      {items.map(([d, n, col], i) => (
        <g key={i} transform={`translate(${4 + i * 25.5},3)`}>
          <path d={d} fill="none" stroke={col} strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" />
          <text key={n} className="cth-st-tick" x={11} y={8.5} fontFamily="IBM Plex Mono, monospace" fontWeight={600} fontSize={10} fill={col}>{n}</text>
        </g>
      ))}
      {stats.ctx !== null && (
        <>
          <rect x={4} y={H - 3} width={W - 8} height={1.4} rx={0.7} fill="#FFFFFF" opacity={0.15} />
          <rect x={4} y={H - 3} width={(W - 8) * Math.min(1, stats.ctx / 100)} height={1.4} rx={0.7} fill={stats.ctx >= 85 ? '#FF8C90' : stats.ctx >= 65 ? '#F2B45A' : '#9D90FF'} />
        </>
      )}
    </g>
  );
}

/** The name as the plate shows it: long names are shortened to fit the glass. */
export function plateName(name: string): string { return cutText(name, 12); }
/** The plate's width in stage px, sized to the glass (owner, 2026-09-30: the
 *  first plate was too big for the wall and ran onto the next one). */
export function plateWidth(name: string): number { return Math.round(16 + plateName(name).length * 4.7); }
/** Where Michael's name plate sits (grid x, y, height): on the front glass,
 *  right of his door, ending before the corner however long the name. The
 *  stage puts its hover target here too. */
export function plateAt(name: string): [number, number, number] {
  return [Math.min(0.6, 0.97 - plateWidth(name) / 100), 1.06, 44];
}

/** The name plate on the glass beside Michael's door, in the glass's plane:
 *  ink plate, his name in white, and a status light that glows while he works. */
function NamePlate({ at: [x, y], name, busy, lit, T, dark }: { at: Pt; name: string; busy: boolean; lit: boolean; T: SceneTokens; dark: boolean }) {
  const w = plateWidth(name);
  return (
    <g transform={`matrix(1,0.5,0,1,${x.toFixed(1)},${y.toFixed(1)})`}>
      {lit && <rect x={-w / 2 - 2.5} y={-8.5} width={w + 5} height={17} rx={5} fill={T.indigo} opacity={0.22} />}
      <rect x={-w / 2} y={-6} width={w} height={12} rx={2.5} fill={dark ? '#0F0E17' : T.mbg} />
      <rect x={-w / 2} y={-6} width={w} height={12} rx={2.5} fill="none" stroke={lit ? T.indigo : T.req} strokeOpacity={lit ? 1 : 0.55} strokeWidth={lit ? 1.2 : 0.7} />
      <circle cx={-w / 2 + 5.5} cy={0} r={1.8} fill={busy ? '#7CF0B4' : '#8A86A3'} className={busy ? 'cth-st-breathe' : undefined} />
      <text x={-w / 2 + 10} y={2.9} fontFamily="Sora, sans-serif" fontWeight={600} fontSize={8} fill="#FFFFFF">{plateName(name)}</text>
    </g>
  );
}

/* ── Mailbox post ─────────────────────────────────────────────────────────── */

export function MailPost({ gx, gy, broken, c, T, active }: {
  gx: number; gy: number; broken: boolean; c: Family | null; T: SceneTokens;
  /** Mail moving right now: in (being read) or out (being sent). */
  active?: 'in' | 'out';
}) {
  const [top, left, right] = broken || !c ? T.bill : [c.m, T.boxFront, c.d];
  const acc = broken || !c ? T.coral : c.acc;
  const [sa, sb] = [P(gx - 0.16, gy + 0.2, 43), P(gx + 0.16, gy + 0.2, 43)];
  const [wx, wy] = P(gx, gy, 78);
  return (
    <g>
      <EllipseAt gx={gx} gy={gy} z={0} r={0.36} fill={T.papSh} opacity={0.1} />
      <Box gx={gx - 0.24} gy={gy - 0.24} w={0.48} d={0.48} h={4} z0={0} top={T.postB[0]} left={T.postB[1]} right={T.postB[2]} T={T} />
      <Box gx={gx - 0.06} gy={gy - 0.06} w={0.12} d={0.12} h={26} z0={4} top={T.postP[0]} left={T.postP[1]} right={T.postP[2]} rim={false} T={T} />
      <g className={active ? 'cth-st-hop' : undefined}>
        <Box gx={gx - 0.27} gy={gy - 0.2} w={0.54} d={0.4} h={20} z0={30} top={top} left={left} right={right} T={T} />
        <Poly ps={[P(gx - 0.27, gy + 0.2, 30), P(gx + 0.27, gy + 0.2, 30), P(gx + 0.27, gy + 0.2, 34), P(gx - 0.27, gy + 0.2, 34)]} fill={acc} opacity={0.85} />
        <line x1={sa[0]} y1={sa[1]} x2={sb[0]} y2={sb[1]} stroke={active ? acc : T.slot} strokeWidth={2.4} strokeLinecap="round" />
        {!broken && (
          <polygon points={pts([P(gx - 0.1, gy + 0.2, 43), P(gx + 0.1, gy + 0.2, 43), P(gx + 0.1, gy + 0.2, 50), P(gx - 0.1, gy + 0.2, 50)])} fill={T.env} stroke={acc} strokeWidth={1} />
        )}
        {/* The flag: raised while mail moves. */}
        <g className={active ? 'cth-st-flag' : undefined}>
          <polygon points={pts([P(gx + 0.27, gy - 0.05, 40), P(gx + 0.27, gy + 0.08, 40), P(gx + 0.27, gy + 0.08, 58), P(gx + 0.27, gy - 0.05, 58)])} fill={acc} />
        </g>
      </g>
      {broken && (
        <g className="cth-st-blink">
          <line x1={wx} y1={wy + 10} x2={wx} y2={wy + 18} stroke={T.coral} strokeWidth={1.5} />
          <path d={`M${wx},${wy - 9} L${wx + 9.5},${wy + 7} L${wx - 9.5},${wy + 7} Z`} fill={T.coral} stroke={T.coral} strokeWidth={2} strokeLinejoin="round" />
          <text x={wx} y={wy + 5.5} textAnchor="middle" fontFamily="Sora, sans-serif" fontWeight={700} fontSize={10} fill="#fff">!</text>
        </g>
      )}
    </g>
  );
}

/* ── Paths on the floor ───────────────────────────────────────────────────── */

export function Flow({ a, b, bend, color, width, opacity = 0.55, dash, T, flowing = false, fade = false }: {
  a: Pt; b: Pt; bend: number; color: string; width: number; opacity?: number; dash?: string; T: SceneTokens;
  /** Work is moving along this wire: dashes run from a toward b. */
  flowing?: boolean;
  /** A wire that is only there for a moment: it fades in, and out at the end. */
  fade?: boolean;
}) {
  const sh = dpath(curvePts(a, b, bend, 0));
  const ln = dpath(curvePts(a, b, bend, 5));
  return (
    <g className={fade ? 'cth-st-wire' : undefined}>
      <path d={sh} fill="none" stroke={T.flowSh} strokeOpacity={T.flowShOp} strokeWidth={width + 3} strokeLinecap="round" strokeDasharray={dash} />
      <path d={ln} fill="none" stroke={T.under} strokeOpacity={T.underOp} strokeWidth={width + 3} strokeLinecap="round" strokeDasharray={dash} />
      <path d={ln} fill="none" stroke={color} strokeOpacity={opacity} strokeWidth={width} strokeLinecap="round" strokeDasharray={dash} />
      {flowing && <path d={ln} fill="none" stroke={color} strokeOpacity={0.9} strokeWidth={width} strokeLinecap="round" strokeDasharray="3 13" className="cth-st-flow" />}
    </g>
  );
}
