import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { clipBoxOf, placeInfoTip } from './infoTipPlacement';

/**
 * An info icon that explains a field on hover or keyboard focus, so screens
 * show the fields and keep the explanations one step away (owner, 2026-09-27:
 * "one of the design goal every where should be make design less verbose").
 */
/** `align="end"` opens the bubble toward the start side, for an icon at the
 *  end of a row inside a clipping card (it would run off the card's edge).
 *  Either way, a bubble that would be cut off by its dialog or the window
 *  opens toward the side with room, above the icon if need be (#232). */
export function InfoTip({ text, label, align = 'start' }: { text: string; label?: string; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState({ inline: false, above: false });
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const id = useId();
  // Measured before paint, so a bubble that has to move never shows cut off first.
  useLayoutEffect(() => {
    const a = anchor.current;
    const b = tip.current;
    if (!open || !a || !b) return;
    const ltr = getComputedStyle(a).direction !== 'rtl';
    const opensRight = (align === 'start') === ltr;
    const place = placeInfoTip(a.getBoundingClientRect(), { width: b.offsetWidth, height: b.offsetHeight }, clipBoxOf(a), { opensRight });
    const next = { inline: place.opensRight !== opensRight, above: place.above };
    setFlip((f) => (f.inline === next.inline && f.above === next.above ? f : next));
  }, [open, text, align]);
  const toEnd = (align === 'end') !== flip.inline;
  return (
    <span
      ref={anchor}
      style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        data-infotip=""
        aria-label={label ?? text}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}
        // Inside a <label>, a click would otherwise focus the field.
        onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }}
        style={iconButton}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
          <circle cx="7.5" cy="7.5" r="6.5" fill="none" stroke="var(--cth-ink-4)" strokeWidth="1" />
          <circle cx="7.5" cy="4.6" r="0.9" fill="var(--cth-ink-3)" />
          <rect x="6.8" y="6.4" width="1.4" height="4.6" rx="0.7" fill="var(--cth-ink-3)" />
        </svg>
      </button>
      {open && (
        <span
          ref={tip} id={id} role="tooltip"
          style={{ ...bubble, ...(toEnd ? { insetInlineStart: 'auto', insetInlineEnd: -8 } : {}), ...(flip.above ? { top: 'auto', bottom: 'calc(100% + 6px)' } : {}) }}
        >{text}</span>
      )}
    </span>
  );
}

const iconButton: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 16, height: 16, padding: 0, border: 'none', background: 'transparent',
  borderRadius: '50%', cursor: 'help'
};

// v2 (branding/DESIGN.md 7.23): an ink tooltip, 260px max.
const bubble: CSSProperties = {
  position: 'absolute', top: 'calc(100% + 6px)', insetInlineStart: -8, zIndex: 20,
  width: 'max-content', maxWidth: 260, padding: '7px 10px',
  background: 'var(--cth-ink)', borderRadius: 'var(--cth-r-md)', boxShadow: 'var(--cth-shadow-md)',
  fontFamily: 'var(--cth-font-ui)', fontSize: 11.5, lineHeight: '16px', fontWeight: 400, letterSpacing: 0,
  color: 'var(--cth-bg)', textTransform: 'none', whiteSpace: 'normal', textAlign: 'start'
};
