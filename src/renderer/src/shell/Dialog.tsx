import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useDialog } from './useDialog';
import { useBackdropClose } from '@/hooks/useBackdropClose';

/**
 * The v2 dialog frame (branding/DESIGN.md 7.23): a card on the backdrop, its
 * title and close in a header row, an optional footer for the actions. Esc,
 * the focus trap and focus restore come from useDialog. The backdrop closes it
 * only when both the press and the click land on it, so a text selection that
 * ends past the edge never does (useBackdropClose). While `busy`, nothing
 * closes it (backdrop, Esc and the close button all wait).
 *
 * Rendered into document.body (owner, 2026-10-02: Edit agent's Save changes
 * was cut off): opened from a panel, an ancestor with a transform or an
 * animation holding one becomes the containing block for `position: fixed`,
 * so the dialog sized to the panel and its overflow clipped the footer.
 */
export function Dialog({ title, onClose, busy = false, width = 520, footer, children, bodyStyle, zIndex = 300, closable = true, fill = false, align = 'center', over, actions, below = false, dim = true, label }: {
  title: ReactNode;
  onClose: () => void;
  busy?: boolean;
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
  bodyStyle?: CSSProperties;
  zIndex?: number;
  /** False for a dialog that must be answered (no close button, no Esc, no backdrop click). */
  closable?: boolean;
  /** Take the window's full height (less the backdrop's padding) instead of
   *  sizing to the content, for a dialog built around a long text box. */
  fill?: boolean;
  /** 'end' sits the dialog on the right edge (left in RTL), over the panel it
   *  edits, instead of in the middle of the window. */
  align?: 'center' | 'end';
  /** Lay the dialog exactly over this element (its box, kept in step as it
   *  resizes), like a sheet on the panel it edits. A stable function; when it
   *  finds nothing, `width`, `fill` and `align` apply. */
  over?: () => HTMLElement | null;
  /** Buttons in the header, before close (Edit agent's open wide). */
  actions?: ReactNode;
  /** The backdrop starts under the 56 px top bar, so the Needs you pill stays
   *  live, and a click on it never closes the dialog (wide panel WD4, WD8). */
  below?: boolean;
  /** False when something under it already dims the window (the wide panel). */
  dim?: boolean;
  /** The screen reader name when `title` is not plain text. */
  label?: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);
  const close = () => { if (!busy && closable) onClose(); };
  useDialog(ref, close);
  const backdrop = useBackdropClose(close);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = over?.();
    if (!el) { setBox(null); return; }
    const measure = (): void => {
      const r = el.getBoundingClientRect();
      setBox((b) => (b && b.left === r.left && b.top === r.top && b.width === r.width && b.height === r.height)
        ? b : { left: r.left, top: r.top, width: r.width, height: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // The panel moving to or from the center animates a transform, which
    // neither observer sees: follow it frame by frame while it moves.
    let frame = 0;
    let until = 0;
    const follow = (): void => { measure(); frame = performance.now() < until ? requestAnimationFrame(follow) : 0; };
    const onMove = (e: Event): void => {
      until = performance.now() + ((e as CustomEvent<{ ms?: number }>).detail?.ms ?? 0) + 60;
      if (!frame) frame = requestAnimationFrame(follow);
    };
    window.addEventListener('resize', measure);
    window.addEventListener(PANEL_MOVE_EVENT, onMove);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener(PANEL_MOVE_EVENT, onMove);
    };
  }, [over]);
  return createPortal((
    <div {...(below ? {} : backdrop)} style={{
      position: 'fixed', inset: below ? '56px 0 0 0' : 0, zIndex, background: dim ? 'var(--cth-backdrop)' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: align === 'end' ? 'flex-end' : 'center', padding: 16
    }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === 'string' ? title : undefined)}
        tabIndex={-1}
        style={{
          ...(box
            ? { position: 'fixed', left: box.left, top: box.top, width: box.width, height: box.height }
            : { width, maxWidth: '100%', maxHeight: fill ? 'calc(100vh - 32px)' : '88vh', ...(fill ? { height: 'calc(100vh - 32px)' } : {}) }),
          display: 'flex', flexDirection: 'column', overflow: 'hidden', outline: 'none',
          background: 'var(--cth-card)', borderRadius: box ? 'var(--cth-r-xl)' : 'var(--cth-r-2xl)',
          boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-lg)',
          fontFamily: 'var(--cth-font-ui)', color: 'var(--cth-ink)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px 14px 22px', borderBottom: '1px solid var(--cth-line)', flexShrink: 0 }}>
          <h2 style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--cth-ink)' }}>{title}</h2>
          {actions}
          {closable && (
            <CloseButton onClose={close} busy={busy} label={t('common.close')} />
          )}
        </div>
        <div style={{ padding: '18px 22px', overflowY: 'auto', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 14, ...bodyStyle }}>
          {children}
        </div>
        {footer && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, padding: '12px 18px', borderTop: '1px solid var(--cth-line)', flexShrink: 0, background: 'var(--cth-card-2)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  ), document.body);
}

/** Sent on window when the right column starts moving between the side and
 *  the center; `detail.ms` is how long the move takes (App.tsx). */
export const PANEL_MOVE_EVENT = 'cth:panel-move';
/** How long that move takes: --cth-dur-slow in tokens.css (keep the two equal). */
export const PANEL_MOVE_MS = 320;

/** Extracted so it can hold its own hover state without polluting Dialog. */
function CloseButton({ onClose, busy, label }: { onClose: () => void; busy: boolean; label: string }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClose}
      disabled={busy}
      aria-label={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...closeBtn,
        background: hover && !busy ? 'var(--cth-neutral-soft)' : 'var(--cth-card)',
        color: hover && !busy ? 'var(--cth-ink)' : 'var(--cth-ink-2)',
        transition: 'background var(--cth-dur-fast) var(--cth-ease), color var(--cth-dur-fast) var(--cth-ease)'
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  );
}

const closeBtn: CSSProperties = {
  width: 30, height: 30, display: 'grid', placeItems: 'center', border: 'none', cursor: 'pointer', borderRadius: 'var(--cth-r-md)',
  background: 'var(--cth-card)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)', color: 'var(--cth-ink-2)', flexShrink: 0
};
