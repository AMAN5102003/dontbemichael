import { CSSProperties, ReactNode, useState } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

export interface PixelButtonProps {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: CSSProperties;
  title?: string;
  /** Accessible name when the visible label alone is ambiguous ("Open" on a list of files). */
  ariaLabel?: string;
  /** HTML button type. Defaults to 'button' so the button does not inadvertently submit forms. */
  type?: 'button' | 'submit' | 'reset';
  /** Takes the focus when its dialog opens (useDialog looks for [autofocus]). */
  autoFocus?: boolean;
}

// Design system v2 (branding/DESIGN.md 7.7): 28 in cards, 32 in bars, 36 in dialogs.
const heightBySize: Record<Size, number> = { sm: 28, md: 32, lg: 36 };
const padBySize: Record<Size, string> = { sm: '0 10px', md: '0 12px', lg: '0 16px' };

export function PixelButton({
  variant = 'primary',
  size = 'md',
  children,
  onClick,
  disabled = false,
  fullWidth = false,
  style,
  title,
  ariaLabel,
  type = 'button',
  autoFocus
}: PixelButtonProps) {
  const [pressed, setPressed] = useState(false);
  const [hover, setHover] = useState(false);

  // v2 (DESIGN.md 7.7): primary is ink, secondary is a white card on a
  // hairline, ghost is text only. Destructive is a secondary button with coral
  // text: coral fills are reserved for the Needs you signal.
  const palette = (() => {
    if (disabled) {
      return { fill: variant === 'ghost' ? 'transparent' : 'var(--cth-neutral-soft)', text: 'var(--cth-ink-3)', border: 'transparent' };
    }
    switch (variant) {
      case 'primary':
        return { fill: hover ? 'var(--cth-ink-2)' : 'var(--cth-ink)', text: 'var(--cth-bg)', border: 'transparent' };
      case 'secondary':
        return { fill: hover ? 'var(--cth-card-2)' : 'var(--cth-card)', text: 'var(--cth-ink)', border: 'var(--cth-line-2)' };
      case 'ghost':
        return { fill: hover ? 'var(--cth-neutral-soft)' : 'transparent', text: 'var(--cth-ink-2)', border: 'transparent' };
      case 'destructive':
        return { fill: hover ? 'var(--cth-coral-soft)' : 'var(--cth-card)', text: 'var(--cth-coral-text)', border: 'var(--cth-line-2)' };
    }
  })();

  return (
    <button
      type={type}
      autoFocus={autoFocus}
      title={title}
      aria-label={ariaLabel}
      onClick={disabled ? undefined : onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => { setPressed(false); setHover(false); }}
      onMouseEnter={() => setHover(true)}
      disabled={disabled}
      style={{
        // Centre content HERE rather than trusting each call site.
        //
        // A <button> with a fixed height centres bare text on its own, but a
        // child that is itself `inline-flex` (which every icon+label call site
        // uses, to sit the glyph beside the word) aligns on ITS baseline
        // instead. So a row of buttons where some labels were wrapped and some
        // were bare text — `edit` beside `IDE` and `terminal` — sat at visibly
        // different heights. Fixing it per call site fixes today's row and not
        // the next one someone writes.
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Matches the gap the wrapped call sites already use, so an icon can be
        // dropped in beside a label with no wrapper at all.
        gap: 4,
        // Kill descender-driven drift: with the height fixed above, an inherited
        // line-height only moves the text off centre.
        lineHeight: 1,
        // A button never shrinks below its own label. The default flex-shrink is
        // 1, and with `whiteSpace: nowrap` below, a squeezed button keeps drawing
        // its full-width text out of a narrowed box — so in a tight row the
        // labels paint straight over whatever sits to their left. That is not a
        // clipped button, it is two controls on top of each other.
        flexShrink: 0,
        height: heightBySize[size],
        padding: padBySize[size],
        background: palette.fill,
        color: palette.text,
        border: 'none',
        boxShadow: palette.border === 'transparent' ? 'none' : `inset 0 0 0 1px ${palette.border}`,
        borderRadius: 'var(--cth-r-md)',
        transform: pressed && !disabled ? 'translateY(1px)' : 'none',
        transition: 'background var(--cth-dur-fast) var(--cth-ease)',
        fontFamily: 'var(--cth-font-ui)',
        fontWeight: 600,
        fontSize: size === 'sm' ? 12 : 13,
        cursor: disabled ? 'not-allowed' : 'pointer',
        width: fullWidth ? '100%' : 'auto',
        userSelect: 'none',
        // Height is fixed by the size variant above, so a label that wraps does
        // not make the button taller — the extra line simply prints through the
        // bottom border. Every label here is a short phrase ("Check for updates",
        // "reset & start over"), so wrapping is always a layout bug rather than a
        // wanted behaviour. Callers that genuinely want a multi-line button can
        // still override, since `style` spreads after this.
        whiteSpace: 'nowrap',
        ...style
      }}
    >
      {children}
    </button>
  );
}
