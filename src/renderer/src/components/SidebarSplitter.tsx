import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

export interface SidebarSplitterProps {
  /** Current sidebar width in px. */
  width: number;
  /** Called with the new width (already clamped externally). */
  onChange: (px: number) => void;
  /** Containing viewport width — used to clamp delta to a sane max. */
  viewportWidth: number;
  min?: number;
  max?: number;
}

/**
 * Vertical drag handle. Sits between the floor canvas (left) and the sidebar
 * (right). Drag left → wider sidebar. Cursor + pixel-stripe affordance.
 */
export function SidebarSplitter({
  width, onChange, viewportWidth, min = 320, max = 1200
}: SidebarSplitterProps) {
  const { t } = useTranslation();
  const startRef = useRef<{ clientX: number; width: number } | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!startRef.current) return;
      const delta = startRef.current.clientX - e.clientX; // left drag = positive delta → grow sidebar
      const clampMax = Math.min(max, Math.max(min, viewportWidth - 360));
      const next = Math.min(clampMax, Math.max(min, startRef.current.width + delta));
      onChange(next);
    };
    const onUp = () => {
      startRef.current = null;
      setActive(false);
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    if (active) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'ew-resize';
    }
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [active, viewportWidth, min, max, onChange]);

  const clampMax = Math.min(max, Math.max(min, viewportWidth - 360));
  const KEY_STEP = 24;

  // Same direction as the drag: left makes the sidebar wider, right narrower.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const delta = e.key === 'ArrowLeft' ? KEY_STEP : -KEY_STEP;
    onChange(Math.min(clampMax, Math.max(min, width + delta)));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('sidebar.resizeLabel')}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={clampMax}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        startRef.current = { clientX: e.clientX, width };
        setActive(true);
        e.preventDefault();
      }}
      onDoubleClick={() => onChange(420)}
      title={t('sidebar.resizeTitle')}
      className="cth-splitter"
      style={{
        width: 10,
        cursor: 'ew-resize',
        flexShrink: 0,
        position: 'relative',
        zIndex: 61
      }}
    >
      {/* Invisible until hovered or dragged: a small rounded grip, no stripe
          (design v2; owner, 2026-09-30). */}
      <div className="cth-splitter-grip" style={{
        position: 'absolute',
        top: '50%', left: 3, transform: 'translateY(-50%)',
        width: 4, height: 36, borderRadius: 2,
        background: active ? 'var(--cth-indigo)' : 'var(--cth-ink-4)',
        opacity: active ? 1 : undefined
      }} />
    </div>
  );
}
