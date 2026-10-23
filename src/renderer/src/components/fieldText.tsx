import type { CSSProperties } from 'react';
import { plainParts } from '@shared/workStyleText';
import { useRtl } from '@/i18n/useDirection';

/**
 * The type ramp for Edit agent, the hire wizard and the job change preview
 * (docs/designs/edit-agent-hierarchy.md, H3 and R1): a section heading, then a
 * field label, then the read only text, so a label always outranks what it
 * labels. One place, so the screens never drift apart.
 */

/** A section heading (`t-panel`): "Kelly's job", "Scheduled jobs". */
export const sectionHeading: CSSProperties = {
  margin: 0, fontFamily: 'var(--cth-font-ui)', fontSize: 15, lineHeight: '20px', fontWeight: 600,
  letterSpacing: '-0.02em', color: 'var(--cth-ink)'
};

/** A field label (`t-ui` 600): darker and bolder than the text under it. */
export const fieldLabel: CSSProperties = { fontSize: 13, lineHeight: '18px', fontWeight: 600, color: 'var(--cth-ink)' };

/** Read only text: `t-read` in the wide panel, `t-ui` at the side, in ink 2. */
export function readBody(wide: boolean): CSSProperties {
  return wide
    ? { fontSize: 14, lineHeight: '22px', fontWeight: 400, color: 'var(--cth-ink-2)' }
    : { fontSize: 13, lineHeight: '20px', fontWeight: 400, color: 'var(--cth-ink-2)' };
}

/** The name of one part of How X works ("The job"). */
export const partLabel: CSSProperties = { fontSize: 12, lineHeight: '16px', fontWeight: 600, color: 'var(--cth-ink)' };

/** Text with no part labels folds at four lines, as before (H4). */
const FOLD_LINES = 4;
const FOLD_CHARS = 320;

/** True when the folded view hides something, so Show all is offered. */
export function jobPartsFold(plain: string): boolean {
  const parts = plainParts(plain);
  if (parts.length > 1) return true;
  const only = parts[0]?.text ?? '';
  return only.split('\n').length > FOLD_LINES || only.length > FOLD_CHARS;
}

/**
 * The plain words in their parts: each part's name on its own line, its words
 * under it (H4). Folded, only the first part shows, whole; text with no labels
 * shows as one block, cut at four lines.
 */
export function JobParts({ plain, wide = false, folded = false }: { plain: string; wide?: boolean; folded?: boolean }) {
  const rtl = useRtl();
  const parts = plainParts(plain);
  const body = readBody(wide);
  if (parts.length <= 1 && !parts[0]?.label) {
    const text = parts[0]?.text ?? '';
    return <div dir={rtl ? 'auto' : undefined} style={{ ...body, whiteSpace: 'pre-wrap', ...(folded && jobPartsFold(plain) ? clamp : {}) }}>{text}</div>;
  }
  const shown = folded ? parts.slice(0, 1) : parts;
  return (
    <div data-job-parts style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {shown.map((p, i) => (
        <div key={i} dir={rtl ? 'auto' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {p.label && <span style={partLabel}>{p.label}</span>}
          {p.text && <span style={{ ...body, whiteSpace: 'pre-wrap' }}>{p.text}</span>}
        </div>
      ))}
    </div>
  );
}

const clamp: CSSProperties = { display: '-webkit-box', WebkitLineClamp: FOLD_LINES, WebkitBoxOrient: 'vertical', overflow: 'hidden' };
