import type { ReactNode } from 'react';

/**
 * The office opening's card (DESIGN.md 7.24, design review 2026-10-18): the one
 * colored card on the floor, so it is never read as another name chip. Indigo
 * while people clock in, green for "Everyone's in", amber when the cap ends it
 * with someone out. Michael's own start and the team's opening share it.
 * The floor stays clickable under it.
 */
export type OpeningTone = 'indigo' | 'green' | 'amber';

const TONE: Record<OpeningTone, { ring: string; fill: string; soft: string }> = {
  indigo: { ring: 'var(--cth-indigo)', fill: 'var(--cth-indigo-soft)', soft: 'color-mix(in srgb, var(--cth-indigo) 20%, transparent)' },
  green: { ring: 'var(--cth-green)', fill: 'var(--cth-green-soft)', soft: 'color-mix(in srgb, var(--cth-green) 20%, transparent)' },
  amber: { ring: 'var(--cth-amber)', fill: 'var(--cth-amber-soft)', soft: 'color-mix(in srgb, var(--cth-amber) 20%, transparent)' }
};

export interface OpeningCardProps {
  tone: OpeningTone;
  /** Indigo pulses while people are arriving; the end states hold still. */
  pulse?: boolean;
  /** A check in place of the dot ("Everyone's in"). */
  check?: boolean;
  title: string;
  /** Mono count at the end of the title row. */
  count?: string;
  /** The bar: how many are in out of everyone. */
  progress?: { value: number; max: number; label: string };
  line?: ReactNode;
  /** What a screen reader hears. Set once per state, never on each count
   *  change, so it does not talk over the opening (design review 7A). */
  say: string;
  /** End states fade out on their own after this long (CSS, so no timer). */
  fadeAfterMs?: number;
}

export function OpeningCard({ tone, pulse, check, title, count, progress, line, say, fadeAfterMs }: OpeningCardProps) {
  const c = TONE[tone];
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div className="cth-opening-card" data-tone={tone} style={{
        width: 'min(300px, calc(100% - 32px))', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10,
        padding: '14px 16px', borderRadius: 'var(--cth-r-xl)', background: c.fill,
        boxShadow: `inset 0 0 0 1.5px ${c.ring}, var(--cth-shadow-lg)`, fontFamily: 'var(--cth-font-ui)',
        transition: 'background-color 300ms var(--cth-ease), box-shadow 300ms var(--cth-ease)',
        animation: fadeAfterMs !== undefined ? `cth-opening-out 300ms var(--cth-ease) ${fadeAfterMs}ms forwards` : undefined
      }}>
        <div role="status" aria-live="polite" className="cth-sr-only">{say}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {check ? (
            <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, background: c.ring, color: 'var(--cth-on-green)', display: 'grid', placeItems: 'center' }}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
          ) : (
            <span aria-hidden="true" style={{
              width: 12, height: 12, borderRadius: '50%', flexShrink: 0, background: c.ring,
              boxShadow: `0 0 0 5px ${c.soft}`, animation: pulse ? 'cth-pulse 1.6s ease-in-out infinite' : undefined
            }} />
          )}
          <div style={{ fontSize: 20, lineHeight: '26px', fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--cth-ink)', minWidth: 0 }}>{title}</div>
          {count && <div style={{ marginInlineStart: 'auto', flexShrink: 0, fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-2)', fontFamily: 'var(--cth-font-mono)' }}>{count}</div>}
        </div>
        {progress && (
          <div role="progressbar" aria-label={progress.label} aria-valuemin={0} aria-valuemax={progress.max} aria-valuenow={progress.value}
            style={{ height: 4, borderRadius: 2, background: c.soft, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress.max ? (100 * progress.value) / progress.max : 0}%`, background: c.ring, borderRadius: 2, transition: 'width 400ms var(--cth-ease)' }} />
          </div>
        )}
        {line && <div style={{ fontSize: 12, lineHeight: '16.5px', color: 'var(--cth-ink-2)', overflowWrap: 'anywhere' }}>{line}</div>}
      </div>
    </div>
  );
}
