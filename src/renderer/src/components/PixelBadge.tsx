import { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

export type StatusKind =
  | 'idle' | 'thinking' | 'working' | 'waiting' | 'blocked' | 'success' | 'ghost'
  // #5C — richer states driven by real events: PreCompact/PostCompact hooks and
  // the Lane A circuit breaker (#6) respectively.
  | 'compacting' | 'looping'
  // Not an agent state at all — the USER has unsubmitted text on that agent's
  // prompt, which holds its queue. Never stored on the agent (the pty parser
  // would overwrite it); derived at render, see `hasTerminalDraft`. Without it
  // a held queue looked identical to an idle agent doing nothing.
  | 'typing'
  // The office break (issue 124): the Claude plan reached its usage limit.
  // Derived at render from the break, like 'typing'.
  | 'break';

export interface PixelBadgeProps {
  status: StatusKind;
  label?: string;
  style?: CSSProperties;
}

// v2 status pills (branding/DESIGN.md 3.5 and 7.13): text color on a soft fill,
// with a dot in the same color. Needs you is the one filled coral pill.
const pillByStatus: Record<StatusKind, { text: string; fill: string }> = {
  idle:       { text: 'var(--cth-ink-3)', fill: 'var(--cth-neutral-soft)' },
  thinking:   { text: 'var(--cth-violet-text)', fill: 'var(--cth-violet-soft)' },
  working:    { text: 'var(--cth-blue-text)', fill: 'var(--cth-blue-soft)' },
  waiting:    { text: 'var(--cth-ink-3)', fill: 'var(--cth-neutral-soft)' },
  blocked:    { text: 'var(--cth-on-coral)', fill: 'var(--cth-coral-strong)' },
  success:    { text: 'var(--cth-green-text)', fill: 'var(--cth-green-soft)' },
  ghost:      { text: 'var(--cth-ink-3)', fill: 'var(--cth-neutral-soft)' },
  compacting: { text: 'var(--cth-violet-text)', fill: 'var(--cth-violet-soft)' },
  looping:    { text: 'var(--cth-amber-text)', fill: 'var(--cth-amber-soft)' },
  typing:     { text: 'var(--cth-indigo-text)', fill: 'var(--cth-indigo-soft)' },
  break:      { text: 'var(--cth-amber-text)', fill: 'var(--cth-amber-soft)' }
};

const colorByStatus: Record<StatusKind, string> = {
  idle:     'var(--cth-status-idle)',
  thinking: 'var(--cth-status-thinking)',
  working:  'var(--cth-status-working)',
  waiting:  'var(--cth-status-waiting)',
  blocked:  'var(--cth-status-blocked)',
  success:  'var(--cth-status-success)',
  ghost:    'var(--cth-status-ghost)',
  compacting: 'var(--cth-status-compacting)',
  looping:    'var(--cth-status-looping)',
  typing:     'var(--cth-status-typing)',
  break:      'var(--cth-amber)'
};

// i18n key per status. "blocked" is reserved for the god agent waiting on YOU,
// so it reads as "needs you"; sub-agents waiting on god/another agent are
// "waiting", which is honest about who they're actually stalled on.
const labelKeyByStatus: Record<StatusKind, string> = {
  idle:     'badge.idle',
  thinking: 'badge.thinking',
  working:  'badge.working',
  waiting:  'badge.waiting',
  blocked:  'badge.blocked',
  success:  'badge.success',
  ghost:    'badge.ghost',
  compacting: 'badge.compacting',
  looping:    'badge.looping',
  // Reads as "you are typing", not "the agent is typing" — it is your text
  // sitting on the prompt, and it is why nothing is being delivered.
  typing:     'badge.typing',
  break:      'badge.onBreak'
};

export function PixelBadge({ status, label, style }: PixelBadgeProps) {
  const { t } = useTranslation();
  const key = labelKeyByStatus[status];
  const text = label ?? (key ? t(key) : status);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        // Same reason as PixelButton: a status chip that shrinks spills its text
        // under the controls beside it instead of holding its own width.
        flexShrink: 0,
        gap: 5,
        padding: '2px 8px',
        background: pillByStatus[status].fill,
        borderRadius: 'var(--cth-r-pill)',
        fontFamily: 'var(--cth-font-ui)',
        fontSize: 11,
        fontWeight: 600,
        lineHeight: '16px',
        letterSpacing: 0,
        color: pillByStatus[status].text,
        userSelect: 'none',
        ...style
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: status === 'blocked' ? 'currentColor' : colorByStatus[status]
        }}
      />
      {text}
    </span>
  );
}
