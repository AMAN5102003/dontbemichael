import { useEffect, useId, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { GrowingTextarea } from './GrowingTextarea';
import { PixelButton } from './PixelButton';
import { AgentAvatar } from './AgentAvatar';
import { FileText } from './FileChip';
import { askedAgo } from './askHeadline';
import { useStore } from '@/store/store';
import { useRtl } from '@/i18n/useDirection';
import { isComposingKey } from '@shared/imeGuard';
import { FOUNDATION_CAP, FOUNDATION_QUESTIONS, draftPending, jobsAsking, type FoundationId, type FoundationsView } from '@shared/foundations';
import { refreshNeedsYou } from '@/shell/useNeedsYou';
import { saveFileAnswer, saveTextAnswer } from '@/shell/foundationSave';

/**
 * One Company foundations card in Needs you (docs/designs/office-foundations.md,
 * design D2, D8, D10 to D13): the question as its title, the member whose work
 * hit it, Michael's one bold line on what the work did without it, then a
 * labeled answer box with Save answer, Have the member draft it, and Not now.
 *
 * Save answers the card like any Ask me reply first, so Michael closes it,
 * then writes the answer into the foundations (the app's one writer); if that
 * write fails, Michael is asked to add it, as he does any owner answer.
 *
 * Add a file (docs/designs/foundation-card-upload.md): the file is read and
 * checked against the question before anything else, and added to company
 * knowledge only if it fits; a file that can't be read, doesn't fit or
 * couldn't be checked stops there with its line (D3, D4, D5). Then the card
 * is answered (the document is removed again if the card doesn't take it),
 * then the answer naming the document is written.
 */
export function FoundationCard({ id, rowKey, taskId, q, askedAt, raiserId, raiserName, raiserIsMember = true, memberName, chipStyle, foundations, onAnswer, onSaved }: {
  id: FoundationId;
  rowKey: string;
  taskId: string;
  /** Michael's line: what the work did without it. */
  q: string;
  askedAt?: string;
  raiserId?: string;
  raiserName?: string;
  /** Whether the raiser is on the team now: only then can it draft. */
  raiserIsMember?: boolean;
  /** A team member's name, or undefined for someone not on the team now. */
  memberName?: (id: string) => string | undefined;
  /** The raiser chip in the member's department color (D11). */
  chipStyle: CSSProperties;
  foundations: FoundationsView | null;
  /** Answer the card like any Ask me reply; resolves false when the card did not take it. */
  onAnswer: (text: string) => Promise<boolean>;
  /** Where the answer went once the card took it (the card leaves the board,
   *  so the board says it): written into the foundations, to Michael to add,
   *  or neither. */
  onSaved?: (how: 'saved' | 'michael' | 'failed') => void;
}) {
  const { t, i18n } = useTranslation();
  const rtl = useRtl();
  const hintId = useId();
  const draft = useStore((s) => s.answerDrafts[rowKey] ?? '');
  const setDraft = useStore((s) => s.setAnswerDraft);
  const [busy, setBusy] = useState(false);
  // Which action did not go through, so the line names it.
  const [failed, setFailed] = useState<'save' | 'draft' | 'later' | null>(null);
  // The file the owner picked or dropped, and why the last one was refused.
  const [file, setFile] = useState<{ path: string; name: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [refused, setRefused] = useState<{ name: string; error: string; reason?: string } | null>(null);
  const asked = foundations?.drafts?.[id];
  // A request waits 2 days; after that the card offers to ask again.
  // Who was asked (or filled it): named from the record, never the card's raiser.
  const askedName = asked ? memberName?.(asked.by) : undefined;
  const drafting = draftPending(asked, Date.now()) && !!askedName;
  const drafter = raiserName ?? '';
  const [filled, setFilled] = useState(false);
  // The member's draft fills an empty box once (D8), labeled as theirs.
  useEffect(() => {
    if (asked?.text && !draft.trim() && !filled) { setDraft(rowKey, asked.text); setFilled(true); }
  }, [asked?.text, draft, filled, rowKey, setDraft]);
  const question = t(`foundations.q.${id}`, { defaultValue: FOUNDATION_QUESTIONS[id].text });
  const jobs = jobsAsking(id).map((j) => t(`foundations.job.${j}`));
  const jobList = ((): string => { try { return new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(jobs); } catch { return jobs.join(', '); } })();
  const ago = askedAgo(askedAt, Date.now(), i18n.language, t('askMe.justNow'));
  const text = draft.trim();

  const pickFile = async (): Promise<void> => {
    if (busy) return;
    const r = await window.cth.foundationsPickFile().catch(() => null);
    if (r?.ok) { setFile({ path: r.path, name: r.name }); setRefused(null); }
  };
  const dropFile = (e: React.DragEvent): void => {
    const f = e.dataTransfer.files?.[0];
    if (!f || busy) return;
    e.preventDefault();
    const path = window.cth.pathForFile(f);
    if (path) { setFile({ path, name: f.name }); setRefused(null); }
  };

  // The steps and their order live in shell/foundationSave.ts; the card keeps
  // its state around them.
  const saveFile = async (picked: { path: string; name: string }): Promise<void> => {
    setBusy(true);
    setFailed(null);
    setRefused(null);
    setChecking(true);
    // Added and checked first, then the card, the document removed if the
    // card does not take it, then the answer naming it (or Michael adds it).
    const res = await saveFileAnswer(id, picked, text, window.cth, onAnswer, { checked: () => setChecking(false), taken: () => setFile(null) });
    if (res.kind === 'refused' || res.kind === 'failed') {
      if (res.kind === 'refused') setRefused({ name: picked.name, error: res.error, reason: res.reason });
      else setFailed('save');
      setFile(null);
      setBusy(false);
      return;
    }
    if (res.kind === 'not-taken') {
      setFailed('save');
      setBusy(false);
      return;
    }
    onSaved?.(res.how);
    refreshNeedsYou();
    setBusy(false);
  };

  const save = async (): Promise<void> => {
    if (busy) return;
    if (file) { await saveFile(file); return; }
    if (!text) return;
    setBusy(true);
    setFailed(null);
    // The card first, then the foundations; Michael adds it if that fails.
    const res = await saveTextAnswer(id, text, window.cth, onAnswer);
    if (!res.taken) {
      setFailed('save');
      setBusy(false);
      return;
    }
    // The card took it and leaves the board: the board reports from here.
    onSaved?.(res.how);
    refreshNeedsYou();
    setBusy(false);
  };
  const draftIt = (): void => {
    if (!raiserId || busy) return;
    setFailed(null);
    void window.cth.foundationsDraft(id, raiserId).then(() => refreshNeedsYou()).catch(() => setFailed('draft'));
  };
  const notNow = (): void => {
    if (busy) return;
    setFailed(null);
    void window.cth.foundationsSnooze(id).then(() => refreshNeedsYou()).catch(() => setFailed('later'));
  };

  return (
    <section role="group" aria-label={question} data-askme-id={taskId} className="cth-askme-card is-open" style={cardStyle}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={dropFile}>
      <div style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 14, fontWeight: 600, lineHeight: '19px', letterSpacing: '-0.01em', color: 'var(--cth-ink)' }}>{question}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, flexWrap: 'wrap' }}>
        {raiserName && (
          <span style={chipStyle}><AgentAvatar id={raiserId} name={raiserName} size={16} />{raiserName}</span>
        )}
        <span style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{ago ? t('foundations.card.needsAgo', { ago }) : t('foundations.card.needs')}</span>
      </div>
      {/* The evidence first (D2): Michael's bold line on what the work did without it. */}
      <div dir={rtl ? 'auto' : undefined} className="cth-askme-q" style={{ margin: '10px 0 10px', fontSize: 12.5, lineHeight: '18px', color: 'var(--cth-ink)' }}>
        <FileText source={q} who={{ raisedBy: raiserId }} />
      </div>
      {/* A visible label, and the hint as its description (D12). */}
      <label htmlFor={`${hintId}-box`} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11, fontWeight: 600, color: 'var(--cth-ink-3)', marginBottom: 4 }}>
        {t('foundations.card.yourAnswer')}
        {asked?.text && filled && <span style={{ fontWeight: 500, color: 'var(--cth-indigo-text)' }}>{askedName ? t('foundations.card.draftedBy', { name: askedName }) : t('foundations.card.drafted')}</span>}
      </label>
      <GrowingTextarea
        id={`${hintId}-box`}
        aria-describedby={hintId}
        className="cth-input"
        dir={rtl ? 'auto' : undefined}
        value={draft}
        // Held while a save runs: words typed during a file check would be
        // neither saved nor kept (ship review, 2026-10-23).
        readOnly={busy}
        maxLength={FOUNDATION_CAP}
        onChange={(e) => setDraft(rowKey, e.target.value)}
        onKeyDown={(e) => { if (isComposingKey(e)) return; if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save(); }}
        style={{
          width: '100%', display: 'block', boxSizing: 'border-box', padding: '8px 10px', minHeight: 64,
          background: 'var(--cth-card)', border: 'none',
          fontFamily: 'var(--cth-font-ui)', fontSize: 12.5, lineHeight: '18px', color: 'var(--cth-ink)', outline: 'none'
        }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 4, flexWrap: 'wrap' }}>
        <div id={hintId} style={{ flex: 1, minWidth: 160, fontSize: 11, lineHeight: '15px', color: 'var(--cth-ink-3)' }}>{t('foundations.card.hint', { n: FOUNDATION_CAP })}</div>
        {file ? (
          <span data-foundation-file style={fileChip}>
            <span dir="auto" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{file.name}</span>
            <button type="button" aria-label={t('foundations.card.removeFile', { name: file.name })} disabled={busy} onClick={() => setFile(null)} style={{ ...quietLink, fontSize: 13, lineHeight: '13px', minWidth: 24, minHeight: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
          </span>
        ) : (
          <button type="button" onClick={() => void pickFile()} disabled={busy} style={{ ...quietLink, fontSize: 11, color: 'var(--cth-indigo-text)' }}>{t('foundations.card.addFile')}</button>
        )}
      </div>
      {refused && (
        <div role="alert" style={{ marginTop: 6, fontSize: 11, lineHeight: '15px', color: 'var(--cth-coral-text)' }}>
          {refused.error === 'misfit' ? t('foundations.card.fileMisfit', { name: refused.name, reason: refused.reason ?? '' })
            : refused.error === 'unreadable' ? t('foundations.card.fileUnreadable', { name: refused.name, reason: refused.reason ?? '' })
              : refused.error === 'picture-type' ? t('foundations.card.filePictureType')
                : refused.error === 'picture-engine' ? t('foundations.card.filePictureEngine')
                : refused.error === 'no-file' ? t('foundations.card.fileMissing', { name: refused.name })
                  : t('foundations.card.fileUnchecked')}
        </div>
      )}
      {drafting && (
        <div role="status" style={{ marginTop: 8, padding: '6px 10px', borderRadius: 'var(--cth-r-lg)', background: 'var(--cth-indigo-soft)', color: 'var(--cth-indigo-text)', fontSize: 12, lineHeight: '17px' }}>
          {t('foundations.card.drafting', { name: askedName })}
        </div>
      )}
      {/* At 320 px Save and Draft share a line and Not now wraps to its own (D13). */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
        <PixelButton variant="primary" size="sm" disabled={(!text && !file) || busy} onClick={() => void save()} style={{ height: 32 }}>
          {checking ? t('foundations.card.checking') : busy ? t('askMe.sending') : t('foundations.card.save')}
        </PixelButton>
        {raiserId && raiserIsMember && drafter && !drafting && !asked?.text && (
          <PixelButton variant="secondary" size="sm" disabled={busy} onClick={draftIt} style={{ height: 32 }}>
            {t('foundations.card.draftBy', { name: drafter })}
          </PixelButton>
        )}
        <button type="button" onClick={notNow} disabled={busy} style={{ ...quietLink, marginInlineStart: 'auto' }}>{t('foundations.card.notNow')}</button>
      </div>
      {failed && <div role="alert" style={{ marginTop: 6, fontSize: 11, lineHeight: '15px', color: 'var(--cth-coral-text)' }}>{t(failed === 'save' ? 'foundations.card.failed' : failed === 'draft' ? 'foundations.card.failedDraft' : 'foundations.card.failedLater', { name: drafter })}</div>}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--cth-line)', fontSize: 11, color: 'var(--cth-ink-3)', flexWrap: 'wrap' }}>
        <span>{t('foundations.card.usedBy', { count: jobs.length, jobs: jobList })}</span>
        <span style={{ marginInlineStart: 'auto' }}>{t('foundations.card.weekly')}</span>
      </div>
    </section>
  );
}

const cardStyle: CSSProperties = {
  position: 'relative', flexShrink: 0,
  padding: '13px 14px 12px', borderRadius: 'var(--cth-r-xl)',
  background: 'var(--cth-card)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2), var(--cth-shadow-md)'
};
const fileChip: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', borderRadius: 'var(--cth-r-pill)',
  background: 'var(--cth-neutral-soft)', fontSize: 11, color: 'var(--cth-ink-2)', maxWidth: 220
};
const quietLink: CSSProperties = {
  padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-3)'
};
