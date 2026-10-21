import { useId, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { useRtl } from '@/i18n/useDirection';
import { TRIGGER_MODES, type TriggerMode } from '@shared/triggers';
import { MAX_INTERVAL_MS } from '@shared/missions';
import {
  WEEKDAY_INITIALS, WEEKDAY_LABELS, formatMinute, normalizeWeekly,
  type WeeklySchedule
} from '@shared/weeklySchedule';

/**
 * Shared chrome for the Triggers tab.
 *
 * The Command Center's own `Section`/`Scroll`/`Muted` are module-private to
 * `CommandCenterPanel.tsx`, so these mirror them exactly (same paddings, same
 * fonts, same `inset` hairlines) and add the collapse behaviour this tab needs —
 * four types of dense config do not fit down a sidebar as flat forms.
 */

/* ───────────────────────────── shared styles ─────────────────────────────── */

// Design v2 controls (branding/DESIGN.md 6, 7.12): white fields on a line-input
// boundary (3:1), 9px radius, Sora.
export const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '7px 10px',
  background: 'var(--cth-card)', border: 'none', borderRadius: 'var(--cth-r-md)',
  boxShadow: 'inset 0 0 0 1px var(--cth-line-input)',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12.5, lineHeight: '17px',
  color: 'var(--cth-ink)'
};

export const monoInputStyle: CSSProperties = {
  ...inputStyle,
  fontFamily: 'var(--cth-font-mono)'
};

export const textareaStyle: CSSProperties = {
  ...monoInputStyle,
  resize: 'vertical'
};

export const selectStyle: CSSProperties = {
  height: 32, padding: '0 10px', background: 'var(--cth-card)', border: 'none', borderRadius: 'var(--cth-r-md)',
  boxShadow: 'inset 0 0 0 1px var(--cth-line-input)',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12.5, color: 'var(--cth-ink)',
  cursor: 'pointer', minWidth: 0, maxWidth: '100%'
};

/* ───────────────────────────── text helpers ──────────────────────────────── */

export function Muted({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-3)' }}>{children}</div>;
}

/** One line of explanation under a control. Smaller than Muted, never a tooltip —
 *  a sidebar hides tooltips behind the window edge half the time. */
export function Hint({ children }: { children: ReactNode }) {
  // 13px: the floor for text an owner reads (DESIGN.md §4.2).
  return <div style={{ fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-3)', marginTop: 3 }}>{children}</div>;
}

export function Chip({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'on' | 'off' }) {
  const bg = tone === 'on' ? 'var(--cth-green-soft)' : 'var(--cth-neutral-soft)';
  const fg = tone === 'on' ? 'var(--cth-green-text)' : 'var(--cth-ink-3)';
  return (
    <span style={{
      flexShrink: 0, padding: '2px 8px', borderRadius: 'var(--cth-r-pill)',
      fontFamily: 'var(--cth-font-ui)', fontSize: 10.5, fontWeight: 600, lineHeight: '15px',
      background: bg, color: fg
    }}>{children}</span>
  );
}

export function Callout({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'note' }) {
  const warn = tone === 'warn';
  return (
    <div style={{
      marginTop: 6, padding: '8px 10px', borderRadius: 'var(--cth-r-md)',
      fontSize: 12.5, lineHeight: '18px', color: warn ? 'var(--cth-coral-text)' : 'var(--cth-ink-2)',
      background: warn ? 'var(--cth-coral-soft)' : 'var(--cth-neutral-soft)'
    }}>{children}</div>
  );
}

/* ─────────────────────────────── controls ────────────────────────────────── */

/** An on/off switch. `role="switch"` + `aria-checked` so a screen reader hears
 *  "Run Triage the inbox, on" rather than a bare button (design 12A); `label`
 *  names what it switches. `disabled` means busy. `unavailable` means it cannot
 *  be used yet: it keeps the owner's position, greyed, stays focusable and
 *  speaks `reason` (Pulse Compare, design D4, 2026-10-16). */
export function Toggle({ on, onClick, onLabel, offLabel, label, disabled, unavailable, reason }: {
  on: boolean; onClick: () => void; onLabel?: string; offLabel?: string; label?: string; disabled?: boolean; unavailable?: boolean; reason?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={disabled || undefined}
      aria-disabled={unavailable || undefined}
      aria-description={unavailable ? reason : undefined}
      disabled={disabled}
      onClick={unavailable ? undefined : onClick}
      style={{
        // v2 switch (branding/DESIGN.md 7.12): the word, then a pill track.
        display: 'inline-flex', alignItems: 'center', gap: 8, padding: 0, border: 'none', background: 'transparent',
        cursor: disabled ? 'progress' : unavailable ? 'default' : 'pointer', flexShrink: 0, opacity: disabled ? 0.6 : unavailable ? 0.5 : 1,
        fontFamily: 'var(--cth-font-ui)', fontSize: 12, fontWeight: 600, lineHeight: '18px',
        color: on ? 'var(--cth-green-text)' : 'var(--cth-ink-3)'
      }}
    >
      {on ? (onLabel ?? t('common.on')) : (offLabel ?? t('common.off'))}
      <span aria-hidden="true" style={{
        position: 'relative', width: 32, height: 18, borderRadius: 999, flexShrink: 0,
        background: on ? 'var(--cth-green)' : 'var(--cth-neutral-soft)',
        boxShadow: on ? 'none' : 'inset 0 0 0 1px var(--cth-line-input)', transition: 'background var(--cth-dur-fast) var(--cth-ease)'
      }}>
        <span style={{
          position: 'absolute', top: 2, insetInlineStart: on ? 16 : 2, width: 14, height: 14, borderRadius: '50%',
          background: '#FFFFFF', boxShadow: '0 1px 2px rgba(30,27,46,.25)', transition: 'inset-inline-start var(--cth-dur-fast) var(--cth-ease)'
        }} />
      </span>
    </button>
  );
}

/** `destructive` is the DESIGN.md 7.2 variant (coral fill, on-accent text): the
 *  committing step of a delete, never the first click (design 11A). */
export function MiniButton({ children, onClick, tone = 'plain', disabled, autoFocus, buttonRef, label }: {
  children: ReactNode; onClick: () => void; tone?: 'plain' | 'danger' | 'good' | 'destructive'; disabled?: boolean;
  autoFocus?: boolean; buttonRef?: Ref<HTMLButtonElement>;
  /** A spoken name when the visible word is not enough ("Remove example.com"). */
  label?: string;
}) {
  const destructive = tone === 'destructive';
  return (
    <button
      type="button"
      ref={buttonRef}
      aria-label={label}
      autoFocus={autoFocus}
      onClick={onClick}
      disabled={disabled}
      style={{
        flexShrink: 0, height: 26, padding: '0 10px', border: 'none', borderRadius: 'var(--cth-r-md)',
        cursor: disabled ? 'default' : 'pointer',
        background: tone === 'good' ? 'var(--cth-green-soft)' : destructive ? 'var(--cth-coral-strong)' : 'var(--cth-card)',
        boxShadow: destructive || tone === 'good' ? 'none' : 'inset 0 0 0 1px var(--cth-line-2)',
        fontFamily: 'var(--cth-font-ui)', fontSize: 12, fontWeight: 600,
        color: disabled ? 'var(--cth-ink-4)' : destructive ? 'var(--cth-on-coral)' : tone === 'danger' ? 'var(--cth-coral-text)' : tone === 'good' ? 'var(--cth-green-text)' : 'var(--cth-ink)'
      }}
    >{children}</button>
  );
}

export function Select({ value, onChange, children, style, label }: {
  value: string; onChange: (v: string) => void; children: ReactNode; style?: CSSProperties; label?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...selectStyle, ...style }}
    >{children}</select>
  );
}

/** Label above a control. Stacked, never side-by-side — the sidebar is too
 *  narrow for a label column that does not truncate the thing it labels. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{
        fontFamily: 'var(--cth-font-ui)', fontSize: 10, fontWeight: 600, lineHeight: '13px', textTransform: 'uppercase',
        letterSpacing: '0.05em', color: 'var(--cth-ink-3)', marginBottom: 5
      }}>{label}</div>
      {children}
    </div>
  );
}

/* ───────────────────────────── containers ───────────────────────────────── */

export function Scroll({ children }: { children: ReactNode }) {
  return (
    <div style={{
      flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
      padding: 14
    }}>{children}</div>
  );
}

/**
 * One of the four trigger types. Collapsed it is a title, a one-line "what this
 * is", and a live summary — so opening the tab reads as four kinds of trigger
 * rather than a wall of forms.
 *
 * Children stay MOUNTED while collapsed (hidden, not unmounted) for two reasons:
 * the summary chip is fed by the section itself and would go blank the moment
 * you closed it, and a section's own open rows survive collapsing its parent.
 */
/** The one open/closed sign for every section and row that folds (owner,
 *  2026-09-26: a row with no sign could not be found). Readable size and dark
 *  ink; points toward the text in right-to-left. */
export function Disclosure({ open }: { open: boolean }) {
  const rtl = useRtl();
  return (
    <span aria-hidden="true" style={{ flexShrink: 0, width: 16, height: 20, display: 'inline-grid', placeItems: 'center', color: 'var(--cth-ink-3)' }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
        style={{ transform: `rotate(${open ? 0 : rtl ? 90 : -90}deg)`, transition: 'transform var(--cth-dur-fast) var(--cth-ease)' }}>
        <path d="M6 9l6 6 6-6" />
      </svg>
    </span>
  );
}

export function TriggerCard({ title, blurb, summary, action, defaultOpen = false, open: openProp, onToggle, children }: {
  title: string; blurb: string; summary?: ReactNode;
  /** A control that sits in the header beside the fold button (not inside it),
   *  e.g. the section's own on/off switch. Replaces the summary chip. */
  action?: ReactNode; defaultOpen?: boolean;
  /** Controlled use: the parent owns open/closed (e.g. opens it when email turns on). */
  open?: boolean; onToggle?: (open: boolean) => void; children: ReactNode;
}) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const bodyId = useId();
  return (
    // v2 row group (branding/DESIGN.md 7.12): a white card, the title and one
    // quiet line of what it is, the section's own switch on the right.
    <div style={{ marginBottom: 10, background: 'var(--cth-card)', borderRadius: 'var(--cth-r-xl)', boxShadow: 'inset 0 0 0 1px var(--cth-line)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => { const next = !open; if (openProp === undefined) setOpenState(next); onToggle?.(next); }}
        style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 6, textAlign: 'start',
          padding: '11px 12px', border: 'none', cursor: 'pointer', background: 'transparent'
        }}
      >
        <Disclosure open={open} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'block', fontFamily: 'var(--cth-font-ui)', fontSize: 13, fontWeight: 600, lineHeight: '18px',
            color: 'var(--cth-ink)'
          }}>{title}</span>
          <span style={{ display: 'block', fontFamily: 'var(--cth-font-ui)', fontSize: 11.5, lineHeight: '16px', color: 'var(--cth-ink-3)', marginTop: 2 }}>
            {blurb}
          </span>
        </span>
        {summary !== undefined && action === undefined && <Chip>{summary}</Chip>}
      </button>
      {action !== undefined && <div style={{ flexShrink: 0, paddingBlockStart: 11, paddingInlineEnd: 12 }}>{action}</div>}
      </div>
      <div id={bodyId} style={{ display: open ? 'block' : 'none', padding: '10px 12px 12px', borderTop: '1px solid var(--cth-line)' }}>{children}</div>
    </div>
  );
}

/** A card inside a card — one webhook, one context rule. */
export function SubCard({ children }: { children: ReactNode }) {
  return (
    <div style={{
      marginBottom: 8, padding: '10px 12px', borderRadius: 'var(--cth-r-lg)',
      background: 'var(--cth-card-2)', boxShadow: 'inset 0 0 0 1px var(--cth-line)'
    }}>{children}</div>
  );
}

/** Header row inside a SubCard: a disclosure caret, a title, and controls. */
export function SubHeader({ open, onToggle, title, sub, right }: {
  open: boolean; onToggle: () => void; title: ReactNode; sub?: ReactNode; right?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        onClick={onToggle}
        style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left',
          padding: 0, border: 'none', background: 'transparent', cursor: 'pointer'
        }}
      >
        <Disclosure open={open} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'block', fontFamily: 'var(--cth-font-ui)', fontSize: 12, lineHeight: '16px',
            color: 'var(--cth-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>{title}</span>
          {sub !== undefined && (
            <span style={{
              display: 'block', fontSize: 11, lineHeight: '15px', color: 'var(--cth-ink-500)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}>{sub}</span>
          )}
        </span>
      </button>
      {right}
    </div>
  );
}

/* ──────────────────────────── trigger mode ───────────────────────────────── */

/** The shared `strict / allow-all / communication-only` gate. Labels and blurbs
 *  come from `TRIGGER_MODES` so webhooks and org can never drift apart. */
export function ModePicker({ value, onChange }: { value: TriggerMode; onChange: (m: TriggerMode) => void }) {
  const current = TRIGGER_MODES.find((m) => m.value === value) ?? TRIGGER_MODES[0];
  return (
    <>
      <Select value={value} onChange={(v) => onChange(v as TriggerMode)} style={{ width: '100%' }}>
        {TRIGGER_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </Select>
      <Hint>{current.blurb}</Hint>
    </>
  );
}

/* ──────────────────────────── interval picker ────────────────────────────── */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK = 604_800_000;

export const INTERVAL_OPTS: { ms: number; label: string }[] = [
  { ms: 15 * MINUTE, label: '15m' },
  { ms: 30 * MINUTE, label: '30m' },
  { ms: HOUR, label: '1h' },
  { ms: 2 * HOUR, label: '2h' },
  { ms: 4 * HOUR, label: '4h' },
  { ms: 6 * HOUR, label: '6h' },
  { ms: 12 * HOUR, label: '12h' },
  { ms: DAY, label: '24h' },
  { ms: WEEK, label: 'weekly' }
];

/** A truthful label for ANY stored interval, preset or not. Arbitrary intervals
 *  persist now, so the label is computed rather than looked up — a select that
 *  falls back to the nearest preset would quietly lie about the stored value. */
export function fmtInterval(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'off';
  if (ms === WEEK) return 'weekly';
  if (ms % WEEK === 0) return `${ms / WEEK}w`;
  if (ms % DAY === 0) return `${ms / DAY}d`;
  if (ms % HOUR === 0) return `${ms / HOUR}h`;
  if (ms % MINUTE === 0) return `${ms / MINUTE}m`;
  return `${Math.round(ms / 1000)}s`;
}

const CUSTOM = '__custom';

/**
 * @param minMs/maxMs the range MAIN will actually store. Context rules are
 * clamped to 1 minute … 24 hours on the way in, so offering "weekly" there would
 * put a label on screen that the saved value does not match. Schedules take any
 * interval and pass the default range.
 */
export function IntervalPicker({ value, onChange, minMs = MINUTE, maxMs = MAX_INTERVAL_MS }: {
  value: number; onChange: (ms: number) => void; minMs?: number; maxMs?: number;
}) {
  const { t } = useTranslation();
  const opts = INTERVAL_OPTS.filter((o) => o.ms >= minMs && o.ms <= maxMs);
  const preset = opts.some((o) => o.ms === value);
  const [custom, setCustom] = useState(!preset);
  const showCustom = custom || !preset;
  const clamp = (ms: number) => Math.min(maxMs, Math.max(minMs, ms));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <Select
        value={showCustom ? CUSTOM : String(value)}
        onChange={(v) => {
          if (v === CUSTOM) { setCustom(true); return; }
          setCustom(false);
          onChange(Number(v));
        }}
      >
        {!preset && <option value={CUSTOM}>{fmtInterval(value)} ({t('triggersUi.custom')})</option>}
        {opts.map((o) => <option key={o.ms} value={String(o.ms)}>{o.label}</option>)}
        {preset && <option value={CUSTOM}>{t('triggersUi.customEllipsis')}</option>}
      </Select>
      {showCustom && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input
            type="number"
            min={Math.max(1, Math.round(minMs / MINUTE))}
            max={Number.isFinite(maxMs) ? Math.round(maxMs / MINUTE) : undefined}
            value={Math.max(1, Math.round(value / MINUTE))}
            onChange={(e) => {
              const mins = Number(e.target.value);
              if (Number.isFinite(mins) && mins > 0) onChange(clamp(Math.round(mins) * MINUTE));
            }}
            style={{ ...monoInputStyle, width: 68, padding: '3px 5px' }}
          />
          <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>{t('triggersUi.min')}</span>
        </span>
      )}
    </div>
  );
}

/* ───────────────────────────── percent field ─────────────────────────────── */

export function PctField({ value, onChange }: { value: number; onChange: (pct: number) => void }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        type="number"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0);
        }}
        style={{ ...monoInputStyle, width: 60, padding: '3px 5px' }}
      />
      <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>%</span>
      <div style={{
        flex: 1, minWidth: 40, height: 6, borderRadius: 3, overflow: 'hidden',
        background: 'var(--cth-neutral-soft)'
      }}>
        <div style={{ width: `${pct}%`, height: '100%', background: pct === 0 ? 'var(--cth-ink-4)' : 'var(--cth-indigo)' }} />
      </div>
    </div>
  );
}

/* ────────────────────────────── secret field ─────────────────────────────── */

/** Masked by default; reveals only on demand. The value never lands in a
 *  `title`/tooltip — those leak into screenshots and accessibility trees. */
export function SecretField({ value, revealed, onReveal, onCopy, copied, placeholder, onChange, onBlur }: {
  value: string;
  revealed: boolean;
  onReveal: () => void;
  onCopy?: () => void;
  copied?: boolean;
  placeholder?: string;
  onChange?: (v: string) => void;
  onBlur?: () => void;
}) {
  const { t } = useTranslation();
  const readOnly = !onChange;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        type={revealed ? 'text' : 'password'}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        onBlur={onBlur}
        style={{ ...monoInputStyle, flex: 1, minWidth: 0, padding: '4px 6px' }}
      />
      <MiniButton onClick={onReveal}>{revealed ? t('common.hide') : t('common.show')}</MiniButton>
      {onCopy && <MiniButton onClick={onCopy} tone={copied ? 'good' : 'plain'}>{copied ? `${t('common.copy')} ✓` : t('common.copy')}</MiniButton>}
    </div>
  );
}

/* ──────────────────────────── weekly schedule ────────────────────────────── */

/** A weekly schedule the picker can hold mid-edit. Days may be empty while the
 *  user is deselecting, which `normalizeWeekly` would reject — so the draft type
 *  is looser than the stored one, and the SAVE is what has to be valid. */
export type WeeklyDraft = { days: number[]; minute: number };

export const DEFAULT_WEEKLY: WeeklyDraft = { days: [1, 2, 3, 4, 5], minute: 9 * 60 };

/** True when this draft is safe to store. The one gate every call site shares. */
export function weeklyIsUsable(w: WeeklyDraft): boolean {
  return normalizeWeekly(w) !== null;
}

/**
 * Day-of-week + time-of-day picker.
 *
 * Seven toggles rather than a multi-select, because picking "Mon Wed Fri" is the
 * whole job and a native multi-select makes it a modifier-key puzzle. The order
 * is Sunday-first to match `Date.getDay()`, so no index maths sits between what
 * is clicked and what is stored.
 */
export function WeeklyPicker({ value, onChange, taken = [] }: {
  value: WeeklyDraft; onChange: (w: WeeklyDraft) => void;
  /** Days another "when" line holds; they can't be picked here (WhenLines). */
  taken?: number[];
}) {
  const { t } = useTranslation();
  const toggle = (d: number) => {
    if (taken.includes(d) && !value.days.includes(d)) return;
    onChange({
      ...value,
      days: value.days.includes(d) ? value.days.filter((x) => x !== d) : [...value.days, d].sort((a, b) => a - b)
    });
  };
  const setDays = (days: number[]) => onChange({ ...value, days: days.filter((d) => !taken.includes(d)) });
  const same = (days: number[]) =>
    value.days.length === days.length && days.every((d) => value.days.includes(d));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {WEEKDAY_INITIALS.map((initial, d) => {
          const on = value.days.includes(d);
          const blocked = !on && taken.includes(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => toggle(d)}
              disabled={blocked}
              title={blocked ? t('triggersUi.dayTaken', { day: WEEKDAY_LABELS[d] }) : WEEKDAY_LABELS[d]}
              aria-pressed={on}
              style={{
                width: 30, height: 28, border: 'none', borderRadius: 'var(--cth-r-md)', cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.4 : 1,
                background: on ? 'var(--cth-ink)' : 'var(--cth-card)',
                boxShadow: on ? 'none' : 'inset 0 0 0 1px var(--cth-line-2)',
                fontFamily: 'var(--cth-font-ui)', fontSize: 11.5, fontWeight: 600,
                color: on ? 'var(--cth-bg)' : 'var(--cth-ink-2)'
              }}
            >{initial}</button>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>{t('triggersUi.at')}</span>
        {/* A native time field, so typing 0930 works and the value is already
            the HH:MM the schedule stores. Minute granularity, not 5-minute
            steps: "09:47 on Tuesdays" is a legitimate thing to want. */}
        <input
          type="time"
          value={formatMinute(value.minute)}
          onChange={(e) => {
            const [h, m] = e.target.value.split(':').map(Number);
            if (Number.isFinite(h) && Number.isFinite(m)) onChange({ ...value, minute: h * 60 + m });
          }}
          style={{ ...inputStyle, width: 108, padding: '3px 6px' }}
        />
        <span style={{ flex: 1 }} />
        <MiniButton onClick={() => setDays(same([1, 2, 3, 4, 5]) ? [] : [1, 2, 3, 4, 5])}>{t('triggersUi.weekdays')}</MiniButton>
        <MiniButton onClick={() => setDays(same([0, 1, 2, 3, 4, 5, 6]) ? [] : [0, 1, 2, 3, 4, 5, 6])}>{t('triggersUi.everyDay')}</MiniButton>
      </div>
      {value.days.length === 0 && <Hint>{t('triggersUi.pickDayHint')}</Hint>}
    </div>
  );
}

/**
 * The whole "when does this run" control: pick a repeating gap, or pick days and
 * a time. Both call sites (the new-schedule form and an expanded row) use this
 * so the two can never drift apart.
 *
 * `weekly === null` IS interval mode. Keeping the mode in the value rather than
 * in local state means a row that reloads from disk cannot show the wrong tab.
 */
export function SchedulePicker({ intervalMs, weekly, onInterval, onWeekly }: {
  intervalMs: number;
  weekly: WeeklyDraft | null;
  onInterval: (ms: number) => void;
  onWeekly: (w: WeeklyDraft | null) => void;
}) {
  const { t } = useTranslation();
  const tab = (active: boolean): CSSProperties => ({
    height: 28, padding: '0 12px', border: 'none', borderRadius: 'var(--cth-r-md)', cursor: 'pointer',
    background: active ? 'var(--cth-ink)' : 'var(--cth-card)',
    boxShadow: active ? 'none' : 'inset 0 0 0 1px var(--cth-line-2)',
    fontFamily: 'var(--cth-font-ui)', fontSize: 12, fontWeight: 600,
    color: active ? 'var(--cth-bg)' : 'var(--cth-ink-2)'
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <button type="button" style={tab(!weekly)} onClick={() => onWeekly(null)}>{t('triggersUi.every')}</button>
        <button type="button" style={tab(!!weekly)} onClick={() => onWeekly(weekly ?? DEFAULT_WEEKLY)}>{t('triggersUi.onDays')}</button>
      </div>
      {weekly
        ? <WeeklyPicker value={weekly} onChange={onWeekly} />
        : <IntervalPicker value={intervalMs} onChange={onInterval} />}
    </div>
  );
}

/** Narrow a stored mission's `weekly` to a draft, or null for interval mode.
 *  One place decides what "this mission is weekly" means. */
export function weeklyDraft(w: WeeklySchedule | { days: number[]; minute: number } | undefined): WeeklyDraft | null {
  const n = normalizeWeekly(w);
  return n ? { days: n.days, minute: n.minute } : null;
}
