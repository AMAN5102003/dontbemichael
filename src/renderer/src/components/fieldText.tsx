import type { CSSProperties, ReactNode } from 'react';
import { plainParts } from '@shared/workStyleText';
import { useRtl } from '@/i18n/useDirection';
import { InfoTip } from './InfoTip';

/**
 * The app's field style (docs/designs/edit-agent-hierarchy.md, then
 * docs/designs/app-style-rollout.md for every form and read only field
 * screen): a group name, a field label, then the text, so each step outranks
 * the next; groups sit on soft panels. One place, so screens never drift
 * apart; test/field-style-guard.test.cjs keeps it that way.
 */

/** A field label (`t-ui` 600): darker and bolder than the text under it. */
export const fieldLabel: CSSProperties = { fontSize: 13, lineHeight: '18px', fontWeight: 600, color: 'var(--cth-ink)' };

/** Read only text: `t-read` in the wide panel, `t-ui` at the side, in ink 2. */
export function readBody(wide: boolean): CSSProperties {
  return wide
    ? { fontSize: 14, lineHeight: '22px', fontWeight: 400, color: 'var(--cth-ink-2)' }
    : { fontSize: 13, lineHeight: '20px', fontWeight: 400, color: 'var(--cth-ink-2)' };
}

/** A group's name at the top of its panel (`t-panel`, AS3). */
export const groupName: CSSProperties = {
  margin: 0, fontFamily: 'var(--cth-font-ui)', fontSize: 15, lineHeight: '20px', fontWeight: 600,
  letterSpacing: '-0.02em', color: 'var(--cth-ink)'
};

/** Help under a field or a group name (AS4): quieter than any label. */
export const hint: CSSProperties = { fontSize: 12, lineHeight: '17px', fontWeight: 400, color: 'var(--cth-ink-3)' };

/** "required" beside a field's label (AS4): a quiet word, not an asterisk.
 *  Put a space before it so the label's spoken name keeps the words apart. */
export const requiredMark: CSSProperties = { marginInlineStart: 2, fontWeight: 400, color: 'var(--cth-ink-3)' };

/** The soft panel every group sits on (AS2): the ground color, so it shows
 *  on white surfaces (dialogs, panels, Settings) and never on the stage. */
export const panelStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0,
  padding: '14px 16px', borderRadius: 'var(--cth-r-xl)', background: 'var(--cth-bg)'
};

/** One group of fields: an optional name (an h3, with an info icon and an
 *  action at its right) and hint, then its fields. */
export function Panel({ title, info, action, note, id, children, style }: {
  title?: ReactNode; info?: string; action?: ReactNode; note?: ReactNode;
  id?: string; children?: ReactNode; style?: CSSProperties;
}) {
  return (
    <div id={id} data-panel={id ?? ''} style={{ ...panelStyle, ...style }}>
      {(title || action) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            {title ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <h3 style={groupName}>{title}</h3>
                {info && <InfoTip text={info} label={typeof title === 'string' ? title : undefined} />}
              </span>
            ) : <span />}
            {action}
          </div>
          {note && <div style={hint}>{note}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/** One field: its label (and info icon), the control or text, then any hint.
 *  `read` for read only text: a named group, since there is nothing to type
 *  (a <label> would send clicks to its first button). */
export function Field({ label, info, note, read = false, children, style }: {
  label: ReactNode; info?: string; note?: ReactNode; read?: boolean; children?: ReactNode; style?: CSSProperties;
}) {
  const head = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={fieldLabel}>{label}</span>
      {info && <InfoTip text={info} label={typeof label === 'string' ? label : undefined} />}
    </span>
  );
  const tail = note && <span style={hint}>{note}</span>;
  const box: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, ...style };
  if (read) return <div role="group" aria-label={typeof label === 'string' ? label : undefined} style={box}>{head}{children}{tail}</div>;
  if (!info) return <label style={box}>{head}{children}{tail}</label>;
  // With an info icon, a <label> around everything would name its first
  // control, the icon's button, and leave the field nameless (ship review,
  // 2026-10-23). So the label wraps only the field, named by a hidden copy.
  return (
    <div style={box}>
      {head}
      <label style={{ display: 'contents' }}><span style={srOnly}>{label}</span>{children}</label>
      {tail}
    </div>
  );
}

const srOnly: CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0
};

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
